import { rm } from "fs/promises";
import Directory from "../models/directoryModel.js";
import File from "../models/fileModel.js";
import { nameSchema } from "../validators/commonValidator.js";
import { sanitize } from "../utils/sanitize.js";
import { updateDirectorySize } from "../helper/updateDirectorySize.js";
import { getDirectoryContents } from "../helper/getDirectoryContents.js";
import s3Client from "../config/s3.js";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";

export const deleteDirectory = async (req, res) => {
  console.log("delete Directory function is running");
  const { userId, folderId } = req.params;
  console.log("folderId", folderId);
  const loggedInUser = req.user;
  const query = { _id: folderId };
  if (loggedInUser.role == "Admin" || loggedInUser.role == "Owner") {
    if (!userId) query.userId = loggedInUser._id;
    else query.userId = userId;
  } else {
    query.userId = loggedInUser._id;
  }

  try {
    const directoryData = await Directory.findOne(query).lean();
    console.log("directoryData", directoryData);
    if (!directoryData)
      return res.status(404).json({ error: "parent Directory not found" });

    const { filesId: files, directoriesId: directories } =
      await getDirectoryContents(folderId);
    console.log("final files", files);
    console.log("final directories", directories);

    if (files.length > 0) {
      const deleteParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Delete: {
          Objects: files.map(({ _id, extension }) => ({
            Key: `${_id.toString()}${extension}`,
          })),
        },
      };

      await s3Client.send(new DeleteObjectsCommand(deleteParams));
    }
    await File.deleteMany({ _id: { $in: files.map(({ _id }) => _id) } });
    await Directory.deleteMany({
      _id: { $in: [...directories.map(({ _id }) => _id), folderId] },
    });
    return res.status(200).json({ message: "directory deleted successfully" });
  } catch (err) {
    console.log(err);
    return res.status(400).json({ message: err.message });
  }
};

export const getDirectoryById = async (req, res) => {
  console.log("directory function is running");
  const db = req.db;
  const user = req.user;
  //? soft delete by admin note (if you are logging out user instantly then no need to write this code here)
  if (user.deleted)
    return res
      .status(403)
      .json({ error: "your account has been terminated by admin" });

  let id = req.params.id || user.rootDirId.toString();

  try {
    const directoryData = await Directory.findById(id).lean();

    if (!directoryData) {
      return res
        .status(404)
        .json({ error: "Directory not found or you dont have access to it" });
    }

    //start transaction()

    const directories = await Directory.find({
      parentDirId: id,
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .lean();
    const files = await File.find({
      parentDirId: id,
      isDeleted: false,
      isUploading: false,
    })
      .sort({ createdAt: -1 })
      .lean();
    return res
      .status(200)
      .json({
        ...directoryData,
        files: files.map((file) => ({ ...file, id: file._id })),
        directories: directories.map((dir) => ({ ...dir, id: dir._id })),
      });
  } catch (err) {
    console.log("message", err.message);
  }
};

export const createDirectory = async (req, res) => {
  console.log("Create directory function is running");
  const user = req.user;
  let parentId = req.params.parentDirId;

  if (Array.isArray(parentId)) [parentId] = parentId;
  else if (!parentId) parentId = user.rootDirId.toString();

  const dirname = req.headers.dirname || "Untitled Folder";
  console.log("parentId", parentId);
  console.log("directory name", dirname);
  console.log("user directrory", user._id);
  try {
    const parentDirData = await Directory.findOne({
      _id: parentId,
      userId: user._id,
    }).lean();
    if (!parentDirData)
      return res
        .status(404)
        .json({ message: "Parent Directory Dosen't exist" });

    const saveDir = await Directory.create({
      name: dirname,
      parentDirId: parentId,
      userId: user._id,
      deletedAt: null,
      isDeleted: false,
    });
    console.log("SaveDir", saveDir);

    return res.status(200).json({ message: "directory is created" });
  } catch (err) {
    return res.status(404).json({ message: err.message });
  }
};

export const renameDirectory = async (req, res) => {
  console.log("directory rename function is running");
  const loggedInUser = req.user;
  const { userId, folderId } = req.params;
  console.log("folderId", folderId);
  const { data, success, error } = nameSchema.safeParse(req.body);
  if (!success) {
    console.log("error ka issue", error.issues);
    return res.status(400).json({ error: "Invalid credential" });
  }
  const { name: dirName } = sanitize(data);
  const query = { _id: folderId };

  if (loggedInUser.role == "Admin" || loggedInUser.role == "Owner") {
    if (!userId) query.userId = loggedInUser._id;
    else query.userId = userId;
  } else {
    query.userId = loggedInUser._id;
  }
  try {
    console.log(query);
    const directoryData = await Directory.findOneAndUpdate(
      query,
      { name: dirName },
      { new: true },
    );

    return res.status(200).json({ message: "Directory Renamed successfully" });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

export const AccessingBreadCumbPath = async (req, res) => {
  console.log("Bread Cumb path function is running");
  let { dirId } = req.params;
  const path = [];
  console.log("id", dirId);
  while (dirId != null) {
    const { _id, name, parentDirId } = await Directory.findById(dirId).lean();
    console.log(_id, name, parentDirId);
    path.unshift({ name, id: _id.toString() });
    dirId = parentDirId;
  }
  path.shift();
  console.log("after applying shift operation", path);
  return res.status(200).json(path);
};

export const temporaryDeleteFolder = async (req, res) => {
  try {
    console.log("temporary delete folder function is running");
    console.log("req.params", req.params);
    const { dirId } = req.params;
    if (!dirId) return res.status(400).json({ message: "dirId is required" });

    const directoryData = await Directory.findById(dirId).lean();
    console.log("directoryData", directoryData);
    if (!directoryData)
      return res.status(404).json({ message: "Directory not found" });

    const { filesId, directoriesId } = await getDirectoryContents(dirId);
    console.log("final filesId", filesId);
    console.log("final dorectoriesId", directoriesId);
    const fileIds = filesId.map((file) => file._id);
    const directoryIds = directoriesId.map((dir) => dir._id);
    await updateDirectorySize(directoryData.parentDirId, -directoryData.size);
    directoryIds.push(dirId);
    await File.updateMany(
      { _id: { $in: fileIds } },
      { $set: { isDeleted: true } },
    );
    await Directory.updateMany(
      { _id: { $in: directoryIds } },
      { $set: { isDeleted: true } },
    );
    return res.status(200).json({ message: "Folder deleted successfully" });
  } catch (err) {
    console.log(err.message);
  }
};

export const handleStar = async (req, res) => {
  console.log("post request for making directory star");
  const { starred } = req.body;
  try {
    await Directory.findByIdAndUpdate(req.params.id, { starred });

    res.json({ success: true });
  } catch (err) {
    console.log(err.message);
  }
};
