"use client";

import { useMemo, useState, useTransition } from "react";
import qrcode from "qrcode-generator";
import type { DeviceRow } from "./actions";
import { issueDeviceAction, reissueDeviceAction, setDeviceActiveAction, getDevices } from "./actions";

// 발급·재발급 직후에만 원문 URL(토큰 포함)을 보여준다 — DB 에는 해시만 남아 이 순간이 지나면 다시
// 볼 방법이 없다(잃어버리면 재발급). 화면 밖(서버 로그·history)에 남기지 않으려고 URL 은 이 state
// 에만 존재하고 새로고침하면 사라진다.
type IssuedUrl = { deviceId: string | null; url: string };

export default function EntranceView({ devices, width }: { devices: DeviceRow[]; width: number }) {
  const [rows, setRows] = useState(devices);
  const [issued, setIssued] = useState<IssuedUrl | null>(null);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function issue() {
    setError(null);
    const fd = new FormData();
    fd.set("name", name);
    startTransition(async () => {
      const r = await issueDeviceAction(fd);
      if (!r.ok) { setError(r.error); return; }
      setIssued({ deviceId: null, url: r.url });
      setName("");
      setRows(await getDevices());
    });
  }

  function reissue(deviceId: string) {
    setError(null);
    const fd = new FormData();
    fd.set("deviceId", deviceId);
    startTransition(async () => {
      const r = await reissueDeviceAction(fd);
      if (!r.ok) { setError(r.error); return; }
      setIssued({ deviceId, url: r.url });
      setRows(await getDevices());
    });
  }

  function toggleActive(deviceId: string, active: boolean) {
    const fd = new FormData();
    fd.set("deviceId", deviceId);
    fd.set("active", active ? "1" : "0");
    startTransition(async () => {
      await setDeviceActiveAction(fd);
      setRows((prev) => prev.map((d) => (d.id === deviceId ? { ...d, active } : d)));
    });
  }

  // QR 은 서버가 아니라 브라우저에서 그린다 — 토큰은 이미 여기 state 에 있으니, QR 을 받으러 서버에
  // 한 번 더 다녀오면 같은 비밀이 왕복만 한 번 늘어난다. errorCorrectionLevel 'M' 은 화면을 카메라로
  // 찍는 환경(반사광·모아레)의 절충으로, 직원 출근 QR(kiosk/actions.ts)과 같은 값으로 맞췄다.
  const qrSvg = useMemo(() => {
    if (!issued) return null;
    const qr = qrcode(0, "M");
    qr.addData(issued.url);
    qr.make();
    return qr.createSvgTag({ scalable: true });
  }, [issued]);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // 클립보드 권한이 없는 브라우저 — 조용히 무시(URL 은 화면에 이미 선택 가능한 텍스트로 떠 있다).
    }
  }

  return (
    <div className="mx-auto" style={{ maxWidth: width, padding: "24px 20px 64px", width: "100%" }}>
      <p style={{ color: "var(--sub)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
        학원 입구에 세워둘 태블릿마다 기기를 하나씩 발급합니다. 발급 직후 뜨는 QR 을 그 태블릿
        카메라로 찍어 주소를 열어두면, 학생이 5자리 코드를 누를 때마다 입실·퇴실이 자동으로
        기록됩니다. 재발급하면 이전 주소는 즉시 못 쓰게 됩니다.
      </p>

      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <label className="label" htmlFor="device-name">새 기기 이름</label>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            id="device-name"
            className="input"
            placeholder="예: 정문 태블릿"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn btn-accent" disabled={pending} onClick={issue}>발급</button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: 14, marginBottom: 20, borderColor: "var(--danger-strong)", color: "var(--danger-strong-ink)", fontSize: 14 }}>
          {error}
        </div>
      )}

      {issued && (
        <div className="card" style={{ padding: 20, marginBottom: 20, borderColor: "var(--accent)" }}>
          <div className="label" style={{ textAlign: "center" }}>
            {issued.deviceId ? "재발급된 주소" : "발급된 주소"} — 태블릿 카메라로 아래 QR 을 찍으세요
          </div>
          {qrSvg && (
            <div
              // QR 자체가 흰 배경과 여백을 품고 있어 테마와 무관하게 스캔된다. 화면을 카메라로 찍는
              // 용도라 280px 로 크게 잡는다 — 이 URL 은 49모듈(버전 9)이라 모듈 하나가 5px 남짓이고, 더 줄이면
              // 보급형 태블릿 카메라가 못 잡는다.
              style={{ width: 280, height: 280, margin: "6px auto 14px", borderRadius: 12, overflow: "hidden", background: "#fff" }}
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <code style={{ flex: 1, fontSize: 13, wordBreak: "break-all", background: "var(--panel2)", padding: "10px 12px", borderRadius: 10 }}>
              {issued.url}
            </code>
            <button className="btn" onClick={() => copy(issued.url)}>복사</button>
          </div>
          <p style={{ color: "var(--faint)", fontSize: 12, marginTop: 10, textAlign: "center" }}>
            QR 이 안 찍히면 위 주소를 태블릿 브라우저에 직접 입력하세요. 이 화면을 벗어나면 주소도 QR 도
            다시 볼 수 없습니다.
          </p>
        </div>
      )}

      <div className="label">발급된 기기 ({rows.length})</div>
      {rows.length === 0 ? (
        <p style={{ color: "var(--faint)", fontSize: 14 }}>아직 발급된 기기가 없습니다.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((d) => (
            <div key={d.id} className="card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{d.name}</div>
                <div style={{ color: "var(--faint)", fontSize: 12, marginTop: 2 }}>
                  발급 {d.createdAtLabel}
                  {d.reissuedAtLabel ? ` · 재발급 ${d.reissuedAtLabel}` : ""}
                  {d.lastSeenAtLabel ? ` · 마지막 사용 ${d.lastSeenAtLabel}` : " · 아직 사용 안 함"}
                  {!d.active ? " · 꺼짐" : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" disabled={pending} onClick={() => reissue(d.id)}>재발급</button>
                <button className="btn" disabled={pending} onClick={() => toggleActive(d.id, !d.active)}>
                  {d.active ? "끄기" : "켜기"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
