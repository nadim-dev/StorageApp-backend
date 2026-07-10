import mongoose from "mongoose";

export default function(req,res,next,id){
   console.log("validation middleware function is running")
    if (!mongoose.Types.ObjectId.isValid(id)) 
    return res.status(400).json({message:"Invalid Id"});
   next();
}