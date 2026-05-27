import express from "express";
import validateMiddleware from "../middleware/validateMiddleware.js";
import { deleteFile, getFile, renameFile,handleStar,unStarredFile,temporaryDeleteFile,recentFileItems,markUploadComplete,markUploadFail,generateSignedURL} from "../controllers/fileController.js";
import checkAuth from "../middleware/authMiddleware.js";
import { uploadRateLimiter } from "../middleware/rateLimiter.js";
import throttle from "../middleware/throttleMiddleware.js";

const router=express.Router();
 
//serving file through dynamic routing 

router.param("fileId",validateMiddleware);
router.param("parentDirId",validateMiddleware);

//* get request for accessing recent files
router.get("/trash",checkAuth,recentFileItems);


//* get request for accessing recent files
router.get("/recent",checkAuth,recentFileItems);



//* temporary delete file
router.delete("/temporary/delete/:fileId",checkAuth,temporaryDeleteFile)



//* removing file from starred
router.patch("/unstarred/:fileId",checkAuth,unStarredFile);


//* serving File
router.get("/:fileId",checkAuth,getFile);

//* deleting file

router.delete("/:fileId",checkAuth,deleteFile); 

//* Renaming file

router.patch("/:fileId",checkAuth,renameFile);


//* post request for sending starring request

router.patch("/starred/:id",checkAuth,handleStar);

//*  generating signed url for file upload
router.post("/uploads/initiate",checkAuth,generateSignedURL)

//* post request for sending server message of success file upload
router.post("/uploads/complete",checkAuth,markUploadComplete);

//* post request for sending server failure message of file upload
router.post("/uploads/failed",checkAuth,markUploadFail);



export default router; 