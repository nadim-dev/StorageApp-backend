import { Schema, model } from "mongoose";
import mongoose from "mongoose";
import linkSharingSchema from "./schemas/linkSharingSchema.js";

const directorySchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "name is required"],
    },
    parentDirId: {
      type: Schema.Types.ObjectId,
      default: null,
      ref: "Directory",
    },
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    size: {
      type: Number,
      default: 0,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
    starred: {
      type: Boolean,
      default: false,
    },
    deletedAt:{
      type:Date,
      default:null
    },
    deletedAt: Date,
    linkSharing: linkSharingSchema,
  },
  {
    strict: "throw",
    versionKey: false,
    timestamps: true,
  },
);

const Directory=model("Directory", directorySchema);
export default Directory;
