// 이 기기가 "태블릿 모드"를 쓰기로 했는지 기억한다 — 화면 폭이 아니라 사용자의 선택을 저장한다.
// (집주인 지적: 태블릿은 화면 비율로 폰/PC와 구분이 안 된다. 그래서 폭 대신 localStorage 로 기억.)
// 서버에는 없는 클라이언트 전용 값이라 이 파일은 "use client" 컴포넌트에서만 import 한다.
const KEY = "sc-device-mode";
export type DeviceMode = "phone" | "tablet";

export function getDeviceMode(): DeviceMode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "phone" || v === "tablet" ? v : null;
  } catch {
    return null;
  }
}

export function setDeviceMode(mode: DeviceMode) {
  try { localStorage.setItem(KEY, mode); } catch { /* noop */ }
}

// 태블릿일 가능성이 높은 기기인지 대략 추정 — 자동 진입은 하지 않고(오판 시 데스크톱 사용자가
// 갇히면 안 됨), 선택 배너를 띄울지 여부를 정하는 데만 쓴다.
// 손가락 입력(pointer: coarse) + 폭 768~1180px(그 이상은 데스크톱 거치대/키보드 결합형으로 본다).
export function looksLikeTablet(): boolean {
  try {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const w = window.innerWidth;
    return coarse && w >= 768 && w < 1180;
  } catch {
    return false;
  }
}

// 폰 전용 터치 화면 ↔ 태블릿 전용 터치 화면 경로 대응표(같은 데이터·같은 서버 액션, 크기 모드만 다름).
export const PHONE_TO_TABLET: Record<string, string> = {
  "/seat": "/t/seat",
  "/patrol": "/t/patrol",
  "/records": "/t/records",
};
export const TABLET_TO_PHONE: Record<string, string> = {
  "/t/seat": "/seat",
  "/t/patrol": "/patrol",
  "/t/records": "/records",
};
