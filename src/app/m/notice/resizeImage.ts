"use client";

// 업로드 전 브라우저에서 축소·재인코딩 — 원본 그대로 올리면 DB(bytea)가 금방 찬다. 서버는 이 결과를
// 그대로 믿지 않고 다시 검증한다(src/app/m/notice/actions.ts validateImage) — 여기는 오직 "빠르게
// 작게 만드는" 역할.
import { NOTICE_IMAGE_CLIENT_TARGET_BYTES, NOTICE_IMAGE_MAX_DIMENSION } from "@/lib/notice-image";

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      // 일부 포맷(HEIC 등)은 createImageBitmap이 못 열 수 있다 — <img> 디코딩으로 폴백.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 긴 변을 NOTICE_IMAGE_MAX_DIMENSION 으로 줄이고, 목표 용량(500KB) 아래로 내려갈 때까지 품질을
 * 낮춰가며 재인코딩한다. WebP 를 우선 시도하고(더 작음), 브라우저가 WebP 인코딩을 못 하면(드묾) JPEG 로. */
export async function resizeImageForUpload(file: File): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  const w = "width" in bitmap ? bitmap.width : 0;
  const h = "height" in bitmap ? bitmap.height : 0;
  const scale = Math.min(1, NOTICE_IMAGE_MAX_DIMENSION / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 처리할 수 없습니다.");
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, outW, outH);
  if ("close" in bitmap) bitmap.close();

  const toBlob = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

  let mime = "image/webp";
  let blob = await toBlob(mime, 0.85);
  if (!blob || blob.size === 0) {
    // WebP 인코딩 미지원 브라우저 폴백.
    mime = "image/jpeg";
    blob = await toBlob(mime, 0.85);
  }
  if (!blob) throw new Error("이미지를 압축하지 못했습니다.");

  let quality = 0.7;
  while (blob!.size > NOTICE_IMAGE_CLIENT_TARGET_BYTES && quality >= 0.35) {
    const next = await toBlob(mime, quality);
    if (!next) break;
    blob = next;
    quality -= 0.12;
  }
  return blob!;
}
