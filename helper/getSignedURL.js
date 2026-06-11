import s3Client from "../config/s3.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { createCloudFrontSignedUrl } from "../service/cloudfront.js";


export const getSignedURL = async (fileData, type) => {
  const key = `${fileData._id}${fileData.extension}`;
  const disposition =
    type === "download"
      ? `attachment; filename="${encodeURIComponent(fileData.name)}"`
      : `inline; filename="${encodeURIComponent(fileData.name)}"`;

  const url =
    type === "download"
      ? await getSignedUrl(
          s3Client,
          new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
            ResponseContentDisposition: disposition,
            ResponseContentType: fileData.contentType || "application/octet-stream",
          }),
          { expiresIn: 60 * 60 },
        )
      : createCloudFrontSignedUrl(key, {
          "response-content-disposition": disposition,
          "response-content-type": fileData.contentType || "application/octet-stream",
        });

  return url;
};
