import Directory from "../models/directoryModel.js";
import File from "../models/fileModel.js";
import crypto from "node:crypto";
import s3Client from "../config/s3.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {GetObjectCommand,} from "@aws-sdk/client-s3";
import { createCloudFrontSignedUrl } from "../service/cloudfront.js";


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
      publicUrl: `${process.env.FRONTEND_URL}/share/${resourceType}/${token}`,
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
const key = `${fileData._id}${fileData.extension}`;
const disposition = type == "download" ? `attachment; filename="${encodeURIComponent(fileData.name)}"` : `inline; filename="${encodeURIComponent(fileData.name)}"`;
const url = type === "download"
        ? await getSignedUrl(
            s3Client,
            new GetObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: key,
              ResponseContentDisposition: disposition,
              ResponseContentType:
                fileData.contentType || "application/octet-stream",
            }),
            { expiresIn: 60 * 60 },
          )
        : createCloudFrontSignedUrl(key, {
            "response-content-disposition": disposition,
            "response-content-type":
              fileData.contentType || "application/octet-stream",
          });

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

const fileData=await File.findOne({_id:fileId,parentDirId:directoryData._id});
if (!fileData) {
  return res.status(403).json({
    message: "File does not belong to the shared directory",
  });
}

const key = `${fileData._id}${fileData.extension}`;
const disposition = type == "download" ? `attachment; filename="${encodeURIComponent(fileData.name)}"` : `inline; filename="${encodeURIComponent(fileData.name)}"`;
const url = type === "download"
        ? await getSignedUrl(
            s3Client,
            new GetObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: key,
              ResponseContentDisposition: disposition,
              ResponseContentType:
                fileData.contentType || "application/octet-stream",
            }),
            { expiresIn: 60 * 60 },
          )
        : createCloudFrontSignedUrl(key, {
            "response-content-disposition": disposition,
            "response-content-type":
              fileData.contentType || "application/octet-stream",
          });

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

}