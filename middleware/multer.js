import multer from "multer";

export const uploadSingleImage = (fieldName, maxSizeMB = 2) => {
  
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxSizeMB * 1024 * 1024, // ✅ dynamic
    },
    fileFilter: (req, file, cb) => {
      const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

      if (!allowedTypes.includes(file.mimetype)) {
        return cb(new Error("Only image files allowed"), false);
      }

      cb(null, true);
    },
  });

  return (req, res, next) => {
    const contentType = req.headers["content-type"] || "";

    // Avoid multipart parsing work for requests that only update text fields.
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return next();
    }

    upload.single(fieldName)(req, res, (err) => {

      if (err?.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: `File must be under ${maxSizeMB}MB`,
        });
      }

      if (err) {
        return res.status(400).json({ error: err.message });
      }

      next();
    });
  };
};
