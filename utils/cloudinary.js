import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export function uploadToCloudinary(buffer, userId) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder: "users",
        public_id: userId,
        overwrite: true,
        resource_type: "image",
      },
      (error, result) => {
        if (error) return reject(error);

        resolve({
          publicId: result.public_id,
          version: result.version?.toString() ?? null,
        });
      }
    ).end(buffer);
  });
}

export async function uploadOAuthAvatarToCloudinary(imageUrl, userId) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error("Failed to fetch image from Google");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return await uploadToCloudinary(buffer, userId);
}

export function getProfileImageUrl(publicId, version) {
  if (!publicId) return null;

  return cloudinary.url(publicId, {
    width: 300,
    height: 300,
    crop: "fill",
    gravity: "face",
    quality: "auto",
    fetch_format: "auto",
    dpr: "auto",
    sharpen: "auto",
    version,
  });
}
