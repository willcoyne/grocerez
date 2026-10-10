import type { PresignBody, PresignResponse } from "@contracts/uploads";
import * as ImagePicker from "expo-image-picker";

import { api, ApiError } from "../client";

const TYPES: PresignBody["contentType"][] = ["image/jpeg", "image/png", "image/webp"];

/**
 * Pick a photo and upload it straight to S3 (backend/11): POST /uploads/presign → PUT the file with the same
 * Content-Type → return the `key` for PATCH /me {avatarKey} or PATCH cabinet {photoKey}. Null if the user cancelled.
 * Without AWS settings the server answers 503 NOT_CONFIGURED (shown as "isn't set up").
 */
export async function pickAndUploadImage(purpose: PresignBody["purpose"]): Promise<string | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, allowsEditing: true, aspect: [1, 1] });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  const contentType = TYPES.includes(asset.mimeType as PresignBody["contentType"])
    ? (asset.mimeType as PresignBody["contentType"])
    : "image/jpeg";
  const { uploadUrl, key } = await api<PresignResponse>("/uploads/presign", { method: "POST", body: { contentType, purpose } });
  const file = await fetch(asset.uri);
  const blob = await file.blob();
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
  if (!put.ok) throw new ApiError(put.status, "UPLOAD_FAILED", "The photo upload failed. Try again.");
  return key;
}
