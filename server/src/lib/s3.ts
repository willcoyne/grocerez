import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";
import { notConfigured } from "./errors.js";

let client: S3Client | null = null;

export const s3Configured = () =>
  !!(config.S3_BUCKET && config.AWS_REGION && config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY);

function getClient(): S3Client {
  if (!s3Configured()) throw notConfigured("File storage (S3)");
  client ??= new S3Client({
    region: config.AWS_REGION,
    credentials: { accessKeyId: config.AWS_ACCESS_KEY_ID!, secretAccessKey: config.AWS_SECRET_ACCESS_KEY! },
  });
  return client;
}

/**
 * The private bucket behind presigned URLs (backend/11). Behind an object so tests can stub it.
 * The IAM user only needs s3:PutObject and s3:GetObject on arn:aws:s3:::<bucket>/*.
 */
export const s3 = {
  isConfigured: s3Configured,

  /** Presigned PUT (5 minutes). The Content-Type the app sends must equal `contentType`. */
  presignPut: (key: string, contentType: string) =>
    getSignedUrl(getClient(), new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, ContentType: contentType }), {
      expiresIn: 300,
    }),

  /** Presigned GET (1 hour). */
  presignGet: (key: string) =>
    getSignedUrl(getClient(), new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), { expiresIn: 3600 }),

  /** Server-side upload (product images copied from Open Food Facts). */
  putObject: async (key: string, body: Uint8Array, contentType: string) => {
    await getClient().send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
  },
};
