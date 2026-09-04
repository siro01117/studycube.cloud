// 공지 사진 규칙의 단일 출처 — 브라우저(업로드 전 축소)와 서버(재검증) 양쪽이 이 값을 그대로 쓴다.
// 순수 함수만 두고 node 전용 API 는 import 하지 않는다("use client" 컴포넌트에서도 그대로 불러 쓴다).

// 장당 목표(클라 축소 목표) — 긴 변 1600px 로 줄이고 500KB 를 넘으면 품질을 더 낮춘다.
export const NOTICE_IMAGE_MAX_DIMENSION = 1600;
export const NOTICE_IMAGE_CLIENT_TARGET_BYTES = 500 * 1024;
// 서버 상한 — 클라 목표(500KB)에 인코더 오차 여유를 더한 값. 이보다 크면 클라가 줄였다는 말을
// 믿지 않고 거부한다(schema.modules.ts notice_image.byte_size check 와 반드시 같은 값이어야 한다).
export const NOTICE_IMAGE_SERVER_MAX_BYTES = 600 * 1024;
// 공지 하나당 사진 장수 상한 — SNS 카드로 스와이프해서 볼 수 있는 범위(6장 x 500KB ≈ 3MB/공지)로
// 잡았다. 너무 많으면 DB 용량(Supabase 무료 500MB)이 빨리 찬다.
export const NOTICE_IMAGE_MAX_COUNT = 6;

export type NoticeImageType = "image/jpeg" | "image/webp";
export const NOTICE_IMAGE_ALLOWED_TYPES: readonly NoticeImageType[] = ["image/jpeg", "image/webp"];

/** 매직 바이트로 실제 이미지 형식을 판별한다 — Content-Type 헤더나 확장자는 신뢰하지 않는다.
 * image/svg+xml 은 스크립트가 실행될 수 있어 애초에 허용 목록에 없다(여기서 절대 반환되지 않음). */
export function sniffImageType(bytes: Uint8Array): NoticeImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
