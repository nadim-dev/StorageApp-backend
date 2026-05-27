import Subcribe from "../models/subscriptionModel.js";

export const getSubscription= async (event) => {

   const rzpSubscription =event.payload.subscription?.entity;
   console.log("rzpSubscription of  webhook helper",rzpSubscription);

   if (!rzpSubscription) {
      return {};
   }

   const subscription = await Subcribe.findOne({
      razorpaySubscriptionId: rzpSubscription.id,
   });

   return {
      rzpSubscription,
      subscription,
   };
};