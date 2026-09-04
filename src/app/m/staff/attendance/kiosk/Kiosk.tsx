"use client";

// 카운터 데스크톱 QR 표시. 서버(issueKioskToken)가 매번 새 서명 토큰을 발급하고, 여기는 받은 SVG를
// 그대로 그리고 남은 시간만 센다 — 토큰을 클라이언트가 만들지 않는다는 원칙을 지키기 위해 "새로고침"도
// 반드시 서버 액션 왕복으로만 한다(로컬 카운트다운은 표시용일 뿐 유효성 판정에 관여하지 않는다).
import { useCallback, useEffect, useRef, useState } from "react";
import { issueKioskToken } from "./actions";

export default function Kiosk() {
  const [svg, setSvg] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null); // unix 초
  const [refreshSeconds, setRefreshSeconds] = useState(6);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [err, setErr] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await issueKioskToken();
      setSvg(r.svg);
      setExpiresAt(r.expiresAt);
      setRefreshSeconds(r.refreshSeconds);
      setErr(null);
    } catch {
      setErr("QR 발급에 실패했습니다. 잠시 후 다시 시도합니다.");
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, refreshSeconds * 1000);
    timerRef.current = t;
    return () => clearInterval(t);
    // refreshSeconds 는 서버가 내려준 값이 바뀔 일이 거의 없지만, 바뀌면 새 주기로 다시 건다.
  }, [refresh, refreshSeconds]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const left = expiresAt != null ? Math.max(0, expiresAt - now) : null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 24 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--sub)" }}>폰 카메라로 QR을 찍으면 출근·퇴근이 기록됩니다</div>
      <div
        style={{
          // QR 은 스캔 성공률이 최우선이라 항상 흰 배경 위에 그린다 — 다크 모드에서도 테마 토큰을
          // 쓰지 않는다(테마가 어두우면 배경이 어두워져 대비가 무너지고 스캔이 안 될 수 있다).
          width: 320, height: 320, background: "#fff", borderRadius: 20, padding: 20,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "var(--shadow-lg)", border: "1px solid var(--line)",
        }}
      >
        {svg ? (
          <div style={{ width: "100%", height: "100%" }} dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <span style={{ fontSize: 13, color: "#999" }}>불러오는 중…</span>
        )}
      </div>
      {err && <div style={{ fontSize: 13, color: "var(--danger-strong)" }}>{err}</div>}
      {left != null && (
        <div style={{ fontSize: 13, color: "var(--faint)", fontVariantNumeric: "tabular-nums" }}>
          {left}초 후 갱신
        </div>
      )}
    </div>
  );
}
