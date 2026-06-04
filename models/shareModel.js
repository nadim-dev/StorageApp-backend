
import { model,Schema } from "mongoose";

const shareSchema =Schema({
  resourceId: {
    type:Schema.Types.ObjectId,
    required: true
  },

  resourceType: {
    type: String,
    enum: ["file", "directory"],
    required: true
  },

  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  sharedWith: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  permission: {
    type: String,
    enum: ["viewer", "editor"],
    default: "viewer"
  }
}, {
  timestamps: true
});

const Share=model("Share", shareSchema);
export default Share;