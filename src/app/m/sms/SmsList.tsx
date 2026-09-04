"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { SmsRow } from "./actions";
import { retrySms, deleteSms, addTestSms } from "./actions";

const KIND_LABEL: Record<string, string> = {
  test: "테스트",
  access_code: "링크·로그인 코드 안내",
  schedule_reminder: "스케쥴 미제출 독촉",
  attend_in: "입실 알림",
  attend_out: "퇴실 알림",
  expiry_reminder: "이용기간 만료 임박",
  expired: "이용기간 만료",
  unpaid_reminder: "미납 안내",
  notice_broadcast: "공지 병행발송",
  manual: "수동 입력",
};

const RetryIcon = () => (
  <svg viewBox="0 0 20 20" style={{ width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
    <path d="M4 10a6 6 0 1 1 1.8 4.3" /><path d="M4 14v-3.5H7.5" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 20 20" style={{ width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
    <path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6M5.5 6l.6 9.5A1.5 1.5 0 0 0 7.6 17h4.8a1.5 1.5 0 0 0 1.5-1.5L14.5 6" />
  </svg>
);

export type SmsTab = "pending" | "sent" | "failed" | "templates";
const TABS: { key: SmsTab; label: string }[] = [
  { key: "pending", label: "대기" },
  { key: "sent", label: "성공" },
  { key: "failed", label: "실패" },
  { key: "templates", label: "템플릿" },
];

export default function SmsList({
  rows, tab, canManage, width, templatesNode,
}: {
  rows: SmsRow[]; tab: SmsTab; canManage: boolean; width: number;
  templatesNode?: ReactNode; // tab==='templates' 일 때 표 대신 이걸 보여준다(TemplatesView, page.tsx 가 서버에서 데이터를 받아 주입)
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null); // 인라인 2단계 확인(삭제) — window.confirm() 금지
  const [testOpen, setTestOpen] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  function switchTab(next: SmsTab) {
    router.push(`/m/sms?tab=${next}`);
  }

  function runRetry(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => { await retrySms(fd); router.refresh(); });
  }

  function runDelete(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => { await deleteSms(fd); setConfirmId(null); router.refresh(); });
  }

  async function submitTest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTestError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await addTestSms(fd);
      if (!r.ok) { setTestError(r.error); return; }
      setTestOpen(false);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ maxWidth: width, margin: "0 auto", padding: "20px 24px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                className="chip"
                onClick={() => switchTab(t.key)}
                style={{
                  cursor: "pointer",
                  background: tab === t.key ? "var(--accent-soft)" : "var(--panel2)",
                  borderColor: tab === t.key ? "var(--accent)" : "var(--line)",
                  color: tab === t.key ? "var(--accent)" : "var(--sub)",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {canManage && tab !== "templates" && (
            <button className="btn btn-accent" style={{ cursor: "pointer" }} onClick={() => setTestOpen((v) => !v)}>
              테스트 발송 추가
            </button>
          )}
        </div>

        {tab === "templates" ? (
          templatesNode
        ) : (
          <>
        {canManage && testOpen && (
          <form onSubmit={submitTest} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12.5, color: "var(--sub)" }}>
              발송기 배선 확인용. testmode_yn=Y 로 실행하면 실제로 문자가 나가지 않고 알리고 응답만 확인한다.
              지금은 IP 화이트리스트 때문에 알리고가 &quot;-101 IP 인증오류&quot;를 돌려주는 게 정상이다.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <input name="phone" className="input" placeholder="받는 번호(010-0000-0000)" style={{ flex: 1 }} required />
              <input name="body" className="input" placeholder="내용(비우면 기본 테스트 문구)" style={{ flex: 2 }} />
              <button type="submit" className="btn btn-accent" disabled={isPending} style={{ cursor: "pointer" }}>추가</button>
            </div>
            {testError && <div style={{ fontSize: 12.5, color: "var(--danger-strong)" }}>{testError}</div>}
          </form>
        )}

        {rows.length === 0 ? (
          <div className="card" style={{ padding: "48px 16px", textAlign: "center", color: "var(--faint)", fontSize: 13.5 }}>
            {tab === "pending" && "대기 중인 문자가 없습니다."}
            {tab === "sent" && "아직 보낸 문자가 없습니다."}
            {tab === "failed" && "실패한 문자가 없습니다."}
          </div>
        ) : (
          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  {["받는 번호", "종류", "내용", "학생", "요청", "상태", ""].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "10px 12px", color: "var(--faint)", fontWeight: 400, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "10px 12px", fontVariantNumeric: "tabular-nums" }}>{r.phone}</td>
                    <td style={{ padding: "10px 12px", color: "var(--sub)" }}>{KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td style={{ padding: "10px 12px", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.body}>{r.body}</td>
                    <td style={{ padding: "10px 12px", color: "var(--sub)" }}>{r.studentName ?? "-"}</td>
                    <td style={{ padding: "10px 12px", color: "var(--sub)", fontVariantNumeric: "tabular-nums" }}>
                      {r.requestedLabel}{r.requestedByName ? ` · ${r.requestedByName}` : ""}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {tab === "pending" && (
                        <span style={{ fontSize: 12, color: "var(--warn, #d9a441)" }}>
                          {r.status === "sending" ? "발송중" : "대기"}{r.attempts > 0 ? ` · 시도 ${r.attempts}` : ""}
                        </span>
                      )}
                      {tab === "sent" && <span style={{ fontSize: 12, color: "var(--ok)" }}>성공{r.sentLabel ? ` · ${r.sentLabel}` : ""}</span>}
                      {tab === "failed" && (
                        <span style={{ fontSize: 12, color: "var(--danger-strong)" }} title={r.lastError}>
                          실패{r.lastError ? ` · ${r.lastError.slice(0, 40)}` : ""}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {canManage && tab === "failed" && (
                        <button className="chip" style={{ cursor: "pointer", marginRight: 6 }} onClick={() => runRetry(r.id)} disabled={isPending}>
                          <RetryIcon /> 다시 보내기
                        </button>
                      )}
                      {canManage && (
                        confirmId === r.id ? (
                          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                            <span style={{ fontSize: 12, color: "var(--danger-strong)" }}>삭제할까요?</span>
                            <button className="chip" style={{ cursor: "pointer", color: "var(--danger-strong)" }} onClick={() => runDelete(r.id)} disabled={isPending}>삭제</button>
                            <button className="chip" style={{ cursor: "pointer" }} onClick={() => setConfirmId(null)}>취소</button>
                          </span>
                        ) : (
                          <button className="chip" style={{ cursor: "pointer" }} onClick={() => setConfirmId(r.id)}>
                            <TrashIcon />
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
