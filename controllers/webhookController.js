import Razorpay from "razorpay";
import { appendFile } from "fs/promises";
import Subcribe from "../models/subscriptionModel.js";
import User from "../models/userModel.js";
import Invoice from "../models/invoiceModel.js";
import File from "../models/fileModel.js";
import { getSubscription } from "../helper/webhookHelper.js";
import { Plan } from "../constants/plans.js";
import { sendEmail } from "../service/sendOTPServices.js";

const webhookMessagesFile = new URL("../webhook-messages.txt", import.meta.url);

const saveWebhookMessage = async (message) => {
  const entry = [`Received at: ${new Date().toISOString()}`, message, ""].join(
    "\n",
  );

  await appendFile(webhookMessagesFile, entry);
};

const webhookSecret = process.env.WEBHOOK_SECRET;

const RzpInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

export const handleRazorpayWebhook = async (req, res) => {
  console.log("Razorpay Webhook function is running");
  const razorpaySignature = req.headers["x-razorpay-signature"];
  try {
    const webhookMessage = req.body.toString();
    await saveWebhookMessage(webhookMessage);

    const isValid = Razorpay.validateWebhookSignature(
      webhookMessage,
      razorpaySignature,
      webhookSecret,
    );
    console.log("isValid", isValid);

    if (!isValid)
      return res
        .status(400)
        .json({ success: false, message: "Invalid signature" });

    const event = JSON.parse(webhookMessage);
    console.log("event", event);
    switch (event.event) {
      case "subscription.activated": {
        console.log("Activated part of razorpay is running");
        const { rzpSubscription, subscription } = await getSubscription(event);
        console.log("rzpSubscription razorpaysubscription", rzpSubscription);
        subscription.status = rzpSubscription.status;
        subscription.currentPeriodStart = new Date(
          rzpSubscription.current_start * 1000,
        );
        subscription.currentPeriodEnd = new Date(
          rzpSubscription.current_end * 1000,
        );
        subscription.nextBillingAt = new Date(rzpSubscription.charge_at * 1000);
        await subscription.save();
        const user = await User.findById(subscription.userId);
        user.maxStorageInBytes = Plan[subscription.planId].storageQuotaInBytes;
        await user.save();
        break;
      }
      case "payment.captured": {
        const payment = event.payload.payment.entity;
        console.log("payment of payment captured part", payment);
        if (payment.notes?.type === "subscription_upgrade") {
          try {
            const { subscriptionId, newPlanId, userId } = payment.notes;
            //* finding old active subscription
            const activeSubscription = await Subcribe.findOne({
              razorpaySubscriptionId: subscriptionId,
              status: "active",
            });
            if (!activeSubscription) {
              console.log("Active subscription not found");
              break;
            }
            //* cancelled old subscription
            await RzpInstance.subscriptions.cancel(subscriptionId, false);
            activeSubscription.status = "expired";
            //* creating new subscription
            const newSubscription = await RzpInstance.subscriptions.create({
              plan_id: newPlanId,
              total_count: 50,
              notes: {
                type: "upgraded_subscription",
                userId: userId,
              },
              start_at: Math.floor(
                new Date(activeSubscription.currentPeriodEnd).getTime() / 1000,
              ),
            });

            //* CREATE NEW DB SUBSCRIPTION
            await Subcribe.create({
              userId,
              razorpaySubscriptionId: newSubscription.id,
              planId: newPlanId,
              status: "pending",
              currentPeriodStart:Date.now(),
              currentPeriodEnd:activeSubscription.currentPeriodEnd
            });
            const user = await User.findById(payment.notes.userId).lean();
            if (user?.email) {
              await sendEmail({
                to: user.email,
                subject: "Approve your subscription upgrade mandate",
                html: `
                  <div style="font-family:sans-serif;">
                    <h2>Complete your subscription mandate</h2>
                    <p>Please click the link below to approve the new subscription mandate:</p>
                    <p><a href="${newSubscription.short_url}">${newSubscription.short_url}</a></p>
                    <p>If the link does not open, copy and paste it into your browser.</p>
                  </div>
                `,
              });
            }
            console.log("Subscription upgraded successfully");
            return res.json({ short_url: newSubscription.short_url });
          } catch (err) {
            console.log("payment captured ka error", err);
            console.log(err.message);
          }
        }
        break;
      }

      case "subscription.authenticated":{
        console.log("Authenticated controller is running");
        const { rzpSubscription, subscription } = await getSubscription(event);
        console.log("rzpSubscription of authenticated controller",rzpSubscription);
        console.log("subscription",subscription);
        const user=await User.findById(subscription.userId);
        console.log("User",user);
        user.maxStorageInBytes =Plan[rzpSubscription.plan_id].storageQuotaInBytes;
        await user.save();
        break;
      };

      case "subscription.charged": {
        const { rzpSubscription, subscription } = await getSubscription(event);
        if (rzpSubscription.paid_count === 1) {
          console.log("SUbcription charge controller break ho gya");
          break;
        }
        if (
          subscription.pendingChangeType === "downgrade" &&
          subscription.pendingPlanId &&
          Date.now() >= subscription.pendingEffectiveDate?.getTime()
        ) {
          subscription.planId = rzpSubscription.plan_id;
          subscription.pendingPlanId = null;
          subscription.pendingChangeType = null;
          subscription.pendingEffectiveDate = null;

          const user = await User.findById(subscription.userId);
          if (user && Plan[rzpSubscription.plan_id]) {
            user.maxStorageInBytes =
              Plan[rzpSubscription.plan_id].storageQuotaInBytes;
            await user.save();
          }
        }
        subscription.currentPeriodStart = new Date(
          rzpSubscription.current_start * 1000,
        );
        subscription.currentPeriodEnd = new Date(
          rzpSubscription.current_end * 1000,
        );
        subscription.nextBillingAt = new Date(rzpSubscription.charge_at * 1000);
        await subscription.save();
        break;
      }
      case "invoice.paid": {
        const invoice = event.payload.invoice.entity;
        console.log("rzp invoice", invoice);
        const subscription = await Subcribe.findOne({
          razorpaySubscriptionId: invoice.subscription_id,
        });
        if (!subscription) break;
        await Invoice.findOneAndUpdate(
          {
            razorpayInvoiceId: invoice.id,
          },
          {
            $set: {
              userId: subscription.userId,
              planId: subscription.planId,
              razorpaySubscriptionId: invoice.subscription_id,
              razorpayInvoiceId: invoice.id,
              invoiceUrl: invoice.short_url,
              amount: invoice.amount_paid / 100,
              status: invoice.status,
              invoiceDate: invoice.date,
              planName: Plan[subscription.planId].name,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );

        break;
      }

      case "subscription.pending": {
        const { rzpSubscription, subscription } = await getSubscription(event);
        const payment = event.payload.payment?.entity;
        console.log("rzpSubscription", rzpSubscription);
        console.log("payment", payment);
        console.log("subscription", subscription);
        if (!subscription) break;

        let invoiceUrl = null;
        let invoiceDate = null;
        if (payment?.invoice_id) {
          const rzpInvoice = await RzpInstance.invoices.fetch(
            payment.invoice_id,
          );
          invoiceUrl = rzpInvoice.short_url;
          invoiceDate = rzpInvoice.date;
        }

        await Invoice.findOneAndUpdate(
          {
            razorpayInvoiceId: payment?.invoice_id,
          },
          {
            $set: {
              userId: subscription.userId,
              planId: subscription.planId,
              razorpaySubscriptionId: subscription.razorpaySubscriptionId,
              razorpayInvoiceId: payment?.invoice_id,
              invoiceUrl,
              amount: payment?.amount / 100,
              status: "pending",
              invoiceDate,
              planName: Plan[subscription.planId].name,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );

        break;
      }

      case "payment.failed": {
        const payment = event.payload.payment.entity;
        console.log("payment failed", payment);
        break;
      }

      case "subscription.cancelled": {
        const { rzpSubscription, subscription } = await getSubscription(event);
        if(subscription.status == "expired")
            break;
        console.log("rzpSubscription cancelled", rzpSubscription);
        await User.findOneAndUpdate(
          { _id: subscription.userId },
          {
            $set: {
              maxStorageInBytes: process.env.FREE_TIER_STORAGE,
            },
          },
        );

        subscription.status = "cancelled";
        subscription.nextBillingAt = null;

        if (rzpSubscription.ended_at) {
          subscription.currentPeriodEnd = new Date(
            rzpSubscription.ended_at * 1000 + 3 * 24 * 60 * 60 * 1000,
          );
        }
        await subscription.save();
        break;
      }

      case "subscription.paused": {
        const { rzpSubscription, subscription } = await getSubscription(event);
        subscription.status = "halt";
        subscription.nextBillingAt = null;
        subscription.pausedAt = new Date();
        await subscription.save();
        await User.findByIdAndUpdate(subscription.userId, {
          $set: {
            maxStorageInBytes: process.env.FREE_TIER_STORAGE,
          },
        });

        break;
      }
      case "subscription.resumed": {
        const { rzpSubscription, subscription } = await getSubscription(event);
        subscription.status = "active";
        subscription.currentPeriodStart = new Date(
          rzpSubscription.current_start * 1000,
        );
        subscription.currentPeriodEnd = new Date(
          rzpSubscription.current_end * 1000,
        );
        subscription.nextBillingAt = new Date(rzpSubscription.charge_at * 1000);
        await subscription.save();
        const selectedPlan = Plan[subscription.planId];

        await User.findByIdAndUpdate(subscription.userId, {
          $set: { maxStorageInBytes: selectedPlan.storageQuotaInBytes },
        });
        break;
      }

      default:
        console.log("Unhandled event");
        break;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.log(err.message);
  }
};
