import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKETS, getPublicUrl } from "@brandblitz/storage";
import { authenticate } from "../middleware/authenticate";
import { uploadLimiter } from "../middleware/rate-limit";
import { createError } from "../middleware/error";

const router = Router();

const ALLOWED_UPLOAD_TYPES = {
  "brand-logo":    { bucket: BUCKETS.BRAND_ASSETS, prefix: "logos/",    maxMb: 2 },
  "product-image": { bucket: BUCKETS.BRAND_ASSETS, prefix: "products/", maxMb: 5 },
  "user-avatar":   { bucket: BUCKETS.BRAND_ASSETS, prefix: "avatars/",  maxMb: 1 },
} as const;

const ALLOWED_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];

const PresignSchema = z.object({
  type: z.enum(["brand-logo", "product-image", "user-avatar"]),
  contentType: z.enum(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]),
  contentLength: z.number().int().positive(),
});

/**
 * POST /upload/presign
 * Generate a presigned PUT URL for direct client → storage upload.
 * Files NEVER pass through the API server — no memory pressure.
 */
router.post("/presign", authenticate, uploadLimiter, async (req, res) => {
  const { type, contentType, contentLength } = PresignSchema.parse(req.body);

  const config = ALLOWED_UPLOAD_TYPES[type];
  if (contentLength > config.maxMb * 1024 * 1024) {
    throw createError(
      `Content length exceeds maximum of ${config.maxMb}MB for ${type}`,
      400
    );
  }

  const key = `${config.prefix}${randomUUID()}`;

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 });

  res.json({
    uploadUrl,
    key,
    publicUrl: getPublicUrl(config.bucket, key),
    expiresIn: 60,
  });
});

/**
 * POST /upload/verify
 * Verify a file was actually uploaded before accepting it in a form.
 */
router.post("/verify", authenticate, async (req, res) => {
  const { key } = z.object({ key: z.string() }).parse(req.body);

  // Determine bucket from key prefix
  const bucket = key.startsWith("logos/") || key.startsWith("products/") || key.startsWith("avatars/")
    ? BUCKETS.BRAND_ASSETS
    : BUCKETS.SHARE_CARDS;

  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    res.json({ exists: true, publicUrl: getPublicUrl(bucket, key) });
  } catch {
    throw createError("File not found in storage", 404);
  }
});

export default router;
