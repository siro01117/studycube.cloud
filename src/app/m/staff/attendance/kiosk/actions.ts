"use server";

// 카운터 키오스크 QR 발급 — staff_attendance.manage 권한만(QR을 계속 새로 뽑아내는 화면 자체가
// "출퇴근을 조작할 수 있는" 표면이라 관리 권한으로 건다. src/lib/staff-attendance.ts 참고).
import { headers } from "next/headers";
import qrcode from "qrcode-generator";
import { guard } from "@/lib/auth";
import { issueQrToken, QR_REFRESH_SECONDS, QR_TTL_SECONDS } from "@/lib/staff-attendance";

export type KioskToken = { svg: string; expiresAt: number; refreshSeconds: number; ttlSeconds: number };

/** 요청 헤더로 절대경로 베이스 URL 을 만든다 — QR 은 폰 카메라(앱 내 네비게이션이 아니다)가 여는
 *  링크라 상대경로로는 안 되고, 배포 도메인을 코드에 박아두면 프리뷰·로컬마다 깨지므로 매 요청의
 *  Host 헤더에서 뽑는다(Vercel 이 프록시 뒤에서도 x-forwarded-host/proto 를 정확히 채워준다). */
async function baseUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export async function issueKioskToken(): Promise<KioskToken> {
  const me = await guard("staff_attendance.manage");
  const branch = me.activeBranchId!;
  const base = await baseUrl();
  const { url, expiresAt } = await issueQrToken(branch, base);
  // errorCorrectionLevel 'M' — 화면 촬영 스캔이라 오염(반사광 등) 여지가 있는 환경에 적당한 절충.
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const svg = qr.createSvgTag({ scalable: true });
  return { svg, expiresAt, refreshSeconds: QR_REFRESH_SECONDS, ttlSeconds: QR_TTL_SECONDS };
}
