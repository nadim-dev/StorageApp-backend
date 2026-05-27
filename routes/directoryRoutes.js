import express from "express";
import validateMiddleware from "../middleware/validateMiddleware.js";
import { createDirectory, deleteDirectory, getDirectoryById, renameDirectory,AccessingBreadCumbPath,temporaryDeleteFolder,handleStar } from "../controllers/directoryController.js";
import checkAuth from "../middleware/authMiddleware.js";

const router=express.Router();

router.param("id",validateMiddleware);

//accessing folderbreadcumb path

router.get("/:dirId/breadcumbpath",AccessingBreadCumbPath);

//Deleting Directory

router.delete("/:folderId",checkAuth,deleteDirectory)

//Renaming Directory

router.patch("/:folderId",checkAuth,renameDirectory);

//Create Directory

router.post("/{*parentDirId}",checkAuth,createDirectory);


//serving directory content

router.get("/{*id}",checkAuth,getDirectoryById);

//* temporary delete directory

router.delete("/temporary/delete/:dirId",checkAuth,temporaryDeleteFolder);


//* post request for sending starring request

router.patch("/starred/:id",checkAuth,handleStar);



export default router;