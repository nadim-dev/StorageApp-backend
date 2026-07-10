import mongoose from "mongoose";
import User from "../models/userModel.js";
import bcrypt from "bcrypt";
import Directory from "../models/directoryModel.js";
import File from "../models/fileModel.js";
import { rm } from "fs/promises";
import { getProfileImageUrl, uploadToCloudinary } from "../utils/cloudinary.js";
import redisClient from "../config/redis.js";
import s3Client from "../config/s3.js";
import path from "path";
import { EXTENSION_CATEGORY } from "../constants/extension_category.js";
import {loginSchema,registerSchema,roleSchema,updatePasswordSchema,updateProfileSchema} from "../validators/userValidator.js";
import { sanitize } from "../utils/sanitize.js";
import Subcribe from "../models/subscriptionModel.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";


//* user registeration controller
export const register = async (req, res) => {
  console.log("post register function is running");
  const { success, data, error } = registerSchema.safeParse(req.body);
  if (!success) {
    console.log("error ka issue", error.issues);
    return res.status(400).json({ error: "Invalid credential" });
  }

  const { name, email, password } = sanitize(data);
  console.log("user input", name, email, password);

  //*  we are storing hashed password and for that we have written logic inside User model
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const rootDirId = new mongoose.Types.ObjectId();
    console.log("rootDirId", rootDirId);
    const userId = new mongoose.Types.ObjectId();
    console.log("userId", userId);
    const rootDirectory = await Directory.create(
      [
        {
          _id: rootDirId,
          name: `root-${email}`,
          userId,
          parentDirId: null,
        },
      ],
      { session },
    );
    console.log("rootDirectory", rootDirectory);
    const userData = await User.create(
      [
        {
          _id: userId,
          name,
          email,
          password,
          rootDirId,
          authProvider: "Local",
        },
      ],
      { session },
    );
    console.log("userData", userData);
    await session.commitTransaction();
    session.endSession();
    return res.status(201).json({ message: "Registered Successfully" });
  } catch (err) {
    console.dir(err.message);
    await session.abortTransaction();
    if (err.code == 121) {
      //Database error
      return res
        .status(400)
        .json({ error: "Invalid fields,please enter valid input details" });
    } else if (err.code === 11000) {
      console.log("database validation is running");
      console.log(err.code);
      console.log(err.keyValue.email);
      if (err.keyValue.email) {
        return res.status(400).json({ error: "Email already registered" });
      }
    } else return res.status(500).json({ error: "something went wrong" });
  }
};

//* user login controller
export const login = async (req, res) => {
  console.log("Login controller function is running");
  const { success, data, error } = loginSchema.safeParse(req.body);
  if (!success) {
    console.log("error ka issue", error.flatten());
    return res.status(400).json({ error: "Invalid credential" });
  }
  const { email, password } = data;
  console.log("email", email, "password", password);
  //* we are checking user uncle jinda hai ya nhi
  try {
    const user = await User.findOne({ email });
    console.log("user", user);
    if (!user) return res.status(404).json({ error: "email dosen't exist" });
    
    //? if user deleted by admin
    if (user.deleted) {
      return res
        .status(403)
        .json({ error: "your account has been terminated by admin" });
    }

    const isPasswordValid = await bcrypt.compare(
      password, // plain password from login
      user.password, // hashed password from DB
    );

    if (!isPasswordValid)
      return res.status(404).json({ error: "Invalid credential" });

    //* 🔐 DEVICE LIMIT LOGIC (your existing logic)
    const MAX_DEVICE = 2;
    const sessionCount = await redisClient.ft.search(
      "userIdIdx",
      `@userId:{${user._id.toString()}}`,
      {
        SORTBY: { BY: "createdAt", DIRECTION: "ASC" },
        RETURN: ["createdAt"],
      },
    );
    console.log(sessionCount);
    console.log("Deleting key:", sessionCount.documents[0]?.id);

    if (sessionCount.documents.length >= MAX_DEVICE) {
      console.log(
        `Deleting oldest session created at: ${sessionCount.documents[0].value.createdAt}`,
      );
      await redisClient.del(sessionCount.documents[0].id);
    }

    const sessionId = crypto.randomUUID();
    const sessionExpiryTime = 7 * 24 * 60 * 60;
    const rediskey = `session:${sessionId}`;
    await redisClient.hSet(rediskey, {
      userId: user._id.toString(),
      rootDirId: user.rootDirId.toString(),
      createdAt: Date.now(),
    });
    await redisClient.expire(rediskey, sessionExpiryTime);
    res.cookie("sid", sessionId, {
      httpOnly: true,
      signed: true,
      sameSite: "none",
      secure: true,
      maxAge: sessionExpiryTime * 1000,
    });

    return res.status(200).json({ message: "Login successful" });
  } catch (err) {
    console.log(err);
    console.log("login ke time ka error", err.message);
  }
};

//* accessing currentUser
export const getCurrrentUser = async (req, res) => {
  console.log("current user function is running");
  try {
    const {
      name,
      email,
      role,
      picturePublicId,
      pictureVersion,
      profilePictureUrl,
      authProvider,
      maxStorageInBytes,
    } = await User.findById(req.user._id).lean();
    const {size} = await Directory.findById(req.user.rootDirId).lean();
    const subscription = await Subcribe.findOne({
       userId: req.user._id,
       status: {
       $nin: ["cancelled", "expired"],
     },
    }).lean();
    
    let status=null;
    if(subscription?.status == "pending")
        status="active"
    
    res.json({
      name: name,
      email: email,
      role: role,
      googlePicture: profilePictureUrl,
      picture: picturePublicId
        ? getProfileImageUrl(picturePublicId, pictureVersion)
        : null,
      authProvider,
      maxStorageInBytes,
      usedStorage: size,
      planId:subscription?.planId || null,
      status:status || subscription?.status ,
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: "Internal server Error" });
  }
};

//* user self logout controller
export const logout = async (req, res) => {
  console.log("logout function is running");
  const sessionId = req.signedCookies.sid;
  await redisClient.del(`session:${sessionId}`);
  res.clearCookie("sid");
  return res.status(204).end();
};  

//* user logout from all the device
export const logoutall = async (req, res) => {
  console.log("log out all function is running");
  try {
    const sessions = await redisClient.ft.search(
      "userIdIdx",
      `@userId:{${req.user._id}}`,
    );
    console.log("sessions", sessions);
    const keys = sessions.documents.map((doc) => doc.id);
    await redisClient.del(keys);
    return res
      .status(200)
      .json({ message: "Account logout from all the device Sucessfully" });
  } catch (err) {
    console.log(err.message);
    return res.status().json({ error: err.message });
  }
};

//* accessing all users
export const getAllUser = async (req, res) => {
  console.log("All user function is running");

  try {
    const users = await User.find({ deleted: false }).lean();

    //fetching all the sessions and trying to know which user is currently active
    const result = await redisClient.ft.search(
      "userIdIdx",
      "*", // means all documents
      {
        RETURN: ["userId"],
        LIMIT: { from: 0, size: 1000 },
      },
    );

    const sessionsUserId = result.documents.map(({ value }) => value.userId);

    const sessionsUserIdSet = new Set(sessionsUserId);

    const transformedUsers = users.map(
      ({ _id, name, email, picturePublicId, pictureVersion, role }) => {
        return {
          id: _id,
          name,
          email,
          picture: getProfileImageUrl(picturePublicId, pictureVersion),
          role,
          isLoggedIn: sessionsUserIdSet.has(_id.toString()),
        };
      },
    );

    return res.status(200).json({ transformedUsers });
  } catch (err) {
    console.log(err.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

//* force Logout by user
export const forceLogout = async (req, res) => {
  console.log("force logout function is running");
  try {
    const { id } = req.params;
    const targetUser = await User.findById(id).lean();

    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (
      ((targetUser.role === "Admin" || targetUser.role === "Owner") &&
        req.user.role === "Manager") ||
      (targetUser.role === "Owner" && req.user.role === "Admin")
    ) {
      return res.status(403).json({
        message: `you have no authority to logout ${targetUser.role}`,
      });
    }

    const sessions = await redisClient.ft.search(
      "userIdIdx",
      `@userId:{${id}}`,
    );
    console.log("sessions for force logout", sessions);

    const keys = sessions.documents.map((doc) => doc.id);
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }

    return res.status(200).json({
      message: "User logged out from all devices",
      sessionsDeleted: keys.length,
    });
  } catch (err) {
    console.log(err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

//* Hard delete by admin

export const HardDelete = async (req, res) => {
  console.log("Hard Delete function is running");
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    const currentUser = req.user;

    session.startTransaction();

    const targetUser = await User.findById(id).session(session);
    if (!targetUser) {
      await session.abortTransaction();
      return res.status(404).json({ message: "User not found" });
    }

    if (targetUser._id.equals(currentUser._id)) {
      await session.abortTransaction();
      return res.status(403).json({ message: "Self deletion is not allowed" });
    }

    if (targetUser.role == "Owner" && currentUser.role == "Admin") {
      return res.status(403).json({ message: "you can't delete owner" });
    }

   const files = await File.find({ userId: targetUser._id })
  .lean()
  .session(session);

  const objects = files.map(({ _id, extension }) => ({
    Key: `${_id}.${extension}`,
  }));

await User.deleteOne({ _id: targetUser._id }).session(session);
await File.deleteMany({ userId: targetUser._id }).session(session);
await Directory.deleteMany({ userId: targetUser._id }).session(session);
await Session.deleteMany({ userId: targetUser._id }).session(session);

await session.commitTransaction();

try {
  if (objects.length > 0) {
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Delete: {
          Objects: objects,
        },
      })
    );
  }
} catch (err) {
  console.error("Failed to delete S3 files:", err);
}

    return res.status(200).json({
      message: "User and all associated data deleted successfully",
    });
  } catch (err) {
    console.error(err);

    // ✅ Abort ONLY if transaction is still active
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    return res.status(500).json({ message: "Internal server error" });
  } finally {
    session.endSession();
  }
};

//* soft delete by admin

export const softDelete = async (req, res) => {
  console.log("Soft delete function is running");
  try {
    const { id } = req.params;
    const user = await User.findById(id).lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (req.user._id.toString() == user._id.toString()) {
      return res.status(403).json({ message: "Self deletion is not feasible" });
    }

    const result = await redisClient.ft.search("userIdIdx", `@userId:{${id}}`, {
      RETURN: [],
      LIMIT: { from: 0, size: 5 },
    });

    console.log("result", result);

    const keys = result.documents.map((doc) => doc.id);

    if (keys.length) {
      await redisClient.del(...keys); // ✅ spread operator
    }
    await User.findByIdAndUpdate(id, {
      deleted: true,
      deletedAt: new Date(),
      deletedBy: req.user.role,
    });
    return res.status(200).json({ message: "User deleted Successfully" });
  } catch (err) {
    console.log(err.message);
  }
};

//* access of all delete users

export const getDeleteUsers = async (req, res) => {
  console.log("Delete Users Function is running");

  const users = await User.find({ deleted: true }).lean();

  const transformedUsers = users.map((user) => {
    const {
      _id,
      name,
      email,
      deletedBy,
      deletedAt,
      picturePublicId,
      pictureVersion,
    } = user;

    return {
      id: _id.toString(),
      name,
      email,
      deletedBy,
      deletedAt,
      picture: picturePublicId
        ? getProfileImageUrl(picturePublicId, pictureVersion)
        : null,
    };
  });

  return res.json(transformedUsers);
};

//* recover soft delete user

export const recoverUser = async (req, res) => {
  console.log("recover user function is running");
  try {
    const { id } = req.params;
    await User.findByIdAndUpdate(id, { deleted: false });
    return res
      .status(200)
      .json({ message: "user account recovered successfully" });
  } catch (err) {
    console.log(err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

//* update role of user

export const assignRole = async (req, res) => {
  try {
    console.log("Change Role Function is running");

    const { id } = req.params;
    console.log(req.body);
    const { data, error, success } = roleSchema.safeParse(req.body);
    if (!success) {
      console.log(error.flatten());
      return res.status(400).json({ error: "Invalid role" });
    }
    const { role } = data;
    console.log("id:", id);
    console.log("role:", role);

    const user = await User.findByIdAndUpdate(
      id,
      { role },
      { new: true }, // returns updated document
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      message: "Role assigned successfully",
      user,
    });
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// TODO niche controller check karke delete karna hai bacuase iska api ham ub nhi use kar rhe hai
//* get user profile

export const getUserProfile = async (req, res) => {
  console.log("User Profile Function is running ");
  console.log("user profile", req.user);
  const { name, email, role, picturePublicId, pictureVersion, authProvider } =
    await User.findById(req.user._id);
  const cloudinaryURL = getProfileImageUrl(picturePublicId, pictureVersion);
  console.log("cloudinaryURL", cloudinaryURL);
  return res.status(200).json({
    name,
    email,
    role,
    picture: picturePublicId ? cloudinaryURL : null,
    authProvider,
  });
};

//* update user password

export const updatePassword = async (req, res) => {
  console.log(req.body);
  const { data, error, success } = updatePasswordSchema.safeParse(req.body);
  if (!success) {
    console.log(error.flatten());
    return res.status(400).json({ error: error.flatten() });
  }

  const { currentPassword, newPassword } = data;
  const user = await User.findOne({ _id: req.user._id });
  console.log("update password function", user);

  try {
    // 🔐 Google user – first time password set
    if (!user.password) {
      user.password = newPassword; // 👈 plain password
      user.authProvider = "local"; // or ["google","local"]

      await user.save(); // 🔥 pre("save") WILL RUN here

      return res.status(201).json({
        message: "Password set successfully",
      });
    }

    // 🔐 Local user – change password
    if (user.authProvider === "local") {
      const isMatch = await user.comparePassword(currentPassword);

      if (!isMatch) {
        return res.status(400).json({
          message: "Current password is incorrect",
        });
      }

      user.password = newPassword;
      await user.save(); // 🔥 pre("save") WILL RUN

      return res.status(200).json({
        message: "Password updated successfully",
      });
    }
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(500).json({ error: err.message });
    }
  }
};

//* update user profile

export const updateUserProfile = async (req, res) => {
  console.log("Update user profile function");
  try {
    const { data, success } = updateProfileSchema.safeParse(req.body);
    if (!success) {
      return res.status(400).json({ message: "Validation Failed" });
    }

    const { name } = sanitize(data);
    if (!name && !req.file) {
      return res.status(400).json({ messages: "no changes required" });
    }

    const updateData = {};

    if (name) updateData.name = name;

    //* ✅ Update avatar ONLY if file exists
    if (req.file) {
      const { publicId, version } = await uploadToCloudinary(
        req.file.buffer,
        req.user._id.toString(),
      );
      console.log("public id", publicId);

      updateData.picturePublicId = publicId;
      updateData.pictureVersion = version;
    }
    const user = await User.findByIdAndUpdate(req.user._id, updateData, {
      new: true,
      runValidators: true,
    }).select("name");

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      picture: getProfileImageUrl(
        updateData.picturePublicId,
        updateData.pictureVersion,
      ),
      name: user.name,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

//*Access user Resources

export const userResources = async (req, res) => {
  console.log("Acess resources function is running");

  const { userId } = req.params;
  console.log("UserId", userId);

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User dosen't exist" });
    }

    const directoryData = await Directory.find({
      parentDirId: user.rootDirId,
    }).lean();

    const fileData = await File.find({ parentDirId: user.rootDirId }).lean();

    //*  Convert to unified resource format
    const directories = await Promise.all(
      directoryData.map(async (dir) => {
        console.log(dir._id.toString());
        const allFilesSize = await File.find({ parentDirId: dir._id })
          .select("size -_id")
          .lean();

        console.log("folder ka size", allFilesSize);

        // ✅ calculate total size
        const totalSize = allFilesSize.reduce(
          (sum, file) => sum + (file.size || 0),
          0,
        );

        return {
          ...dir,
          type: "folder",
          size: totalSize, // ✅ attach size here
        };
      }),
    );

    const files = fileData.map((file) => ({ ...file, type: "file" }));

    const resources = [...directories, ...files];
    return res.status(200).json({
      resources,
      user: {
        name: user.name,
        role: user.role,
        email: user.email,
        picture: getProfileImageUrl(user.picturePublicId, user.pictureVersion),
      },
    });
  } catch (err) {
    console.log(err.message);
  }
};

//* View Document

export const viewDocument = async (req, res) => {
  console.log("viewDocument function is running");
  const { userId, fileId } = req.params;
  console.log(userId, fileId);
  try {
    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ error: "User Not found" });
    }
    const fileData = await File.findOne({ _id: fileId, userId: userId }).lean();
    console.log("fileData", fileData);
    //check file exist or not
    if (!fileData) return res.status(404).json({ error: "File not found!" });

    res.sendFile(`${process.cwd()}/public/${fileId}${fileData.extension}`);
  } catch (err) {
    console.log(err.message);
  }
};

//* Access Nested Resources

export const accessNestedResources = async (req, res) => {
  console.log("accessNestedResources function is running");
  const { folderId } = req.params;

  const directoryData = await Directory.find({ parentDirId: folderId }).lean();
  console.log("directory", directoryData);
  const fileData = await File.find({ parentDirId: folderId }).lean();
  console.log("file", fileData);

  // Convert to unified resource format
  const directories = directoryData.map((dir) => ({ ...dir, type: "folder" }));

  const files = fileData.map((file) => ({ ...file, type: "file" }));

  const items = [...directories, ...files];
  return res.status(200).json({ items });
};

//* Access folder size
export const storageUsed = async (req, res) => {
  console.log("folder storage function is running");
  const { size: usedBytes } = await Directory.findById(
    req.user.rootDirId,
  ).lean();
  console.log("usedBytes", usedBytes);
  return res.status(200).json({ usedBytes });
};

//* access all the starred resources

export const accessSterredResources = async (req, res) => {
  try {
    const files = (
      await File.find({ starred: true, isDeleted: false, userId: req.user._id })
        .sort({ createdAt: -1 })
        .lean()
    ).map((file) => ({ ...file, isDirectory: false }));
    const directories = (
      await Directory.find({
        starred: true,
        isDeleted: false,
        userId: req.user._id,
      })
        .sort({ createdAt: -1 })
        .lean()
    ).map((dir) => ({ ...dir, isDirectory: true }));
    return res.status(200).json([...files, ...directories]);
  } catch (err) {
    console.log(err.message);
  }
};


export const searchUsers = async (req, res) => {
  console.log("Search user function is running");
  const { q } = req.query;

  if (!q || q.length < 2) {
    return res.json({
      users: []
    });
  }

  const users = await User.find({
    $or: [
      {
        name: {
          $regex: q,
          $options: "i"
        }
      },
      {
        email: {
          $regex: q,
          $options: "i"
        }
      }
    ],
    _id: {
      $ne: req.user._id
    }
  }).limit(10);
    
  console.log("users",users);
  const updatedUsers = users.map((user) => {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    picture: user.picturePublicId
      ? getProfileImageUrl(
          user.picturePublicId,
          user.pictureVersion
        )
      : user.profilePictureUrl
  };
});

  res.json({ users:updatedUsers });
};

export const getStorageOnCategoryBasis = async (req, res) => {
  console.log("getStorageOnCategoryBasis controller is running");

  try {
    const filesList = await File.find({
      userId: req.user._id,
      isDeleted: false,
    })
      .select("extension size createdAt")
      .lean();
    console.log("fileList", filesList);

    const storageBreakdown = {};

    for (const file of filesList) {
      const extension = file.extension?.toLowerCase().replace(/^\./, "");
      const category =
        EXTENSION_CATEGORY[extension] || "Others";

      if (!storageBreakdown[category]) {
        storageBreakdown[category] = 0;
      }

      storageBreakdown[category] += file.size;
    }

    const totalUsedStorage = Object.values(storageBreakdown).reduce(
      (sum, size) => sum + size,
      0
    );

    const categories = Object.entries(storageBreakdown).map(
      ([name, size]) => ({
        name,
        size,
        percentage: totalUsedStorage
          ? Number(((size / totalUsedStorage) * 100).toFixed(1))
          : 0,
      })
    );

    return res.status(200).json({
      totalUsedStorage,
      categories,
    });
  } catch (err) {
    console.log(err.message);
    return res.status(500).json({
      message: "Something went wrong",
    });
  }
};

const duplicateSummary = async (userId) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const [summary] = await File.aggregate([
    {
      $match: {
        userId: userObjectId,
        isDeleted: false,
        isUploading: false,
        status: "active",
        hash: {
          $exists: true,
          $nin: [null, ""],
        },
      },
    },
    {
      $group: {
        _id: "$hash",
        count: { $sum: 1 },
        totalSize: { $sum: "$size" },
        fileSize: { $first: "$size" },
      },
    },
    {
      $match: {
        count: { $gt: 1 },
      },
    },
    {
      $project: {
        duplicateCount: { $subtract: ["$count", 1] },
        duplicateSize: { $subtract: ["$totalSize", "$fileSize"] },
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: "$duplicateCount" },
        totalSize: { $sum: "$duplicateSize" },
      },
    },
  ]);

  return {
    count: summary?.count || 0,
    totalSize: summary?.totalSize || 0,
  };
};


export const trashStats = async (userId) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // Directory statistics
  const [directoryStats] = await Directory.aggregate([
    {
      $match: {
        userId: userObjectId,
        isDeleted: true,
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        totalSize: { $sum: "$size" },
      },
    },
  ]);

  // Get deleted directory ids so files inside them are not counted again
  const deletedDirIds = await Directory.find({
    userId: userObjectId,
    isDeleted: true,
  }).distinct("_id");

  // File statistics (excluding files inside deleted directories)
  const [fileStats] = await File.aggregate([
    {
      $match: {
        userId: userObjectId,
        isDeleted: true,
        parentDirId: { $nin: deletedDirIds },
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        totalSize: { $sum: "$size" },
      },
    },
  ]);

  return {
    count: (directoryStats?.count || 0) + (fileStats?.count || 0),
    totalSize: (directoryStats?.totalSize || 0) + (fileStats?.totalSize || 0),
  };
};

export const largeFilesStats = async (userId) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const [stats] = await File.aggregate([
    {
      $match: {
        userId: userObjectId,
        isDeleted: false,
        size: { $gte: 500 * 1024 * 1024 }, // >= 500 MB
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        totalSize: { $sum: "$size" },
      },
    },
  ]);

  return {
    count: stats?.count || 0,
    totalSize: stats?.totalSize || 0,
  };
};

export const oldResourceStats = async (userId) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const [stats] = await File.aggregate([
    {
      $match: {
        userId: userObjectId,
        isDeleted: false,
        lastAccessedAt: { $lte: oneYearAgo },
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        totalSize: { $sum: "$size" },
      },
    },
  ]);

  return {
    count: stats?.count || 0,
    totalSize: stats?.totalSize || 0,
  };
};

export const fetchAllRecommendations = async (req, res) => {
  try {
    console.log("fetchAllRecommendations function is running");
    const userId=req.user._id
    const [
      oldResource,
      largeFiles,
      duplicateResource,
      trashResource
    ] = await Promise.all([
      oldResourceStats(userId),           // Your helper
      largeFilesStats(userId),
      duplicateSummary(userId),          // Your helper
      trashStats(userId)               // Your helper
    ]);

  const recommendations = [
  {
    type: "duplicate",
    title: "Duplicate Files",
    count: duplicateResource.count,
    size: duplicateResource.totalSize
  },
  {
    type: "old",
    title: "Old & Unused Files",
    count: oldResource.count,
    size: oldResource.totalSize
  },
  {
    type: "large",
    title: "Large Files",
    count: largeFiles.count,
    size: largeFiles.totalSize
  },
  {
    type: "trash",
    title: "Files in Trash",
    count: trashResource.count,
    size:trashResource.totalSize
  }
].filter(item => item.count > 0);
  return res.status(200).json({recommendations});
 
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch recommendations."
    });
  }
};


export const getStorageHealth=async (req,res)=>{
 try {
  console.log("getStorageHealth calculation function is running");
  const userId=req.user._id;
  const rootDirId=req.user.rootDirId;

  const rootDirectory = await Directory.findById(rootDirId).select("size").lean();
  const usedStorage = rootDirectory?.size || 0;
  console.log("used storage",usedStorage);

  const[
      oldResource,
      largeFiles,
      duplicateResource,
      trashResource
    ]=await Promise.all([
      oldResourceStats(userId),        // Your helper
      largeFilesStats(userId),
      duplicateSummary(userId),          // Your helper
      trashStats(userId),               // Your helper
    ]);

   const duplicatePenalty = usedStorage ? (duplicateResource.totalSize / usedStorage)*35 : 0;
   const oldPenalty = usedStorage ? (oldResource.totalSize / usedStorage)*25 : 0;
   const largePenalty= usedStorage ? (largeFiles.totalSize / usedStorage)*25 : 0;
   const trashPenalty= usedStorage ? (trashResource.totalSize / usedStorage)*25 : 0;

   let score =Math.round(100-duplicatePenalty -oldPenalty -largePenalty -trashPenalty);  
   
   score = Math.max(0, Math.min(100, Math.round(score)));
   let message;
   if(score >= 90)
    message="Excellent! Your storage is optimized."

  else if(score >= 75)
      message="Great! Your storage is well managed."
  
  else if(score >= 60)
      message="Good. Some cleanup can improve storage."
  
  else if(score >= 40)
      message="Storage needs attention."
  
  else
    message="Your storage is heavily cluttered."

  const recommendations = [
  {
    type: "duplicate",
    title: "Duplicate Files",
    size: duplicateResource.totalSize,
    status: duplicateResource.totalSize === 0 ? "good" : "warning",
  },
  {
    type: "old",
    title: "Old & Unused Files",
    size: oldResource.totalSize,
    status: oldResource.totalSize === 0 ? "good" : "warning",
  },
  {
    type: "large",
    title: "Large Unused Files",
    size: largeFiles.totalSize,
    status: largeFiles.totalSize === 0 ? "good" : "warning",
  },
  {
    type: "trash",
    title: "Trash",
    size: trashResource.totalSize,
    status: trashResource.totalSize === 0 ? "clean" : "warning",
  },
];
  

  return res.status(200).json({score:score,message:message,recommendations})
   
 } catch (err) {
  console.log(err.message);
  return res.status(500).json({ message: "Internal Server Error" });
 }
}
