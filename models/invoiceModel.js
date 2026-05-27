import { Schema, model } from "mongoose";
import { type } from "os";

const invoiceSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    razorpaySubscriptionId: {
      type: String,
      ref: "Subcribe",
      required: true,
    },
    planId: {
      type: String,
      required: true,
    },
    razorpayInvoiceId: {
      type: String,
      required: true,
      unique: true,
    },
    invoiceUrl: {
      type: String,
      default: null,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["paid", "pending", "unpaid", "failed", "cancelled"],
      required: true,
    },
    invoiceDate:{
      type:Number
    },
    planName:{
      type:String,
    }
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const Invoice = model("Invoice", invoiceSchema);
export default Invoice;
