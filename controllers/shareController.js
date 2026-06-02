import Directory from "../models/directoryModel.js";
import File from "../models/fileModel.js";
import crypto from "node:crypto"
 
export const createPublicLink = async (req, res) => {
     const {resourceId,resourceType} = req.body;
     console.log("resourceId",resourceId);
     console.log("resourceType",resourceType);

  try {
     if (!resourceId || !resourceType) 
      return res.status(400).json({message: "resourceId and resourceType are required"});
    
     if (resourceType !== "file" && resourceType !== "directory") 
       return res.status(400).json({message: "Invalid resourceType"});
    
     let resource;

    if (resourceType === "file") 
      resource = await File.findById(resourceId);
    else 
      resource = await Directory.findById(resourceId);
    

    if (!resource) 
      return res.status(404).json({message: `${resourceType} not found`});
    
    
    //*  Ownership check
    if (resource.userId.toString() !== req.user._id)
      return res.status(403).json({message: "Access denied"});
    

    //*  Existing public link
    if (resource.linkSharing?.enabled && resource.linkSharing?.token)
      return res.status(200).json({publicUrl: `${process.env.FRONTEND_URL}/share/${resource.linkSharing.token}`});
    

    const token = crypto.randomBytes(32).toString("hex");

    resource.linkSharing = {
      enabled: true,
      token,
      role: "viewer",
    };

    await resource.save();

    return res.status(200).json({
      publicUrl: `${process.env.FRONTEND_URL}/share/${token}`,
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};