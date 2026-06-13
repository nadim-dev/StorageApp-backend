import Directory from "../models/directoryModel.js";
import File from "../models/fileModel.js";
import User from "../models/userModel.js";
import crypto from "node:crypto";
import s3Client from "../config/s3.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { createCloudFrontSignedUrl } from "../service/cloudfront.js";
import Share from "../models/shareModel.js";
import { getSignedURL } from "../helper/getSignedURL.js";
import { contentType } from "mime-types";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { success } from "zod";



const isDescendant = async (
  folderId,
  rootFolderId
) => {
  let currentId = folderId;

  while (currentId) {
    if (currentId.toString() === rootFolderId.toString())
      return true;
    const folder =await Directory.findById(currentId).select("parentDirId");

    if (!folder) 
      return false;


    currentId = folder.parentDirId;
  }

  return false;
};

const getSharedPermission = async (
  resourceId,
  resourceType,
  userId
) => {
  let current;

  if (resourceType === "directory") {
    current = await Directory.findById(resourceId)
      .select("_id parentDirId")
      .lean();

    if (!current) {
      return null;
    }
  } else {
    const file = await File.findById(resourceId)
      .select("parentDirId")
      .lean();

    if (!file) {
      return null;
    }

    current = await Directory.findById(file.parentDirId)
      .select("_id parentDirId")
      .lean();
  }

  while (current) {
    const share = await Share.findOne({
      resourceId: current._id,
      sharedWith: userId
    })
      .select("permission")
      .lean();

    if (share) {
      return share.permission;
    }

    if (!current.parentDirId) {
      break;
    }

    current = await Directory.findById(current.parentDirId)
      .select("_id parentDirId")
      .lean();
  }

  return null;
};

export const createPublicLink = async (req, res) => {
  const { resourceId, resourceType } = req.body;
  console.log("resourceId", resourceId);
  console.log("resourceType", resourceType);

  try {
    if (!resourceId || !resourceType)
      return res
        .status(400)
        .json({ message: "resourceId and resourceType are required" });

    if (resourceType !== "file" && resourceType !== "directory")
      return res.status(400).json({ message: "Invalid resourceType" });

    let resource;

    if (resourceType === "file") resource = await File.findById(resourceId);
    else resource = await Directory.findById(resourceId);

    if (!resource)
      return res.status(404).json({ message: `${resourceType} not found` });
    
    //*  Ownership check
    if (resource.userId.toString() !== req.user._id)
      return res.status(403).json({ message: "Access denied" });

    //*  Existing public link
    if (resource.linkSharing?.enabled && resource.linkSharing?.token)
      return res
        .status(200)
        .json({
          publicUrl: `${process.env.FRONTEND_URL}/share/${resourceType}/${resource.linkSharing.token}`,
        });

    const token = crypto.randomBytes(32).toString("hex");

    resource.linkSharing = {
      enabled: true,
      token,
      role: "viewer",
    };

    await resource.save();

    return res.status(200).json({
      publicUrl: `https://cloudnest-frontend.netlify.app/share/${resourceType}/${token}`,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const fetchSharedResources = async (req, res) => {
  console.log("fetchSharedResource is running");
  const { resourceType, token } = req.params;
  console.log("resourceIdTOKEN", token);
  console.log("resource ka type", resourceType);

  try {
    if (resourceType == "file") {
      const file = await File.findOne({
        "linkSharing.token": token,
        "linkSharing.enabled": true,
      }).lean("name extension size contentType");
      console.log("file", file);

      if (!file) {
        return res
          .status(404)
          .json({ message: "File not found or link is disabled" });
      }

      return res.status(200).json({
        type: "file",
        id: file._id,
        name: file.name,
        extension: file.extension,
        size: file.size,
        contentType: file.contentType,
      });
    } else if (resourceType == "directory") {
      const directory = await Directory.findOne({
        "linkSharing.token": token,
        "linkSharing.enabled": true,
      }).lean();
      console.log("directory", directory);

      if (!directory) {
        return res
          .status(404)
          .json({ message: "Directory not found or link is disabled" });
      }

      // Fetch all children (files and subdirectories)
      const childFiles = await File.find({
        parentDirId: directory._id,
        isDeleted: false,
      }).lean("name extension size createdAt updatedAt");

      const childDirs = await Directory.find({
        parentDirId: directory._id,
        isDeleted: false,
      }).lean("name size createdAt");

      // Format children array
      const children = [
        ...childFiles.map((file) => ({
          id: file._id,
          name: file.name,
          type: "file",
          extension: file.extension || "",
          size: file.size,
          createdAt: file.createdAt,
          modifiedAt: file.updatedAt,
        })),
        ...childDirs.map((dir) => ({
          id: dir._id,
          name: dir.name,
          type: "directory",
          extension: "",
          size: dir.size,
          createdAt: dir.createdAt,
        })),
      ];

      return res.status(200).json({
        type: "directory",
        id: directory._id,
        name: directory.name,
        size: directory.size,
        createdAt: directory.createdAt,
        children: children,
      });
    } else {
      return res.status(400).json({ message: "Invalid resourceType" });
    }
  } catch (error) {
    console.error("Error fetching shared resources:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const viewShareWithMeFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    const { action: type } = req.query;

    const permission = await getSharedPermission(
      fileId,
      "file",
      req.user._id
    );

    if (!permission) {
      return res.status(403).json({
        message: "Access denied"
      });
    }

    const file = await File.findById(fileId)
      .select("name extension contentType")
      .lean();

    if (!file) {
      return res.status(404).json({
        message: "File not found"
      });
    }

    const url = await getSignedURL(
      file,
      type
    );

    return res.status(200).json({ url });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      message: "Failed to view file"
    });
  }
};


export const viewSharedResources=async (req,res)=>{
  console.log("viewSharedResource function is running");

  const {token}=req.params;
  const { action: type } = req.query;
  console.log("req ka query",req.query);
  console.log("token",token);
  try{
  const fileData=await File.findOne({
  "linkSharing.token": token,
  "linkSharing.enabled": true,
  isDeleted: false,
  }).lean();

if(!fileData)
  return res.status(404).json({"message":"file dosen't exist"})

console.log("fileData",fileData);
const url=await getSignedURL(fileData,type);

  return res.status(200).json({"url":url});
}catch(err){
  console.log(err.message);
  return res.status(500).json({"message":"Internal Server Error"})
}
}


export const viewSharedDirectoryFile=async (req,res)=>{
  console.log("viewSharedDirectoryFile function is running");

  const {token,fileId}=req.params;
  const { action: type } = req.query;
  console.log("req ka query",req.query);
  console.log("token",token);
  try{
  const directoryData=await Directory.findOne({
  "linkSharing.token": token,
  "linkSharing.enabled": true,
  isDeleted: false,
  }).lean();

if(!directoryData)
  return res.status(404).json({"message":"directory dosen't exist"})

const fileData=await File.findById(fileId);

if (!fileData) {
  return res.status(403).json({
    message: "File does not belong to the shared directory",
  });
}

const allowed =await isDescendant(fileData.parentDirId,directoryData._id);

if (!allowed) {
  return res.status(403).json({
    message: "Access denied",
  });
}

const url=await getSignedURL(fileData,type);
return res.status(200).json({"url":url});
}catch(err){
  console.log(err.message);
  return res.status(500).json({"message":"Internal Server Error"})
}
}

export const fetchSharedNestedDirectoryItem=async (req,res)=>{
  console.log("fetchSharedNestedDirectoryItem function is running");
  const {token,dirId}=req.params;
  const directoryData=await Directory.findOne({
    "linkSharing.token": token,
    "linkSharing.enabled": true,
    isDeleted: false,
  }).lean();
  if(!directoryData)
    return res.status(404).json({"message":"Directory dosen't exist"});
 const directory=await Directory.findOne({_id:dirId,parentDirId:directoryData._id});
 if (!directory) {
  return res.status(403).json({
    message: "directory does not belong to the shared directory",
  });
}

     //* Fetch all children (files and subdirectories)
      const childFiles = await File.find({
        parentDirId: directory._id,
        isDeleted: false,
      }).lean("name extension size createdAt updatedAt");

      const childDirs = await Directory.find({
        parentDirId: directory._id,
        isDeleted: false,
      }).lean("name size createdAt");

      // Format children array
      const children = [
        ...childFiles.map((file) => ({
          id: file._id,
          name: file.name,
          type: "file",
          extension: file.extension || "",
          size: file.size,
          createdAt: file.createdAt,
          modifiedAt: file.updatedAt,
        })),
        ...childDirs.map((dir) => ({
          id: dir._id,
          name: dir.name,
          type: "directory",
          extension: "",
          size: dir.size,
          createdAt: dir.createdAt,
        })),
      ];

      return res.status(200).json({
        type: "directory",
        id: directory._id,
        name: directory.name,
        size: directory.size,
        createdAt: directory.createdAt,
        children: children,
      });

}

export const storeSharedResourcedata=async (req,res)=>{
  console.log("Store shared resource controller is running");
  const {resourceId,resourceType,sharedWith,permission}=req.body;
  if (!resourceId ||!resourceType ||!sharedWith?.length)
      return res.status(400).json({success: false,message: "Missing required fields"});
    
  try{
    let resource;
    if (resourceType === "file")
      resource=await File.findById(resourceId);
    else if (resourceType === "directory")
      resource=await Directory.findById(resourceId);
    else 
      return res.status(400).json({message: "Invalid resource type"});
    

    if (!resource) 
      return res.status(404).json({message: "Resource not found"});

     if (!resource.userId.equals(req.user._id)) 
      return res.status(403).json({message: "You are not allowed to share this resource"})

     
  
    const shareDocs=sharedWith.map((userId)=>(
    {
      resourceId,
      resourceType,
      ownerId: req.user._id,
      sharedWith: userId,
      permission,
      resourceName: resource.name,
      extension: resource.extension || null,
      contentType:resource.contentType || null,
      size:resource.size,
    })
    )

      const results = await Promise.allSettled(
      shareDocs.map((doc) =>
        Share.updateOne(
          {
            resourceId: doc.resourceId,
            sharedWith: doc.sharedWith
          },
          {
            $set: doc
          },
          {
            upsert: true
          }
        )
      )
    );

    
  return res.status(200).json({"message":"file is shared successfully"});
}catch(err){
  console.error("shareResource error:", err);
  return res.status(500).json({message: "Failed to share resource"});
}
}


export const getSharedWithMe = async (req, res) => {
  try {
    const shares = await Share.find({sharedWith: req.user._id})
      .populate(
        "ownerId",
        "username email profilePictureUrl"
      )
      .sort({
        createdAt: -1
      })
      .lean();

    return res.status(200).json({
      success: true,
      data: shares
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch shared resources"
    });
  }
};

export const fetchSharedFileWithMe = async (req, res) => {
  try {
    const shareResources = await Share.find({
      sharedWith: req.user._id
    })
      .populate(
        "ownerId",
        "name email profilePictureUrl"
      )
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      data: shareResources
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch shared resources"
    });
  }
};

export const renameShareWithMeFile = async (req, res) => {
  try {
    console.log("rename share with me file is running");

    const { resourceId } = req.params;
    const { renameType, renameValue } = req.body;

    const permission = await getSharedPermission(
      resourceId,
      renameType,
      req.user._id
    );

    if (permission !== "editor") {
      return res.status(403).json({
        message: "Access denied"
      });
    }

    const Model =
      renameType === "file"
        ? File
        : Directory;

    const updatedResource =
      await Model.findByIdAndUpdate(
        resourceId,
        {
          $set: {
            name: renameValue
          }
        },
        {
          new: true
        }
      );

    if (!updatedResource) {
      return res.status(404).json({
        message: "Resource not found"
      });
    }

    // Optional:
    // If you store resourceName in Share collection
    // keep Share documents in sync

    await Share.updateMany(
      { resourceId },
      {
        $set: {
          resourceName: renameValue
        }
      }
    );

    return res.status(200).json({
      message: "Resource renamed successfully"
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      message: "Internal server error"
    });
  }
};

export const viewShareWithMeDirectory = async (req, res) => {
  console.log("viewShareWithMeDirectory",req.params);
  const { dirId:directoryId } = req.params;

  try {
    let current = await Directory.findById(directoryId)
      .select("_id parentDirId")
      .lean();

    console.log("current before while loop",current);


    if (!current) {
      return res.status(404).json({
        message: "Directory not found"
      });
    }

    let hasAccess = false;
    let permission="viewer";

    while (current) {
      const share = await Share.findOne({
        resourceId: current._id,
        sharedWith: req.user._id
      }).select("permission").lean();

      console.log("share",share);
      if (share) {
        hasAccess = true;
        permission=share.permission;
        break;
      }

      if (!current.parentDirId) break;

      current = await Directory.findById(current.parentDirId)
        .select("_id parentDirId")
        .lean();
    }
    console.log("current",current);

    if (!hasAccess) {
      return res.status(403).json({
        message: "Access denied"
      });
    }

    const [directories, files] = await Promise.all([
      Directory.find({ parentDirId: directoryId }).lean(),
      File.find({ parentDirId: directoryId }).lean()
    ]);

    const updatedDirectories = directories.map(dir => ({
  ...dir,
  permission,
  type:"directory"
}));

const updatedFiles = files.map(file => ({
  ...file,
  permission,
  type:"file"
}));

    return res.status(200).json([
      ...updatedDirectories,
      ...updatedFiles
    ]);

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      message: "Failed to fetch directory"
    });
  }
};


export const getSharedByMe = async (req, res) => {
  try {
    const userId = req.user._id;

    const sharedResources = await Share.aggregate([
      {
        $match: {
          ownerId: new mongoose.Types.ObjectId(userId),
        },
      },
      {
        $group: {
          _id: "$resourceId",

          resourceName: {
            $first: "$resourceName",
          },

          resourceType: {
            $first: "$resourceType",
          },

          extension: {
            $first: "$extension",
          },

          contentType: {
            $first: "$contentType",
          },

          shareDate: {
            $first: "$shareDate",
          },

          totalSharedUsers: {
            $sum: 1,
          },

          editorCount: {
            $sum: {
              $cond: [
                { $eq: ["$permission", "editor"] },
                1,
                0,
              ],
            },
          },

          sharedUsers: {
            $push: "$sharedWith",
          },
        },
      },

      {
        $lookup: {
          from: User.collection.name,
          localField: "sharedUsers",
          foreignField: "_id",
          as: "sharedUsers",
        },
      },

      {
        $project: {
          resourceName: 1,
          resourceType: 1,
          extension: 1,
          contentType: 1,
          shareDate: 1,
          totalSharedUsers: 1,
          editorCount: 1,

          sharedUsers: {
            $map: {
              input: { $slice: ["$sharedUsers", 3] }, // first 3 users only
              as: "user",
              in: {
                _id: "$$user._id",
                name: "$$user.name",
                email: "$$user.email",
                profilePictureUrl: "$$user.profilePictureUrl",
              },
            },
          },
        },
      },

      {
        $sort: {
          shareDate: -1,
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      data: sharedResources,
    });
  } catch (error) {
    console.error("Error fetching shared resources:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong",
    });
  }
};

export const stopSharingResources = async (req, res) => {
  try {
    console.log("Stop sharing resource function is running");
    const { resourceId } = req.params;
    if(!resourceId)
      return res.status(400).json({ message:"Resource id is required"});

    const result = await Share.deleteMany({
      resourceId,
      ownerId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Sharing stopped successfully",
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

export const getResourceAccess=async (req,res)=>{
 console.log("get Resource Access function is running");
 const {resourceId}=req.params;
 console.log("resoueceId",resourceId);
 const user=await Share.find({resourceId,ownerId:req.user._id}).populate("sharedWith","name email profilePictureUrl").select("_id permission").lean();
 return res.status(200).json({user});
}

export const removeUserAccess=async (req,res)=>{
  console.log("Remove user access function is running");
  const {resourceId}=req.params;
  const {removeAccessIds,permissionUpdates}=req.body;
  console.log("removeAccessIds",removeAccessIds);
  console.log("permissionUpdates",permissionUpdates);
  if(!removeAccessIds.length && !permissionUpdates.length)
    return res.status(400).json({success: false,message: "No access changes provided"});
  try{
  if (removeAccessIds.length){
    await Share.deleteMany({
      ownerId:req.user._id,
      resourceId,
      _id:{$in:removeAccessIds}
    })
  }

  for (const item of permissionUpdates) {
  await Share.findByIdAndUpdate(
    item.accessId,
    {
      permission: item.permission,
    }
  );
}

  return res.status(200).json({success:true,message:"access updated successfully"})
  }catch(err){
    console.log(err.message);
    return res.status(500).json({"message":"Internal Server Error"});
  }


}