import { ObjectId } from "mongodb";

export default function(req,res,next,id){
   console.log("validation middleware function is running")
   console.log("id",id);
    if(Array.isArray(id)){
       [id]=id
    }

   if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: `Invalid Id ${id}` });
   }
   next();
}