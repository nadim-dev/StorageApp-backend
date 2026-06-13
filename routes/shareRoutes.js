import express from "express";
import {createPublicLink,fetchSharedResources,viewSharedResources,renameShareWithMeFile,viewSharedDirectoryFile,fetchSharedNestedDirectoryItem,storeSharedResourcedata,fetchSharedFileWithMe,viewShareWithMeFile,viewShareWithMeDirectory,getSharedByMe,stopSharingResources,getResourceAccess,removeUserAccess} from "../controllers/shareController.js";
import checkAuth from "../middleware/authMiddleware.js";

const router=express.Router();


router.post(
  "/public-link",
 checkAuth,
  createPublicLink
);

router.get("/shared-with-me/file/:fileId",checkAuth,viewShareWithMeFile);
router.get("/:token/file",viewSharedResources);

router.get("/directory/:token/file/:fileId",viewSharedDirectoryFile);
router.get("/:resourceType/:token",fetchSharedResources);
router.get("/directory/:token/directory/:dirId",fetchSharedNestedDirectoryItem);
router.post("/resources",checkAuth,storeSharedResourcedata);
router.get("/shared-with-me",checkAuth,fetchSharedFileWithMe);
router.patch("/shared-with-me/resource/:resourceId/rename",checkAuth,renameShareWithMeFile);
router.get("/shared-with-me/directory/:dirId",checkAuth,viewShareWithMeDirectory);
router.get("/shared-by-me", checkAuth, getSharedByMe);
router.patch("/shared-by-me/resource/:resourceId/access",checkAuth,removeUserAccess);
router.delete("/shared-by-me/resource/:resourceId",checkAuth,stopSharingResources);
router.get("/shared-by-me/resource/:resourceId/access",checkAuth,getResourceAccess);
export default router;
