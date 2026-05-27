import Directory from "../models/directoryModel.js";
import File from "../models/fileModel.js";
import Recent from "../models/recentModal.js";
import { getDirectoryContents } from "../helper/getDirectoryContents.js";
import { updateDirectorySize } from "../helper/updateDirectorySize.js";

export const getAllTrashItems = async (req, res) => {
  try {
    console.log("Trash item function is running");

    const directoryList = await Directory.find({
      isDeleted: true,
      userId: req.user._id,
    })
      .select("name deletedAt")
      .lean();

    console.log("directoryList", directoryList);
    const deletedDirIds = directoryList.map((dir) => dir._id);

    const files = await File.find({
      isDeleted: true,
      userId: req.user._id,
      parentDirId: { $nin: deletedDirIds },
    })
      .select("name deletedAt size extension")
      .lean();
    console.log("files", files);

    // ✅ add type field
    const directoriesWithType = directoryList.map((dir) => ({
      ...dir,
      type: "folder",
    }));

    const filesWithType = files.map((file) => ({
      ...file,
      type: "file",
    }));

    // ✅ merge trash items
    const trashItems = [...directoriesWithType, ...filesWithType];

    return res.status(200).json(trashItems);
  } catch (err) {
    console.log(err.message);
    res.status(500).json({ message: "Server Error" });
  }
};

export const recoverTrashFile = async (req, res) => {
  console.log("Recover trash file function is running");
  try {
    const { fileId } = req.params;
    if (!fileId) return res.status(400).json({ message: "FileId is required" });

    const file = await File.findByIdAndUpdate(
      fileId,
      { isDeleted: false },
      { new: true },
    );
    console.log("file", file);
    if (!file) return res.status(404).json({ message: "File not found" });
    await updateDirectorySize(file.parentDirId, file.size);
    await Recent.findOneAndUpdate(
      { userId: req.user._id, itemId: fileId },
      { isDeleted: false },
    );
    return res.status(200).json({ message: "File restored successfully" });
  } catch (err) {
    console.log(err.message);
  }
};

export const recoverTrashDirectory = async (req, res) => {
  console.log("Recover trash file function is running");
  try {
    const { dirId } = req.params;
    if (!dirId) return res.status(400).json({ message: "FileId is required" });

    const directoryData = await Directory.findById(dirId);

    if (!directoryData) {
      return res.status(404).json({ message: "Directory Not Found" });
    }

    const { filesId, directoriesId } = await getDirectoryContents(dirId);
    console.log("final filesId", filesId);
    console.log("final dorectoriesId", directoriesId);
    const filesIdList = filesId.filter((file) => file._id);
    const directoriesIdList = directoriesId.filter((dir) => dir._id);
    await updateDirectorySize(directoryData.parentDirId, directoryData.size);

    directoriesIdList.push(dirId);
    await File.updateMany(
      { _id: { $in: filesIdList } },
      { $set: { isDeleted: false, deletedAt: null } },
    );
    await Directory.updateMany(
      { _id: { $in: directoriesIdList } },
      { $set: { isDeleted: false, deletedAt: null } },
    );
    return res.status(200).json({ message: "Directory restored successfully" });
  } catch (err) {
    console.log(err);
    console.log(err.message);
  }
};
