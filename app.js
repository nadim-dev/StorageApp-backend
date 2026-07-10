import express from "express";
import cors from "cors";
import directoryRoutes from "./routes/directoryRoutes.js";
import fileRoutes from "./routes/fileRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import trashRoutes from "./routes/trashRoutes.js";
import subcriptionRoutes from "./routes/subcriptionRoutes.js";
import shareRoutes from "./routes/shareRoutes.js"
import cookieParser from "cookie-parser";
import checkauth from "./middleware/authMiddleware.js";
import { connectDB } from "./config/mongoose.js";
import helmet from "helmet";
import { globalRateLimiter } from "./middleware/rateLimiter.js";
import checkAuth from "./middleware/authMiddleware.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import "./cron/cleanupLockedFiles.js";

try {
  await connectDB();
  const app = express();
  const mySecretKey = process.env.secretKey;
  const PORT=process.env.PORT || 4000;
  app.use("/webhook", webhookRoutes);

  app.use(express.json());
  
  app.use(
    cors({
      origin: [process.env.CLIENT_URL,"http://localhost:5173"],
      credentials: true,
    })
  );

  app.get("/",(req,res)=>{
    res.json({"message":"get message is getting"});
  })

  app.use(cookieParser(mySecretKey));

  app.use(helmet());
  
  app.use(globalRateLimiter);
  
  app.use("/trash",trashRoutes);
  app.use("/directory",directoryRoutes);
  app.use("/file",fileRoutes);
  app.use("/user", userRoutes);
  app.use("/auth", authRoutes);
  app.use("/subscription",subcriptionRoutes);
  app.use("/share",shareRoutes);
  
  //* running server
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`server started successfully http:localhost:${PORT}`);
  });

} catch (err) {
  console.log("database could not connect");
  console.log(err.message);
}