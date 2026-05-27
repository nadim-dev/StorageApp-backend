import cron from "node-cron";
import { updateDirectorySize } from "../helper/updateDirectorySize.js";
import File from "../models/fileModel.js";
import s3Client from "../config/s3.js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import Subcribe from "../models/subscriptionModel.js";

cron.schedule("0 * * * *", async () => {

   console.log("Running expired subscription cleanup");

   try {

      const expiredSubscriptions = await Subcribe.find({
         status: "cancelled",
         currentPeriodEnd: {
            $lte: new Date()
         }
      });
      for (const subscription of expiredSubscriptions) {
         try {
            const userId = subscription.userId;
            const filesToDelete = await File.find({
               userId,
               plan: "paidTier"
            });

            if (filesToDelete.length === 0) {
               subscription.status = "expired";
               await subscription.save();
               continue;
            }

            const deletedFileIds = [];

            for (const file of filesToDelete) {

               try {

                  const command = new DeleteObjectCommand({
                     Bucket: process.env.AWS_BUCKET_NAME,
                     Key: `${file._id}${file.extension}`,
                  });

                  //* delete from s3
                  await s3Client.send(command);

                  //* update directory size
                  await updateDirectorySize(
                     file.parentDirId,
                     -file.size
                  );

                  deletedFileIds.push(file._id);

               } catch (error) {

                  console.log(
                     `Failed to delete file ${file._id}`,
                     error
                  );
               }
            }

            //* delete successfully removed files from mongodb
            if (deletedFileIds.length > 0) {

               await File.deleteMany({
                  _id: { $in: deletedFileIds }
               });
            }

            //* only mark expired if all files deleted successfully
            if (deletedFileIds.length === filesToDelete.length) {

               subscription.status = "expired";

               await subscription.save();

               console.log(
                  `Subscription expired for user ${userId}`
               );

            } else {

               console.log(
                  `Partial cleanup for user ${userId}`
               );
            }

         } catch (error) {

            console.log(
               `Failed processing subscription ${subscription._id}`,
               error
            );
         }
      }

   } catch (error) {

      console.log(
         "Subscription cleanup cron failed",
         error
      );
   }

});

