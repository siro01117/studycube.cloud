// PIN 해시 (6자리 PIN → 저장용 해시). 원문 PIN은 저장 안 함.
// 관리자는 원문 조회가 아니라 "재발급"만 가능 (보안).
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const h = scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${h}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, h] = stored.split(":");
  if (!salt || !h) return false;
  const calc = scryptSync(pin, salt, 32);
  const want = Buffer.from(h, "hex");
  return calc.length === want.length && timingSafeEqual(calc, want);
}

// 6자리 숫자 PIN 자동 생성
export function genPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
