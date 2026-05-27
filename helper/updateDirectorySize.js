import Directory from "../models/DirectoryModel.js";


export const updateDirectorySize=async (parentId,sizeToAdd)=>{
   const parentIdCollection=[];
        while(parentId){
           parentIdCollection.push(parentId);
           const currentDirectory=await Directory.findById(parentId).lean();
           if(!currentDirectory.parentDirId) break;
           parentId=currentDirectory.parentDirId;
        }

        if(parentIdCollection.length > 0){
          await Directory.updateMany(
         { _id: { $in: parentIdCollection } },
        { $inc: { size: sizeToAdd } }
        );
        }
      
}