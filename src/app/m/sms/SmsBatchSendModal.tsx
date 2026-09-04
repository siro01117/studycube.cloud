"use client";

// 수동 문자 발송 공용 모달 — 대상 선택(전체 선택 포함) → 미리보기(실제 나갈 문구·번호 없는 사람) →
// 확정. 학생 관리(access_code)·스케쥴(schedule_reminder) 둘 다 이 컴포넌트를 재사용한다(같은 흐름
// — 대상 후보 목록 + 템플릿을 받아 고르고 보내는 것뿐이라 화면마다 새로 만들 이유가 없다).
// 브라우저 confirm() 금지 — 이 모달 자체가 그 "화면 안 2단계"다(목록 → 미리보기 → 보내기).
import { useMemo, useState, useTransition } from "react";
import Modal from "../_shared/Modal";
import { renderTemplate, smsByteLength, SMS_LMS_BYTE_THRESHOLD } from "@/lib/sms-template";
import type { SmsCandidate, SendSmsResult } from "../student/smsActions";

export default function SmsBatchSendModal({
  title, situationLabel, candidates, template, vars, onClose, onSend,
}: {
  title: string; // 모달 헤더(예: "링크·로그인 코드 안내 보내기")
  situationLabel: string; // 대상 없음/꺼짐 안내에 쓸 이름
  candidates: SmsCandidate[];
  template: { title: string; body: string; enabled: boolean };
  // 후보별 미리보기 변수 — access_code 는 학생마다 코드가 달라 함수로 받는다.
  vars: (c: SmsCandidate) => Record<string, string>;
  onClose: () => void;
  onSend: (studentIds: string[]) => Promise<SendSmsResult>;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(candidates.filter((c) => c.phone).map((c) => c.id)));
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SendSmsResult | null>(null);

  const noPhone = candidates.filter((c) => !c.phone);
  const selectableIds = candidates.filter((c) => c.phone).map((c) => c.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const selectedList = candidates.filter((c) => selected.has(c.id) && c.phone);
  const first = selectedList[0];
  const preview = first ? renderTemplate(template.body, vars(first)) : "";
  const byteN = smsByteLength(preview);

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function confirmSend() {
    const ids = selectedList.map((c) => c.id);
    startTransition(async () => {
      const r = await onSend(ids);
      setResult(r);
    });
  }

  const shown = expanded ? candidates : candidates.slice(0, 8);
  const restCount = candidates.length - shown.length;

  return (
    <Modal
      onClose={onClose}
      backdropBackground="rgba(20,22,30,.45)"
      backdropZIndex={70}
      panelZIndex={71}
      panelStyle={{
        width: 520, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100dvh - 60px)", overflowY: "auto",
        background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "var(--shadow-lg)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{title}</div>
        <button onClick={onClose} className="chip" style={{ height: 30, width: 30, padding: 0, justifyContent: "center", cursor: "pointer" }}>✕</button>
      </div>

      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        {result ? (
          <div style={{ padding: "20px 4px", textAlign: "center" }}>
            {result.ok ? (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ok)" }}>{result.queued}건 큐에 담았습니다.</div>
                {result.skippedNoPhone > 0 && (
                  <div style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 6 }}>{result.skippedNoPhone}건은 건너뛰었습니다(번호 없음 등).</div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 13.5, color: "var(--danger-strong)" }}>{result.error}</div>
            )}
            <button className="btn btn-accent" onClick={onClose} style={{ height: 38, marginTop: 16, cursor: "pointer" }}>닫기</button>
          </div>
        ) : !template.enabled ? (
          <div style={{ fontSize: 13, color: "var(--sub)", padding: "16px 4px" }}>
            {situationLabel} 상황이 꺼져 있습니다. 문자 발송함 &gt; 템플릿에서 먼저 켜세요.
          </div>
        ) : candidates.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--sub)", padding: "16px 4px" }}>대상이 없습니다.</div>
        ) : (
          <>
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, padding: "4px 2px" }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                전체 선택 ({selected.size}/{candidates.length}명)
              </label>
              <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 10, marginTop: 6 }}>
                {shown.map((c) => (
                  <label
                    key={c.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", fontSize: 13,
                      borderTop: "1px solid var(--line)", opacity: c.phone ? 1 : 0.5,
                    }}
                  >
                    <input type="checkbox" checked={selected.has(c.id)} disabled={!c.phone} onChange={() => toggleOne(c.id)} />
                    <span>{c.name}</span>
                    <span style={{ marginLeft: "auto", fontSize: 12, color: c.phone ? "var(--sub)" : "var(--danger-strong)" }}>
                      {c.phone ?? "번호 없음"}
                    </span>
                  </label>
                ))}
                {restCount > 0 && (
                  <button className="chip" onClick={() => setExpanded(true)} style={{ margin: 8, cursor: "pointer" }}>
                    {restCount}명 더 보기
                  </button>
                )}
              </div>
            </div>

            {noPhone.length > 0 && (
              <div style={{ background: "var(--warn-soft, #fdf3e0)", border: "1px solid var(--warn, #d9a441)", borderRadius: 10, padding: "8px 10px", fontSize: 12.5, color: "var(--ink)" }}>
                번호가 없어 빠지는 {noPhone.length}명: {noPhone.map((c) => c.name).join(", ")}
              </div>
            )}

            <div>
              <div className="label">실제로 나갈 문구(첫 번째 대상 기준)</div>
              <div style={{ background: "var(--panel2)", borderRadius: 10, padding: "10px 12px", fontSize: 13, lineHeight: 1.6 }}>
                {first ? preview : "대상을 선택하세요."}
              </div>
              {first && (
                <div style={{ fontSize: 12, marginTop: 4, color: byteN > SMS_LMS_BYTE_THRESHOLD ? "var(--danger-strong)" : "var(--sub)" }}>
                  {byteN}바이트{byteN > SMS_LMS_BYTE_THRESHOLD ? " · LMS 전환" : ""}
                </div>
              )}
            </div>

            <button
              className="btn btn-accent"
              disabled={selectedList.length === 0 || isPending}
              onClick={confirmSend}
              style={{ height: 44, cursor: "pointer" }}
            >
              {selectedList.length}명에게 보내기
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
