import mongoose, { Schema,model } from "mongoose";



const sessionSchema=new Schema({
  userId:{
    type:mongoose.Schema.Types.ObjectId,
    default:null,
    required:true
  },

  createdAt:{
    type:Date,
    default:Date.now(),
    expires:60*60*24*7*1000
  }

},{
    strict:"throw",
    versionKey:false,
});


const Session=model("Session",sessionSchema);


export default Session;