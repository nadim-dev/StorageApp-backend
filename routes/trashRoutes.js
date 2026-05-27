import express from "express"
import checkAuth from "../middleware/authMiddleware.js";
import { getAllTrashItems,recoverTrashFile,recoverTrashDirectory} from "../controllers/trashController.js";
import validateMiddleware from "../middleware/validateMiddleware.js";

const router=express.Router();

router.param("fileId",validateMiddleware);
router.param("dirId",validateMiddleware);

router.get("/content",checkAuth,getAllTrashItems);
router.patch("/restore/file/:fileId",checkAuth,recoverTrashFile);
router.patch("/restore/directory/:dirId",checkAuth,recoverTrashDirectory);

export default router;