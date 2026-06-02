import { Schema } from "mongoose";

const linkSharingSchema = new Schema(
  {
    enabled: {
      type: Boolean,
      default: false,
    },

    token: {
      type: String,
      default: null,
    },

    role: {
      type: String,
      enum: ["viewer", "editor"],
      default: "viewer",
    },
  },
  {
    _id: false,
  }
);

export default linkSharingSchema;