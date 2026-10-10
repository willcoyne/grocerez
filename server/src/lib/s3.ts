import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

// Constructing the client makes no network calls; credentials come from config (AWS_* env vars).
export const s3 = new S3Client({
  region: config.AWS_REGION,
  credentials: { accessKeyId: config.AWS_ACCESS_KEY_ID, secretAccessKey: config.AWS_SECRET_ACCESS_KEY },
});

export const PUT_EXPIRY_SECONDS = 5 * 60;
export const GET_EXPIRY_SECONDS = 60 * 60;

export type PresignPut = (key: string, contentType: string, expiresIn: number) => Promise<string>;

// content-type must be explicitly signed (the presigner hoists it to an unsigned query param by default);
// signed, S3 rejects a PUT whose Content-Type header differs from the approved image type.
export const presignPut: PresignPut = (key, contentType, expiresIn) =>
  getSignedUrl(s3, new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, ContentType: contentType }), {
    expiresIn,
    signableHeaders: new Set(["content-type"]),
  });

// Server-side upload (product images copied from Open Food Facts, backend/11 step 5).
export const putObject = async (key: string, body: Uint8Array, contentType: string) => {
  await s3.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
};

export const presignGet =(key: string) =>
  getSignedUrl(s3, new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), { expiresIn: GET_EXPIRY_SECONDS });
