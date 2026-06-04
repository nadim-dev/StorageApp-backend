import express from "express"
import checkAuth, { allowRoles }  from "../middleware/authMiddleware.js"  
import { register,login, getCurrrentUser, logout, logoutall,getAllUser,forceLogout,softDelete,HardDelete,getDeleteUsers,recoverUser,assignRole, searchUsers} from "../controllers/userController.js";
import { getUserProfile,updatePassword,updateUserProfile,userResources,viewDocument,accessNestedResources,storageUsed,accessSterredResources} from "../controllers/userController.js";
import { uploadSingleImage } from "../middleware/multer.js";
import { deleteFile, getFile, renameFile } from "../controllers/fileController.js";
import { deleteDirectory, renameDirectory } from "../controllers/directoryController.js";
import validateMiddleware from "../middleware/validateMiddleware.js";
import { loginRateLimiter, registerRateLimiter } from "../middleware/rateLimiter.js";
import throttle from "../middleware/throttleMiddleware.js";
const router=express.Router();

["id","userId","fileId","folderId"].forEach(param=>{
  router.param(param, validateMiddleware);
});

//* register user functionality
router.post(
  "/register",
  registerRateLimiter,
  throttle({
    waitTime: 1000,
    allowed: 2,
    windowMs: 60 * 1000,
    routeName: "register",
  }),
  register
)


//* login user  
router.post(
  "/login",
  loginRateLimiter,
  throttle({
    waitTime: 800,
    allowed: 3,
    windowMs: 60 * 1000,
    routeName: "login",
  }),
  login
);

//* extracting information of current user

router.get("/currentUser",checkAuth,getCurrrentUser);


//* logout user functionality

router.post("/logout",logout);

//* log out from  all device

router.post("/logoutall",checkAuth,logoutall);

//* accessing all users

router.get("/",checkAuth,allowRoles("Admin","Manager","Owner"),getAllUser);

//* logout user by admin and Manager

router.post("/:id",checkAuth,allowRoles("Admin","Manager","Owner"),forceLogout)
 
//* soft delete user by admin and Manager

router.delete("/softdelete/:id",checkAuth,allowRoles("Admin","Owner"),softDelete);

//* hard delete user by admin and Manager

router.delete("/harddelete/:id",checkAuth,allowRoles("Admin","Owner"),HardDelete);

//*  accessing all delete users by owner

router.get("/trash",checkAuth,allowRoles("Owner"),getDeleteUsers);

//*  recovering solft delete user

router.patch("/recover/:id",checkAuth,allowRoles("Owner"),recoverUser)

//*  assigning role to the user

router.patch("/role/:id",checkAuth,allowRoles("Owner","Admin","Manager"),assignRole)

//* get user profile function

router.get("/profile",checkAuth,getUserProfile);

//* update user password

router.patch("/password",checkAuth,updatePassword)

//* update user profile

router.patch("/profile",checkAuth,uploadSingleImage("avatar"),updateUserProfile);

//* accessing user resources

router.get("/:userId/resources",checkAuth,allowRoles("Owner","Admin"),userResources)

//* admin and owner can view and download users document through a single endpoint
router.get("/:userId/resources/:fileId/items",checkAuth,allowRoles("Owner","Admin"),getFile);


//* admin and owner can view nested documents

router.get("/:folderId/nested-resources",checkAuth,allowRoles("Admin","Owner"),accessNestedResources)



//* admin and owner can delete user file

router.delete("/:userId/delete/file/:fileId",checkAuth,allowRoles("Admin","Owner"),deleteFile);

//* admin and owner can delete user directory

router.delete("/:userId/delete/folder/:folderId",checkAuth,allowRoles("Admin","Owner"),deleteDirectory);

//* admin and owner can rename user directory

router.patch("/:userId/rename/folder/:folderId",checkAuth,allowRoles("Admin","Owner"),renameDirectory);

//* admin and owner can rename file directory

router.patch("/:userId/rename/file/:fileId",checkAuth,allowRoles("Admin","Owner"),renameFile);


//* determining  storage use by user

router.get("/storage",checkAuth,storageUsed);

//* accessing all the starred resource of user;

router.get("/starred",checkAuth,accessSterredResources);

//* search user
router.get("/search",checkAuth,searchUsers);

export default router;
