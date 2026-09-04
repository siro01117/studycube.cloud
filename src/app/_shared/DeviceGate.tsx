"use client";

// 폰용 터치 화면(/seat, /patrol, /records) 최상단에 얹는다.
// - 이 기기가 이미 "태블릿"으로 기억돼 있으면 곧장 태블릿 화면(/t/*)으로 보낸다.
// - 처음 보는 기기인데 터치+태블릿 폭이면 "태블릿 화면으로 볼까요?" 배너를 한 번 띄운다.
// - 아니오를 누르면 다시 묻지 않는다(phone 으로 기억).
// 자동으로 완전히 넘겨버리지 않는 이유: 손가락 입력 폭 판정은 오판 가능(폴더블·거치대 PC 등) —
// 데스크톱 사용자가 태블릿 화면에 갇히면 안 된다(요구사항). 그래서 최초 1회는 사용자 확인을 거친다.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getDeviceMode, setDeviceMode, looksLikeTablet, PHONE_TO_TABLET } from "./device";

export default function DeviceGate({ current }: { current: keyof typeof PHONE_TO_TABLET }) {
  const router = useRouter();
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    const mode = getDeviceMode();
    if (mode === "tablet") { router.replace(PHONE_TO_TABLET[current]); return; }
    if (mode === null && looksLikeTablet()) setAsk(true);
  }, [current, router]);

  if (!ask) return null;

  return (
    <div style={{
      position: "fixed", left: 10, right: 10, top: "calc(8px + env(safe-area-inset-top))", zIndex: 70,
      background: "var(--ink)", color: "#fff", borderRadius: 14, padding: "12px 14px",
      display: "flex", alignItems: "center", gap: 10, boxShadow: "0 8px 24px rgba(10,12,18,.25)",
    }}>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 700, lineHeight: 1.4 }}>
        태블릿을 쓰시는군요. 더 크고 손에 편한 화면으로 볼까요?
      </span>
      <button
        onClick={() => { setDeviceMode("phone"); setAsk(false); }}
        style={{ flex: "none", height: 36, padding: "0 12px", borderRadius: 999, border: "1px solid rgba(255,255,255,.3)", background: "transparent", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
      >아니오</button>
      <button
        onClick={() => { setDeviceMode("tablet"); router.replace(PHONE_TO_TABLET[current]); }}
        style={{ flex: "none", height: 36, padding: "0 14px", borderRadius: 999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}
      >태블릿 화면</button>
    </div>
  );
}
