import express from "express";
import {createPublicLink,fetchSharedResources,viewSharedResources,viewSharedDirectoryFile,fetchSharedNestedDirectoryItem} from "../controllers/shareController.js";
import checkAuth from "../middleware/authMiddleware.js";

const router=express.Router();


router.post(
  "/public-link",
 checkAuth,
  createPublicLink
);

router.get("/:token/file",viewSharedResources);

router.get("/directory/:token/file/:fileId",viewSharedDirectoryFile);
router.get("/:resourceType/:token",fetchSharedResources);
router.get("/directory/:token/directory/:dirId",fetchSharedNestedDirectoryItem);

export default router;
