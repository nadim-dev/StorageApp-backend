import { Schema,model } from "mongoose";
import linkSharingSchema from "./schemas/linkSharingSchema.js";


const FileSchema=new Schema({
    extension:{
        type:String,
        required:true,
    },
    name:{
      type:String,
      required:true
    },
    userId:{
       type:Schema.Types.ObjectId,
       required:true,
    },
    parentDirId:{
       type:Schema.Types.ObjectId,
       required:true,
       ref:"Directory"
    },
    size:{
         type: Number,
         required: true,
    },
    contentType:{
      type:String
    },
    starred:{
       type:Boolean,
       default:false
    },
     isDeleted: {
      type: Boolean,
      default: false
   },
   plan:{
      type:String,
   },
   hash:{
     type:String
   },
   status:{
    type:String,
    enum:["active","locked"],
    default:"active"
   },
   isUploading:{
      type:Boolean,
   },
   lastAccessedAt:{
         type:Date,
         default:new Date()
      }
   ,
   deletedAt: Date,
   linkSharing:linkSharingSchema
},{
    strict:"throw",
    versionKey:false,
    timestamps: true 
})

const File=model("File",FileSchema);
 
export default File;