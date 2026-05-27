import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import redisClient from "../config/redis.js";

const createRedisStore = (prefix) =>
  new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
    prefix,
  });

const jsonMessage = (message) => ({ message });

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: jsonMessage("Too many requests. Please try again later."),
  store: createRedisStore("global_rate_limit:"),
  // Skip file uploads so large requests are not throttled unintentionally.
  skip: (req) => req.method === "POST" && req.path.startsWith("/file/upload"),
});

export const registerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  message: jsonMessage("Too many accounts created. Please try again later."),
  store: createRedisStore("register_limit:"),
});

export const loginRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  message: jsonMessage("Too many login attempts. Please try again later."),
  keyGenerator: (req) =>
    `${req.body?.email || "anonymous"}_${ipKeyGenerator(req.ip)}`,
  store: createRedisStore("login_limit:"),
});

export const otpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 3,
  message: jsonMessage("Too many OTP requests. Please try again later."),
  keyGenerator: (req) => req.body?.email || ipKeyGenerator(req.ip),
  store: createRedisStore("otp_limit:"),
});

export const verifyOtpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  message: jsonMessage("Too many OTP verification attempts. Please try again later."),
  keyGenerator: (req) => req.body?.email || ipKeyGenerator(req.ip),
  store: createRedisStore("verify_otp_limit:"),
});

export const resetPasswordRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  message: jsonMessage("Too many password reset attempts. Please try again later."),
  keyGenerator: (req) => req.body?.email || ipKeyGenerator(req.ip),
  store: createRedisStore("reset_password_limit:"),
});

export const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  message: jsonMessage("Too many uploads. Please try again later."),
  keyGenerator: (req) => req.user?._id || ipKeyGenerator(req.ip),
  store: createRedisStore("upload_limit:"),
});
