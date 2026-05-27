import File from "../models/fileModel.js";
import Directory from "../models/directoryModel.js";

export async function getDirectoryContents(id) {
  console.log("getDirectoryContent function is running");
  console.log("id", id);
  let filesId = await File.find({ parentDirId: id }).select("extension").lean();
  console.log("filesId", filesId);
  let directoriesId = await Directory.find({ parentDirId: id })
    .select("_id")
    .lean();
  console.log("directoriesId", directoriesId);
  for (const { _id, extension } of directoriesId) {
    const { filesId: childFilesId, directoriesId: childDirectoriesId } =
      await getDirectoryContents(_id.toString());
    filesId = [...filesId, ...childFilesId];
    directoriesId = [...directoriesId, ...childDirectoriesId];
  }

  return { filesId, directoriesId };
}
