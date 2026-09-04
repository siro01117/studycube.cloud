"use client";

// 문자 문구 템플릿 편집(=/m/sms 템플릿 탭). 상황별로 제목·본문·켜짐을 고치고, 이용기간 자동 배치의
// 실행 시각(매일, KST)을 설정한다. 큐잉은 여기서 하지 않는다 — 이 화면은 "문구/설정"만 다룬다.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TemplateRow } from "./templateActions";
import { saveSmsTemplate, saveExpiryDailyTime } from "./templateActions";
import { smsByteLength, SMS_LMS_BYTE_THRESHOLD, unknownVariablesIn, renderTemplate, type SmsSituation } from "@/lib/sms-template";

// 미리보기용 예시 값 — 실제 발송값이 아니라 "이 변수 자리에 이런 게 들어간다"를 감 잡게 하는 용도.
const SAMPLE_VARS: Record<string, string> = {
  학생이름: "김학생", 접속코드: "48213", 코드: "48213", 링크: "https://studycube.co.kr/apply",
  제목: "9월 정기고사 일정 안내", 만료일: "9월 15일", 학원이름: "스터디큐브",
};

function ByteMeter({ text }: { text: string }) {
  const n = smsByteLength(text);
  const over = n > SMS_LMS_BYTE_THRESHOLD;
  return (
    <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", color: over ? "var(--danger-strong)" : "var(--sub)" }}>
      {n}바이트{over ? ` · LMS 전환(${SMS_LMS_BYTE_THRESHOLD}바이트 초과, 단가 상승)` : ""}
    </span>
  );
}

function TemplateEditor({ row, canManage }: { row: TemplateRow; canManage: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState(row.title);
  const [body, setBody] = useState(row.body);
  const [enabled, setEnabled] = useState(row.enabled);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = title !== row.title || body !== row.body || enabled !== row.enabled;
  const preview = useMemo(() => renderTemplate(body, SAMPLE_VARS), [body]);
  const unknown = useMemo(() => unknownVariablesIn(row.situation as SmsSituation, body), [row.situation, body]);

  function save() {
    setError(null); setSaved(false);
    const fd = new FormData();
    fd.set("situation", row.situation);
    fd.set("title", title);
    fd.set("body", body);
    if (enabled) fd.set("enabled", "on");
    startTransition(async () => {
      const r = await saveSmsTemplate(fd);
      if (!r.ok) { setError(r.error); return; }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14.5 }}>{row.label}</span>
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{row.auto ? "자동" : "수동"}</span>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--sub)", cursor: canManage ? "pointer" : "default" }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canManage}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {row.auto ? "자동 발송 켜짐" : "보내기 버튼 노출"}
        </label>
      </div>

      <div style={{ fontSize: 12, color: "var(--sub)" }}>
        쓸 수 있는 변수: {row.variables.map((v) => (
          <code key={v} style={{ background: "var(--panel2)", borderRadius: 6, padding: "1px 6px", marginRight: 4, fontSize: 11.5 }}>{`{${v}}`}</code>
        ))}
      </div>

      <div>
        <div className="label">제목(관리용 이름 — 문자에는 안 들어감)</div>
        <input className="input" value={title} disabled={!canManage} onChange={(e) => setTitle(e.target.value)} style={{ height: 38 }} />
      </div>

      <div>
        <div className="label">본문</div>
        <textarea
          className="input"
          value={body}
          disabled={!canManage}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          style={{ resize: "vertical", minHeight: 64, fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <ByteMeter text={body} />
          {unknown.length > 0 && (
            <span style={{ fontSize: 12, color: "var(--danger-strong)" }}>
              이 상황에 없는 변수: {unknown.map((v) => `{${v}}`).join(", ")}
            </span>
          )}
        </div>
      </div>

      <div style={{ background: "var(--panel2)", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, color: "var(--sub)" }}>
        미리보기(예시 값): {preview}
      </div>

      {canManage && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            className="btn btn-accent"
            disabled={!dirty || isPending || unknown.length > 0}
            onClick={save}
            style={{ cursor: "pointer", height: 34, fontSize: 12.5 }}
          >
            저장
          </button>
          {saved && !dirty && <span style={{ fontSize: 12, color: "var(--ok)" }}>저장됨</span>}
          {error && <span style={{ fontSize: 12, color: "var(--danger-strong)" }}>{error}</span>}
          {row.updatedLabel && <span style={{ fontSize: 11.5, color: "var(--faint)", marginLeft: "auto" }}>마지막 수정 {row.updatedLabel}</span>}
        </div>
      )}
    </div>
  );
}

function DailyTimeSetting({ initial, canManage }: { initial: string; canManage: boolean }) {
  const router = useRouter();
  const [time, setTime] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save() {
    setError(null); setSaved(false);
    const fd = new FormData();
    fd.set("time", time);
    startTransition(async () => {
      const r = await saveExpiryDailyTime(fd);
      if (!r.ok) { setError(r.error); return; }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>이용기간 자동 발송 실행 시각</div>
        <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>
          매일 이 시각(KST)에 그날의 만료 임박·만료 대상자를 한 번에 모아 큐에 넣습니다. 발송기가 꺼져
          있었으면 다시 켜졌을 때 그날 안이면 늦게라도 처리됩니다(날짜가 바뀌면 그 몫은 건너뜁니다).
        </div>
      </div>
      <input type="time" className="input" value={time} disabled={!canManage} onChange={(e) => setTime(e.target.value)} style={{ height: 38, width: 120 }} />
      {canManage && (
        <button className="btn btn-accent" disabled={time === initial || isPending} onClick={save} style={{ cursor: "pointer", height: 34, fontSize: 12.5 }}>
          저장
        </button>
      )}
      {saved && time === initial && <span style={{ fontSize: 12, color: "var(--ok)" }}>저장됨</span>}
      {error && <span style={{ fontSize: 12, color: "var(--danger-strong)" }}>{error}</span>}
    </div>
  );
}

export default function TemplatesView({
  rows, expiryDailyTime, canManage,
}: {
  rows: TemplateRow[]; expiryDailyTime: string; canManage: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: "var(--warn-soft, #fdf3e0)", border: "1px solid var(--warn, #d9a441)", borderRadius: 12, padding: "12px 14px", fontSize: 12.5, color: "var(--ink)", lineHeight: 1.6 }}>
        문구에 할인·이벤트·프로모션처럼 홍보성 표현이 들어가면 법적으로 (광고) 표기와 무료수신거부
        번호 안내가 의무입니다. 순수 안내(코드·일정·독촉 등)는 해당하지 않습니다. 이 판단은 자동으로
        하지 않으니(오판이 더 위험합니다) 문구를 고칠 때 직접 확인해 주세요.
      </div>

      <DailyTimeSetting initial={expiryDailyTime} canManage={canManage} />

      {rows.map((row) => (
        <TemplateEditor key={row.situation} row={row} canManage={canManage} />
      ))}
    </div>
  );
}
