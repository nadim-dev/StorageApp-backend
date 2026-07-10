import { rm } from "fs/promises";
import { createWriteStream } from "fs";
import path from "node:path";
import mongoose from "mongoose";
import File from "../models/fileModel.js";
import Recent from "../models/recentModal.js";
import Directory from "../models/directoryModel.js";
import { nameSchema } from "../validators/commonValidator.js";
import { sanitize } from "../utils/sanitize.js";
import { updateDirectorySize } from "../helper/updateDirectorySize.js";
import User from "../models/userModel.js";
import {DeleteObjectCommand,GetObjectCommand,PutObjectCommand} from "@aws-sdk/client-s3";
import s3Client from "../config/s3.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createCloudFrontSignedUrl } from "../service/cloudfront.js";
import Subcribe from "../models/subscriptionModel.js";

export const temporaryDeleteFile = async (req, res) => {
  console.log("Temporary delete  function is running");
  try {
    const { fileId } = req.params;
    if (!fileId) return res.status(400).json({ message: "FileId is required" });

    const file = await File.findByIdAndUpdate(
      fileId,
      { isDeleted: true, deletedAt: new Date() },
      { new: true },
    );

    if (!file) return res.status(404).json({ message: "file not found" });

    await updateDirectorySize(file.parentDirId, -file.size);

    //* mark the file is soft delete in Recent documents
    await Recent.updateOne(
      {
        userId: req.user._id,
        itemId: fileId,
      },
      {
        isDeleted: true,
      },
    );

    return res.status(200).json({
      message: "file deleted temporarily",
      fileId: file._id.toString(),
    });
  } catch (err) {
    console.log(err.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const recentFileItems = async (req, res) => {
  console.log("recent File Items function is running");
  try {
    const FilesList = await Recent.find({
      isDeleted: false,
      userId: req.user._id,
    })
      .sort({ lastAccessedAt: -1 })
      .limit(10)
      .select("itemId lastAccessedAt size name itemType -_id")
      .lean();

    const formattedFiles = FilesList.map((item) => ({
      _id: item.itemId,
      lastAccessedAt: item.lastAccessedAt,
      size: item.size,
      name: item.name,
      itemType: item.itemType,
    }));
    return res.status(200).json(formattedFiles);
  } catch (err) {
    console.log(err);
  }
};

export const unStarredFile = async (req, res) => {
  console.log("Unstarred file function is running");
  const { fileId } = req.params;
  await File.findByIdAndUpdate(fileId, { starred: false });
  return res.status(200).json({ message: "File unstarred successfully" });
};

export const getFile = async (req, res) => {
  console.log("get file function is running");
  const { userId, fileId } = req.params;
  const query = { _id: fileId };
  const { action: type } = req.query; //* download or view
  const loggedInUser = req.user;
  if (loggedInUser.role == "Admin" || loggedInUser.role == "Owner") {
    if (!userId) {
      query.userId = loggedInUser._id.toString();
    } else {
      query.userId = userId;
    }
  } else {
    query.userId = loggedInUser._id;
  }

  //? soft delete by admin
  if (loggedInUser.deleted) {
    return res
      .status(403)
      .json({ error: "your account has been terminated by admin" });
  }


  try {
    const fileData = await File.findOne(query);
    //* check file exist or not
    if (!fileData) return res.status(404).json({ error: "File not found!" });
    //* if file is present then only update feild otherwise insert whole document by combining attributes of filter and and update
    fileData.lastAccessedAt=new Date();
    await fileData.save();
    await Recent.findOneAndUpdate(
      {
        userId: loggedInUser._id,
        itemId: fileId,
      },
      {
        $set: {
          itemType: "file",
          isDeleted: false,
          size: fileData.size,
          name: fileData.name,
          lastAccessedAt: new Date(),
        },
      },
      {
        upsert: true,
        new: true,
      },
    );

    const key = `${fileData._id}${fileData.extension}`;
    const disposition =
      type == "download"
        ? `attachment; filename="${encodeURIComponent(fileData.name)}"`
        : `inline; filename="${encodeURIComponent(fileData.name)}"`;
    const url =
      type === "download"
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

    return res.json({ url });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Error generating URL" });
  }
};

const permanentlyDeleteFile = async (fileQuery) => {
  const fileData = await File.findOne(fileQuery)
    .select("_id extension parentDirId size isDeleted")
    .lean();

  if (!fileData) return null;

  const command = new DeleteObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: `${fileData._id}${fileData.extension}`,
  });

  await s3Client.send(command);
  await File.deleteOne(fileQuery);
  await Recent.deleteMany({ itemId: fileData._id });

  if (!fileData.isDeleted) {
    await updateDirectorySize(fileData.parentDirId, -fileData.size);
  }

  return fileData;
};


export const deleteFile = async (req, res) => {
  console.log("delete function is running");
  console.log(req.params);
  const { userId, fileId } = req.params;

  const loggedInUser = req.user; // admin or user

  try {
    let fileQuery = { _id: fileId };

    // 👤 If USER → can delete only own file
    if (loggedInUser.role === "User") {
      fileQuery.userId = loggedInUser._id;
    }

    // 👑 If ADMIN → can delete any user's file
    if (loggedInUser.role === "Admin" || loggedInUser.role === "Owner") {
      if (!userId) {
        fileQuery.userId = loggedInUser._id;
      } else {
        fileQuery.userId = userId;
      }
    }

    await permanentlyDeleteFile(fileQuery);


    return res.status(200).json({ message: "File deleted successfully" });

  } catch (err) {
    console.log(err.message);
    return res.status(500).json({ message: err.message });
  }
};

export const renameFile = async (req, res) => {
  console.log("patch function is running");
  const { userId, fileId } = req.params;
  const query = { _id: fileId };
  const { data, success, error } = nameSchema.safeParse(req.body);
  if (!success) {
    console.log("error ka issue", error.issues);
    return res.status(400).json({ error: "Invalid credential" });
  }
  const { name: newFilename } = sanitize(data);
  const loggedInUser = req.user;
  console.log("loggedInUser", loggedInUser);
  console.log("loggedInUser", loggedInUser._id);
  if (loggedInUser.role == "Admin" || loggedInUser.role == "Owner") {
    if (!userId) {
      query.userId = loggedInUser._id;
    } else {
      query.userId = userId;
    }
  } else {
    query.userId = loggedInUser._id;
  }

  try {
    console.log("query", query);
    const updatedFile = await File.findOneAndUpdate(
      query,
      { name: newFilename.trim() }, // no need for $set in mongoose
      {
        upsert: true,
        new: true, // return updated document
      },
    );

    if (!updatedFile)
      return res.status(404).json({ messsage: "File not found" });

    console.log("updateFile", updatedFile);

    await Recent.findOneAndUpdate(
      { itemId: fileId, isDeleted: false },
      { name: newFilename.trim() },
    );

    return res.status(200).json({ message: "ranamed successfully" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const handleStar = async (req, res) => {
  console.log("Handle star function is running");
  console.log(req.params.id);
  const { starred } = req.body;
  try {
    await File.findByIdAndUpdate(req.params.id, { starred });

    res.json({ success: true });
  } catch (err) {
    console.log(err.message);
  }
};

//* generate Signed URL

export const generateSignedURL = async (req, res) => {
  console.log("generate sign url function is running");

  let { name, parentDirId, contentType, size, hash } = req.body;
  let plan;

  if (!name || size <= 0) {
    return res.status(400).json({ message: "invalid input" });
  }

  const extension = path.extname(name);
  console.log("Content-Type", contentType);
  console.log(req.body);
  if (!parentDirId) {
    parentDirId = req.user.rootDirId;
  }
  if (!contentType) {
    contentType = "application/octet-stream";
  }

  //* checking available storage quota of user
  const [userData, dirData] = await Promise.all([
    User.findById(req.user._id).select("maxStorageInBytes").lean(),
    Directory.findById(req.user.rootDirId).select("size").lean(),
  ]);

  if (dirData.size > userData.maxStorageInBytes) {
    return res.status(403).json({
      message:
        "Storage limit exceeded. Please upgrade your subscription to continue uploading files.",
    });
  }

  const availableStorage = userData?.maxStorageInBytes - dirData.size;

  if (size > availableStorage) {
    return res.status(413).json({ message: "Payload Too Large" });
  }

  if (dirData.size + size <= 1073741824) plan = "freeTier";
  else plan = "paidTier";

  try {
    const fileData = await File.insertOne({
      name,
      size,
      parentDirId,
      contentType,
      isUploading: true,
      userId: req.user._id,
      extension,
      plan,
      hash,
    });

    console.log("fileData", fileData);

    // ✅ generate unique key (VERY IMPORTANT)
    const key = `${fileData._id}${extension}`;

    // ✅ create S3 command
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    });

    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 60, // 1 minute
    });

    return res.status(200).json({
      uploadUrl: signedUrl,
      fileId: fileData._id,
    });
  } catch (err) {
    console.log(err.message);
  }
};

export const markUploadComplete = async (req, res) => {
  console.log("mark upload function is running");
  const { fileId } = req.body;
  if (!fileId) {
    return res.status(400).json({ message: "fileId is required" });
  }

  try {
    const fileData = await File.findOne({ _id: fileId }).lean();
    if (!fileData) return res.status(404).json({ message: "File not found" });

    await File.findOneAndUpdate(
      { _id: fileId, isUploading: true },
      { $set: { isUploading: false } },
    );
    await updateDirectorySize(fileData.parentDirId, fileData.size);
    return res.status(200).json({ message: "File uploaded successfully" });
  } catch (err) {
    console.log(err.message);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const markUploadFail = async (req, res) => {
  console.log("fail upload function is running");
  const { fileId } = req.body;
  if (!fileId) {
    return res.status(400).json({ message: "fileId is required" });
  }
  try {
    const fileData = await File.findById(fileId).lean();

    if (!fileData) {
      return res.status(404).json({ message: "File not found" });
    }

    //* delete DB record
    await File.deleteOne({ _id: fileId });
    return res.status(200).json({
      message: "Upload failed cleaned successfully",
    });
  } catch (err) {
    console.log(err.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getDuplicateFiles = async (req, res) => {
  console.log("Duplicate file function is running");
  
  try {
    const userId = new mongoose.Types.ObjectId(req.user._id);

    const duplicateGroups = await File.aggregate([
      {
        $match: {
          userId,
          isUploading: false,
          isDeleted: false,
          status: "active",
          hash: {
            $exists: true,
            $ne: null,
          },
        },
      },

      {
        $lookup: {
          from: "directories",
          localField: "parentDirId",
          foreignField: "_id",
          as: "parentDirectory",
        },
      },

      {
        $addFields: {
          parentDirectoryName: {
            $ifNull: [{ $arrayElemAt: ["$parentDirectory.name", 0] }, null],
          },
        },
      },

      {
        $group: {
          _id: "$hash",

          files: {
            $push: {
              _id: "$_id",
              name: "$name",
              size: "$size",
              extension: "$extension",
              parentDirectoryName: "$parentDirectoryName",
              updatedAt: "$updatedAt",
            },
          },

          count: {
            $sum: 1,
          },

          totalSize: {
            $sum: "$size",
          },

          fileSize: {
            $first: "$size",
          },
        },
      },

      {
        $match: {
          count: {
            $gt: 1,
          },
        },
      },

      {
        $addFields: {
          recoverableSpace: {
            $subtract: ["$totalSize", "$fileSize"],
          },
        },
      },

      {
        $sort: {
          recoverableSpace: -1,
          count: -1,
        },
      },
    ]);

    const totalRecoverableSpace = duplicateGroups.reduce(
      (sum, group) => sum + group.recoverableSpace,
      0,
    );

    return res.json({
      duplicateGroups,
      totalRecoverableSpace,
    });
  } catch (err) {
    console.log(err.message);
    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};


export const moveAllDuplicatesInTrash=async (req,res)=>{
  console.log("move all duplicate function is running");
  const fileIds = req.body?.data?.fileIds ?? req.body?.fileIds;
  if (!Array.isArray(fileIds) || fileIds.length === 0)
    return res.status(400).json({message: "fileIds is required" });
  try{
  await File.updateMany(
  {
    _id: { $in: fileIds }
  },
  {
    $set: {
      isDeleted: true
    }
  }
);

  return res.json({"message":"file is moved to the trash"});
  }catch(err){
    console.log(err.message);
    return res.status(500).json({"message":"Internal Server Error"});
  }
}

export const deleteAllDuplicateFiles=async (req,res)=>{
  console.log("delete all duplicates file is running");
  const fileIds = req.body?.fileIds;
  console.log("fileIds",fileIds);
  if (!fileIds || fileIds.length === 0)
    return res.status(400).json({message: "fileIds is required" });
  try{
    await Promise.all(
      fileIds.map((fileId) =>
        permanentlyDeleteFile({ userId: req.user._id, _id: fileId }),
      ),
    );

    return res.status(200).json({
      message: "deleted duplicated file successfully",
    });
  }catch(err){
    console.log(err.message);
    return res.status(500).json({"message":"Internal Server Error"})
  }
}

export const oldResourceSummary=async (userId)=>{
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  
  const filesList = await File.find({
    userId: userId,
    isDeleted: false,
    lastAccessedAt: { $lte: oneYearAgo },
  }).select("extension size name updatedAt lastAccessedAt").lean();
  const totalSize = filesList.reduce((sum, file) => {
    return sum + file.size;
}, 0);
return {filesList,totalSize}
}

export const fetchAllOldResources=async (req,res)=>{
  console.log("fetch all old resources controller is running");
  try{
  const {filesList,totalSize}=await oldResourceSummary(req.user._id);
  console.log("fileList",filesList);
  console.log("totalSize",totalSize);
  return res.status(200).json({summary:{totalFiles:filesList.length,removableSize:totalSize},"oldFilesList":filesList})
  }catch(err){
       console.log(err.message);
       return res.status(500).json({"message":"Internal Server Error"});
  }
}

export const fetchLargeFiles=async (req,res)=>{
  console.log("fetch large files is running");
  try{
  const largeFileList=await File.find({userId:req.user._id,size:{$gte:500*1024*1024}}).select("name extension size updatedAt").lean();
  return res.status(200).json({largeFileList});
  }catch(err){
       console.log(err.message);
       return res.status(500).json({"message":"Internal Server Error"});
  }
}