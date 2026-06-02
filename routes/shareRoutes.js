import express from "express";
import {createPublicLink} from "../controllers/shareController.js";
import checkAuth from "../middleware/authMiddleware.js";

const router=express.Router();



router.post(
  "/public-link",
 checkAuth,
  createPublicLink
);






export default router;