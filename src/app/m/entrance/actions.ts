"use server";

// 입구 태블릿 기기 발급·관리 — entrance.manage 전용(perms.ts 주석: 토큰이 곧 물리적 접근점을 여는
// 열쇠라 CTO 전용). 목록·발급·재발급·활성토글만 다룬다(요구사항: "최소한 목록 보기 + 발급 +
// 재발급 버튼이 되면 된다").
import { headers } from "next/headers";
import { guard } from "@/lib/auth";
import { listDevices, issueDevice, reissueDevice, setDeviceActive } from "@/lib/entrance";
import { dateTimeLabel } from "@/lib/date";

async function baseUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

// 클라(EntranceView)는 new Date()/toLocale* 를 쓰지 않는다는 원칙(date.ts 상단 주석)에 맞춰
// 시각은 여기서 KST 라벨 문자열로 미리 만들어 내려준다.
export type DeviceRow = {
  id: string; name: string; active: boolean;
  createdAtLabel: string; reissuedAtLabel: string | null; lastSeenAtLabel: string | null;
};

export async function getDevices(): Promise<DeviceRow[]> {
  const me = await guard("entrance.manage");
  if (!me.activeBranchId) return [];
  const rows = await listDevices(me.activeBranchId);
  return rows.map((d) => ({
    id: d.id, name: d.name, active: d.active,
    createdAtLabel: dateTimeLabel(d.createdAt),
    reissuedAtLabel: d.reissuedAt ? dateTimeLabel(d.reissuedAt) : null,
    lastSeenAtLabel: d.lastSeenAt ? dateTimeLabel(d.lastSeenAt) : null,
  }));
}

const s = (v: FormDataEntryValue | null): string | null => {
  const t = String(v ?? "").trim();
  return t.length ? t : null;
};

export async function issueDeviceAction(formData: FormData): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const me = await guard("entrance.manage");
  if (!me.activeBranchId) return { ok: false, error: "소속 지점을 확인할 수 없습니다." };
  const name = s(formData.get("name")) ?? "입구 태블릿";
  const { id, token } = await issueDevice(me.activeBranchId, name, me.id);
  const base = await baseUrl();
  return { ok: true, url: `${base}/kiosk/${id}/${token}` };
}

export async function reissueDeviceAction(formData: FormData): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await guard("entrance.manage");
  const deviceId = s(formData.get("deviceId"));
  if (!deviceId) return { ok: false, error: "기기를 확인할 수 없습니다." };
  const r = await reissueDevice(deviceId);
  if (!r) return { ok: false, error: "기기를 찾을 수 없습니다." };
  const base = await baseUrl();
  return { ok: true, url: `${base}/kiosk/${deviceId}/${r.token}` };
}

export async function setDeviceActiveAction(formData: FormData): Promise<void> {
  await guard("entrance.manage");
  const deviceId = s(formData.get("deviceId"));
  const active = formData.get("active") === "1";
  if (!deviceId) return;
  await setDeviceActive(deviceId, active);
}
