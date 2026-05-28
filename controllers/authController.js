import OTP from "../models/otpModel.js";
import User from "../models/userModel.js";
import Directory from "../models/directoryModel.js";
import { verifyIdToken } from "../service/googleAuthServices.js";
import mongoose from "mongoose";
import { uploadOAuthAvatarToCloudinary } from "../utils/cloudinary.js";
import axios from "axios";
import redisClient from "../config/redis.js";
import https from "https";
import { sendOTPServices } from "../service/sendOTPServices.js";
import {
  googleLoginSchema,
  githubLoginSchema,
} from "../validators/authValidator.js";
import { getVerifiedGithubEmail } from "../helper/githubEmail.js";

import * as z from "zod";
const githubAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 10,
});

const githubApi = axios.create({
  httpsAgent: githubAgent,
  timeout: 7000,
  headers: {
    Accept: "application/vnd.github+json",
    "User-Agent": "drive-app-auth",
  },
});

export const loginWithGoogle = async (req, res) => {
  console.log("google login controller function is running");
  let userId, rootDirId;
  const { success, data, error } = googleLoginSchema.safeParse(req.body);
  console.log("data of google", data);
  if (!success) {
    console.log(z.flattenError(error));
    return res.status(400).json({ message: "Invalid Otp" });
  }
  const { id_token } = data;
  let mongooseSession;
  let transactionCommitted = false;

  try {
    const profileData = await verifyIdToken(id_token);
    console.log(profileData);
    const { name, email, picture } = profileData;

    let user = await User.findOne({ email })
      .select("_id rootDirId deleted picturePublicId")
      .lean();

    // 🆕 NEW USER
    if (!user) {
      mongooseSession = await mongoose.startSession();
      mongooseSession.startTransaction();
      userId = new mongoose.Types.ObjectId();
      rootDirId = new mongoose.Types.ObjectId();

      await Directory.create(
        [
          {
            _id: rootDirId,
            name: `root-${email}`,
            userId,
            parentDirId: null,
          },
        ],
        { session: mongooseSession },
      );

      const [newUser] = await User.create(
        [
          {
            _id: userId,
            name,
            email,
            profilePictureUrl: picture,
            rootDirId,
          },
        ],
        { session: mongooseSession },
      );

      await mongooseSession.commitTransaction();
      transactionCommitted = true;
      user = newUser;
    }

    //? if user deleted by admin
    if (user.deleted) {
      return res
        .status(403)
        .json({ error: "your account has been terminated by admin" });
    }

    //* 🔐 DEVICE LIMIT LOGIC (existing + new users)

    const MAX_DEVICE = 2;
    const sessionCount = await redisClient.ft.search(
      "userIdIdx",
      `@userId:{${user._id.toString()}}`,
      {
        SORTBY: { BY: "createdAt", DIRECTION: "ASC" },
        RETURN: ["createdAt"],
      },
    );
    console.log("session ka count", sessionCount);

    if (sessionCount.documents.length >= MAX_DEVICE) {
      console.log(
        `Deleting oldest session created at: ${sessionCount.documents[0].value.createdAt}`,
      );
      await redisClient.del(sessionCount.documents[0].id);
    }

    //*  ✅ CREATE LOGIN SESSION (outside transaction)
    const sessionId = crypto.randomUUID();
    const sessionExpireTime = 7 * 24 * 60 * 60;
    const redisKey = `session:${sessionId}`;

    //* starting both the process concurrently
    const pipeline = redisClient.multi();
    pipeline.hSet(redisKey, {
      userId: user._id.toString(),
      rootDirId: user.rootDirId.toString(),
      createdAt: Date.now(),
    });

    pipeline.expire(redisKey, sessionExpireTime);
    await pipeline.exec();

    res.cookie("sid", sessionId, {
      httpOnly: true,
      signed: true,
      sameSite: "none",
      secure: true,
      maxAge: sessionExpireTime * 1000,
    });

    return res.status(200).json({
      message: "Google login successful",
    });
  } catch (err) {
    if (mongooseSession && !transactionCommitted) {
      await mongooseSession.abortTransaction();
    }
    console.log(err);
    console.log(err.message);
    return res.status(500).json({ message: "Google login failed" });
  } finally {
    if (mongooseSession) {
      mongooseSession.endSession();
    }
  }
};

export const redirectToGithub = async (req, res) => {
  console.log("Github function is running");
  const redirectUrl =
    "https://github.com/login/oauth/authorize" +
    `?client_id=${process.env.GITHUB_CLIENT_ID}` +
    "&scope=user:email";

  res.redirect(redirectUrl);
};

export const loginWithGithub = async (req, res) => {
  console.time();
  let mongooseSession;
  let transactionCommitted = false;
  try {
    const { success, data, error } = githubLoginSchema.safeParse(req.query);
    if (!success) {
      console.log(z.flattenError(error));
      return res.status(400).json({ message: "Github login failed" });
    }
    const { code } = data;
    console.log("code", code);
    if (!code) {
      return res.redirect("https://cloudnest-frontend.netlify.app/login");
    }

    // 1️⃣ Exchange code → access token
    const tokenRes = await githubApi.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      },
      { headers: { Accept: "application/json" } },
    );

    const accessToken = tokenRes.data.access_token;
    if (!accessToken) {
      return res.redirect("https://cloudnest-frontend.netlify.app/login");
    }

    // 2️⃣ Fetch GitHub user
    const githubRes = await githubApi.get("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const githubUser = githubRes.data;
    let { name, email, avatar_url } = githubUser;

    // 🔑 FIX: GitHub email can be null
    if (!email) {
      console.log("Email is not present");
      email = await getVerifiedGithubEmail(accessToken, {
        timeout: 7000,
        httpsAgent: githubAgent,
      });
    }

    if (!email) {
      return res.redirect("https://cloudnest-frontend.netlify.app/login");
    }

    // 3️⃣ Find or create user
    let user = await User.findOne({ email })
      .select("_id rootDirId deleted picturePublicId")
      .lean();

    console.log("User", user);

    if (!user) {
      mongooseSession = await mongoose.startSession();
      mongooseSession.startTransaction();

      const userId = new mongoose.Types.ObjectId();
      const rootDirId = new mongoose.Types.ObjectId();

      await Directory.create(
        [
          {
            _id: rootDirId,
            name: `root-${email}`,
            userId,
            parentDirId: null,
          },
        ],
        { session: mongooseSession },
      );

      const [newUser] = await User.create(
        [
          {
            _id: userId,
            name,
            email,
            profilePictureUrl: avatar_url,
            rootDirId,
            authProvider: "Github",
          },
        ],
        { session: mongooseSession },
      );

      await mongooseSession.commitTransaction();
      transactionCommitted = true;
      user = newUser;
    }

    //? if user deleted by admin
    if (user.deleted) {
      return res
        .status(403)
        .json({ error: "your account has been terminated by admin" });
    }

    //*  🔐 DEVICE LIMIT LOGIC (existing + new users)
    const MAX_DEVICE = 2;
    const sessionCount = await redisClient.ft.search(
      "userIdIdx",
      `@userId:{${user._id.toString()}}`,
      {
        SORTBY: { BY: "createdAt", DIRECTION: "ASC" },
        RETURN: ["createdAt"],
        LIMIT: { from: 0, size: MAX_DEVICE },
      },
    );
    console.log("session ka count", sessionCount);

    const activeSessions = sessionCount.total ?? sessionCount.documents.length;
    if (activeSessions >= MAX_DEVICE) {
      console.log(
        `Deleting oldest session created at: ${sessionCount.documents[0].value.createdAt}`,
      );
      await redisClient.del(sessionCount.documents[0].id);
    }
    const sessionId = crypto.randomUUID();
    const sessionExpireTime = 7 * 24 * 60 * 60;
    const redisKey = `session:${sessionId}`;

    //* starting both the process concurrently
    const pipeline = redisClient.multi();
    pipeline.hSet(redisKey, {
      userId: user._id.toString(),
      rootDirId: user.rootDirId.toString(),
      createdAt: Date.now(),
    });
    pipeline.expire(redisKey, sessionExpireTime);
    await pipeline.exec();

    res.cookie("sid", sessionId, {
      httpOnly: true,
      signed: true,
       sameSite: "none",
      secure: true,
      maxAge: sessionExpireTime * 1000,
    });

    // 6️⃣ Redirect to frontend
    res.redirect("https://cloudnest-frontend.netlify.app/");
  } catch (err) {
    if (mongooseSession && !transactionCommitted) {
      await mongooseSession.abortTransaction();
    }
    console.error("GitHub OAuth Error:", err.message);
    res.redirect("https://cloudnest-frontend.netlify.app/login");
  } finally {
    if (mongooseSession) {
      mongooseSession.endSession();
    }
    console.timeEnd();
  }
};

export const sendOTPController = async (req, res) => {
  console.log("Send OTP function is running");
  try {
    const { email } = req.body;
    console.log("email", email);
    if (!email) {
      return res.status(404).json({ message: "email dosen't exist" });
    }
    const data = await sendOTPServices(email);

    return res.json(data);
  } catch (err) {
    console.log(err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to send OTP email. Please try again later.",
    });
  }
};

export const verifyOTP = async (req, res) => {
  console.log("Verify OTP function is running");
  const { otp, email } = req.body;
  console.log(otp, email);
  const otpRecord = await OTP.findOne({ email: email, otp: otp });
  console.log("OTP RECORD", otpRecord);
  if (!otpRecord) {
    res.status(400).json({ error: "Invalid OTP" });
  }
  //  Manual expiry check
  const now = Date.now();
  const createdAt = new Date(otpRecord.createdAt).getTime();
  const diffMinutes = (now - createdAt) / (1000 * 60);

  if (diffMinutes > 10) {
    // optional cleanup
    await OTP.deleteOne({ _id: otpRecord._id });

    return res.status(400).json({
      message: "OTP expired",
    });
  }

  await otpRecord.deleteOne();

  return res.json({ message: "OTP Verified" });
};

export const resetPassword = async (req, res) => {
  console.log("Verify OTP function is running");
  const { password, email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "user not found" });
    }
    user.password = password; // plain password
    await user.save();
    return res.status(200).json({ message: "password changed successfully" });
  } catch (err) {
    console.log(err.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
