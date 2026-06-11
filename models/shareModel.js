import { model, Schema } from "mongoose";

const shareSchema = new Schema(
  {
    resourceId: {
      type: Schema.Types.ObjectId,
      required: true,
    },

    resourceType: {
      type: String,
      enum: ["file", "directory"],
      required: true,
    },

    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    sharedWith: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    permission: {
      type: String,
      enum: ["viewer", "editor"],
      default: "viewer",
      required: true,
    },
    name:{
      type:String,
      required:true
    },
    shareDate:{
      type:Date,
      default:new Date,
    },
    extension:{
      type:String,
    },
    resourceName:{
      type:String
    },
    contentType:{
      type:String
    }
  },
  {
    timestamps: true,
  }
);

/**
 * Get all resources shared with a user
 */
shareSchema.index({
  sharedWith: 1,
});

/**
 * Get all shares created by an owner
 */
shareSchema.index({
  ownerId: 1,
});

/**
 * Prevent duplicate shares
 * Same resource cannot be shared
 * multiple times with the same user
 * Also supports fast permission checks
 */
shareSchema.index(
  {
    resourceId: 1,
    sharedWith: 1,
  },
  {
    unique: true,
  }
);

const Share = model("Share", shareSchema);

export default Share;
