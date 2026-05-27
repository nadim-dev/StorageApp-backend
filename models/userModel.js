
import { Schema,model } from "mongoose";
import bcrypt from "bcrypt";



const userSchema=new Schema({
  name:{
    type:String,
    required:true,
    minLength:[3,"Username must contains atleast three characters"]
  },
  email:{
    type:String,
    match:[/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,"please Enter Valid Email "],
    required:true,
    unique:true
  },
  password:{
    type:String,
    minLength:[4,"Minimum length of password must be 4 "]
  },
  rootDirId:{
    type:Schema.Types.ObjectId,
    required:true,
    ref:"Directory"
  },
  picturePublicId: {
    type: String,
  },
  pictureVersion: {
    type: String,
  },
  profilePictureUrl:{
    type:String,
  },
  role:{
    type:String,
    enum:["Admin","Manager","User","Owner"],
    default:"User",
  },
  deleted:{
    type:Boolean,
    default:false
  },
  deletedAt: {
    type: Date,
  },
  deletedBy: {
    type:String,
  },
  authProvider:{
    type:String,
    default:"google"
  },
  maxStorageInBytes:{
    type:Number,
    required:true,
    default:1*1024*1024*1024
  }  
},{
    strict:"throw",
    versionKey:false,
});

userSchema.pre("save",async function (next){
  //if password is not modified, skip hashing
  if(!this.isModified("password")) return  next(); // expect string argument 
  //arrow function dosent have their own this
  //hashing password

  this.password=await bcrypt.hash(this.password,10);
  next();
})

//method to comapre password

userSchema.methods.comparePassword=async function(enteredPasswrod) {
  return await bcrypt.compare(enteredPasswrod,this.password)
}

const User=model("User",userSchema);
export default User;
