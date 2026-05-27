import { model,Schema } from "mongoose";

const subscriptionSchema=new Schema({
    razorpaySubscriptionId:{
        type:String,
        required:true,
    },
    userId:{
        type:Schema.Types.ObjectId,
        ref:"User",
        required:true
    },
    status:{
        type:String,
        enum:["created","active","pending","halt","cancelled","completed"],
        default:"created"
    },
    planId:{
        type:String,
    },
    currentPeriodStart:{
       type:Date
    },
    nextBillingAt:{
        type:Date
    },
    currentPeriodEnd:{
        type:Date
    },
    pendingPlanId:{
        type:String,
        default:null
    },
    pendingChangeType:{
        type:String,
        enum:["upgrade","downgrade",null],
        default:null
    },
    pendingEffectiveDate:{
        type:Date,
        default:null
    },
    pausedAt:{
        type:Date,
        default:null
    }
})

const Subcribe=model("Subcribe",subscriptionSchema);

export default Subcribe;
