import express from "express";
import checkAuth from "../middleware/authMiddleware.js";
import { createSubcription,getUserCurrentSubscription,getCurrentUserPlan,cancelUserSubscription,pauseUserSubscription,resumeSubscription,fetchInvoices } from "../controllers/subcriptionController.js";
const router=express.Router();


router.post("/create-subcription",checkAuth,createSubcription);
router.get("/current-subscription",checkAuth,getUserCurrentSubscription);
router.get("/current-plan",checkAuth,getCurrentUserPlan);
router.post("/cancel",checkAuth,cancelUserSubscription);
router.post("/pause",checkAuth,pauseUserSubscription);
router.post("/resume",checkAuth,resumeSubscription);
router.get("/invoices",checkAuth,fetchInvoices);
export default router;