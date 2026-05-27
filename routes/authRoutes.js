import express from "express";
import {loginWithGoogle,redirectToGithub, loginWithGithub,sendOTPController,verifyOTP, resetPassword} from "../controllers/authController.js";
import {
  loginRateLimiter,
  otpRateLimiter,
  verifyOtpRateLimiter,
  resetPasswordRateLimiter,
} from "../middleware/rateLimiter.js";
import throttle from "../middleware/throttleMiddleware.js";
const router=express.Router();



router.post(
  "/google-login",
  loginRateLimiter,
  throttle({
    waitTime: 800,
    allowed: 3,
    windowMs: 60 * 1000,
    routeName: "google-login",
  }),
  loginWithGoogle
);

router.get(
  "/github",
  loginRateLimiter,
  throttle({
    waitTime: 1200,
    allowed: 2,
    windowMs: 60 * 1000,
    routeName: "github-login",
  }),
  redirectToGithub
);
router.get("/github/callback",loginWithGithub);
router.post(
  "/forgot-password",
  otpRateLimiter,
  throttle({
    waitTime: 1000,
    allowed: 2,
    windowMs: 60 * 1000,
    routeName: "forgot-password",
  }),
  sendOTPController
);
router.post(
  "/verify-otp",
  verifyOtpRateLimiter,
  throttle({
    waitTime: 800,
    allowed: 3,
    windowMs: 60 * 1000,
    routeName: "verify-otp",
  }),
  verifyOTP
);
router.post(
  "/reset-password",
  resetPasswordRateLimiter,
  throttle({
    waitTime: 1000,
    allowed: 2,
    windowMs: 60 * 1000,
    routeName: "reset-password",
  }),
  resetPassword
);



export default router;
