import Razorpay from "razorpay";
import Subcribe from "../models/subscriptionModel.js";
import Directory from "../models/directoryModel.js";
import { Plan } from "../constants/plans.js";
import Invoice from "../models/invoiceModel.js";


const RzpInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});




const getSubscriptionPeriod = (subscription) => {
  const periodStart = subscription.currentPeriodStart?.getTime();
  const periodEnd = subscription.currentPeriodEnd?.getTime();

  if (!periodStart || !periodEnd || periodEnd <= periodStart) {
    return null;
  }

  return { periodStart, periodEnd };
};

export const getCurrentUserPlan = async (req, res) => {
  console.log("Current User Plan function is running");
  const userId = req.user._id;
  const userPlan = await Subcribe.findOne({
    userId: userId,
    status:{$ne:"expired"}
  }).lean();
  
   if(!userPlan)
      return res.status(404).json({status:false});
  
  return res
    .status(200)
    .json({
      currentPeriod: userPlan.currentPeriodStart,
      EndcurrentPeriodStart: userPlan.currentPeriodEnd,
      nextBillingAt: userPlan.currentPeriodEnd,
      subscriptionPrice: Plan[userPlan.planId].price,
      name: Plan[userPlan.planId].name,
      features: Plan[userPlan.planId].features,
      status:userPlan.status
    });
};

export const cancelUserSubscription = async (req, res) => {
  const userId = req.user._id;
  try {
    const userSubscription = await Subcribe.findOne({
      userId: userId,
      status: "active",
    });
    if (!userSubscription)
      return res.status(404).json({ message: "You have no any active subscription" });
    console.log("userSubscription", userSubscription);
    //* Cancel from Razorpay
    const result=await RzpInstance.subscriptions.cancel(
      userSubscription.razorpaySubscriptionId,
      false,
    );
    console.log("result",result);
    await userSubscription.save();
    return res
      .status(200)
      .json({ message: "Subscription is cancelled successfully" });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getUserCurrentSubscription = async (req, res) => {
  const userId = req.user._id;
  const userSubscription = await Subcribe.findOne({
   userId,
   status: { $in: ["active", "pending"] }
}).select("planId").lean();
  if (!userSubscription)
    return res.status(404).json({ message: "user subscription is not found" });

  return res
    .status(200)
    .json({
      planId: userSubscription.planId,
      level: Plan[userSubscription.planId].level,
    });
};

export const createSubcription = async (req, res) => {
  const { planId } = req.body;
  const userId = req.user._id;
  console.log("userId", userId);
  console.log("plan id", planId);
  try {
    const selectedPlan = Plan[planId];
    console.log("selected Plan",selectedPlan);
    if (!selectedPlan)
      return res.status(400).json({ message: "Invalid plan selected" });

    const existingSubscription = await Subcribe.findOne({ userId: userId });
    if (existingSubscription && existingSubscription.pendingChangeType)
      return res
        .status(409)
        .json({ message: "A subscription change is already scheduled" });

    if (
      existingSubscription &&
      existingSubscription.status == "active" &&
      existingSubscription.planId == planId
    )
      return res.status(409).json({message: "You already have an active subscription for this plan"});

    //* user has already active subscription now either he want to upgrade or downgrade his subscription
    if (existingSubscription && existingSubscription.status === "active") {
      console.log("user has already active subscription now either he want to upgrade or downgrade his subscription");
      const newPlan = selectedPlan;
      const currentPlan = Plan[existingSubscription.planId];
      console.log("currentPlan",currentPlan);
      if (!currentPlan)
        return res
          .status(409)
          .json({ message: "Current subscription plan is not configured" });

      //* upgradation of storage because of higher value plan
      if (newPlan.price > currentPlan.price) {
        console.log("Upgradation part is running");
        const subscriptionPeriod = getSubscriptionPeriod(existingSubscription);
        if (!subscriptionPeriod)
          return res.status(409).json({
            message:"Subscription billing period is not available yet. Please try again after activation.",
          });

        const currentTime = Date.now();
        const totalDuration =
          subscriptionPeriod.periodEnd - subscriptionPeriod.periodStart;
        const remainingDuration = Math.max(
          0,
          subscriptionPeriod.periodEnd - currentTime,
        );
        const remainingRatio = remainingDuration / totalDuration;
        const remainingCredit = Math.round(remainingRatio * currentPlan.price);
        const payableAmount = Math.max(0, newPlan.price - remainingCredit);
        const order = await RzpInstance.orders.create({
          amount: Math.round(payableAmount * 100),
          currency: "INR",
          notes: {
            type: "subscription_upgrade",
            userId,
            oldPlanId: existingSubscription.planId,
            newPlanId: planId,
            subscriptionId: existingSubscription.razorpaySubscriptionId,
          },
        });
        return res.status(200).json({
          type: "upgrade",
          orderId: order.id,
        });
      } else {
        //* downgradation of storage
        const userRootDirectory = await Directory.findOne({
          _id: req.user.rootDirId,
        });
        if (!userRootDirectory)
          return res.status(404).json({ message: "Root directory not found" });

        const usedStorage = userRootDirectory.size;
        if (usedStorage > newPlan.storageQuotaInBytes)
          return res.status(409).json({
            type: "storage_limit_exceeded",
            message:
              "Please reduce your storage usage before downgrading your plan",
          });
        try {
          await RzpInstance.subscriptions.update(
            existingSubscription.razorpaySubscriptionId,
            {
              plan_id: planId,
              schedule_change_at: "cycle_end",
            },
          );
          existingSubscription.pendingPlanId = planId;
          existingSubscription.pendingChangeType = "downgrade";
          existingSubscription.pendingEffectiveDate =
            existingSubscription.currentPeriodEnd;
          await existingSubscription.save();
          return res.status(200).json({
            type: "downgrade_scheduled",
            message: "Your downgrade will take effect next billing cycle",
          });
        } catch (err) {
          console.log(err.message);
          return res.status(500).json({
            type: "downgrade_failed",
            message:
              "Unable to schedule subscription downgrade right now. Please try again later.",
          });
        }
      }
    }

    //* if user has existing subscription and he didnt purchase any subscription just return the save subscription id
    else if (existingSubscription && existingSubscription.status == "created") {
      return res
        .status(200)
        .json({ message: existingSubscription.razorpaySubscriptionId });
    }

  else if(
   existingSubscription &&
   existingSubscription.status === "cancelled" &&
   existingSubscription.currentPeriodEnd > new Date()
) {

   const newSubscription = await RzpInstance.subscriptions.create({
      plan_id: planId,
      total_count: 80,
      notes: {
         userId: req.user._id,
      },
   });

   existingSubscription.razorpaySubscriptionId =newSubscription.id;
   existingSubscription.planId = planId;
   existingSubscription.status = "created";
   await existingSubscription.save();

   return res.status(201).json({
      message: newSubscription.id,
   });
}
else{
    //* for new user subscription
    const newSubscription = await RzpInstance.subscriptions.create({
      plan_id: planId,
      total_count: 80,
      notes: {
        userId: req.user._id,
      },
    });
    console.log("newSubscription", newSubscription);
    await Subcribe.create({
      razorpaySubscriptionId: newSubscription.id,
      userId: userId,
      planId: planId,
      status: "created",
    });

    return res.status(201).json({
      message: newSubscription.id,
    });
  }} catch (err) {
    console.log("Razorpay subscription error", err);
    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const pauseUserSubscription=async (req,res)=>{
  console.log("pause Subscription is running");
  const userId=req.user._id;
  try{
  const activeSubscription=await Subcribe.findOne({userId:userId,status:"active"});
  console.log("activeSubscription",activeSubscription);
  await RzpInstance.subscriptions.pause(
   activeSubscription.razorpaySubscriptionId,
   {
      pause_at: "now"
   });
   return res.status(200).json({"message":"Subscription is paused successfully"});
  }
   catch(err){
    console.log(err);
      console.log(err.message);
   }
}

export const resumeSubscription = async (req, res) => {

   try {
      const userId = req.user._id;
      const subscription = await Subcribe.findOne({userId});

      if (!subscription) {
         return res.status(404).json({
            message: "Subscription not found"
         });
      }

      if (subscription.status !== "halt") {
         return res.status(409).json({
            message: "Only halt subscriptions can be resumed"
         });
      }

      await RzpInstance.subscriptions.resume(
         subscription.razorpaySubscriptionId,
         {
            resume_at: "now"
         }
      );

      return res.status(200).json({
         message:
            "Subscription resume request submitted successfully"
      });

   } catch (error) {

      console.log(
         "Resume subscription error",
         error
      );

      return res.status(500).json({
         message: "Internal Server Error"
      });
   }
};

export const fetchInvoices=async (req,res)=>{
  console.log("Invoices controller is running");
  console.log("fetch invoice me userId",req.user_id);
  try{
  const allInvoices=await Invoice.find({userId:req.user._id});
  console.log("Allinvoices",allInvoices);
  if(!allInvoices.length)
    return res.status(404).json({"message":"No Invoices is found"});
  return res.status(200).json({Invoices:allInvoices});
  }catch(err){
    console.log(err.message);
  }
}