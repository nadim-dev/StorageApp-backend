import { Schema,model } from "mongoose";

const recentSchema=new Schema({
    userId:{
        type:Schema.Types.ObjectId,
        required:true
    },
    itemId:{
       type:Schema.Types.ObjectId,
       required:true
    },
    itemType:{
      type:String,
      enum:["file","directory"],
      required:true,
      default:"file"
    },
    isDeleted: {
      type: Boolean,
      default: false
   },
    lastAccessedAt:{
        type:Date,
        default: Date.now
    },
    size:{
        type:Number
    },
    name:{
        type:String
    } 
},{
    strict:"throw",
    versionKey:false,
    timestamps: true 
})

recentSchema.index(
   { userId:1, itemId:1 },
   { unique:true }
);

recentSchema.index(
   { lastAccessedAt: 1 },
   { expireAfterSeconds: 6 * 60 * 60 }
);

const Recent=model("Recent",recentSchema);
export default Recent;