"use client";

// 재무제표 본문 — 월 손익 요약 + 분류별 내역 + 12개월 추이 + 장부(목록/추가/수정/삭제).
// 삭제는 저장소 규칙대로 하드 삭제 + 5초 실행취소 토스트(window.confirm 금지, UndoToast.tsx 참고).
import { useMemo, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import Modal from "../_shared/Modal";
import { useUndoToast } from "../_shared/UndoToast";
import { won, INCOME_CATEGORIES, EXPENSE_CATEGORIES, categoryLabel, PAYROLL_CATEGORY, type FinanceDirection } from "@/lib/finance";
import { addEntry, updateEntry, deleteEntry, restoreEntry, type MonthData, type LedgerRow, type CategorySummaryRow } from "./actions";
import Trend, { TrendLegend } from "./Trend";

const inputStyle: CSSProperties = { height: 38, borderRadius: 8, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)", padding: "0 10px", fontSize: 13.5 };
const th: CSSProperties = { textAlign: "left", padding: "9px 12px", fontSize: 12, fontWeight: 700, color: "var(--sub)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "9px 12px", fontSize: 13.5, borderBottom: "1px solid var(--line)", verticalAlign: "top" };

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: "ok" | "danger" | "accent" }) {
  const color = tone === "ok" ? "var(--ok)" : tone === "danger" ? "var(--danger-strong)" : "var(--accent)";
  return (
    <div style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 14, background: "var(--card)", padding: "16px 18px" }}>
      <div style={{ fontSize: 12.5, color: "var(--sub)", fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, letterSpacing: "-.01em" }}>{value}</div>
    </div>
  );
}

function AmountField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  // 입력 규칙(저장소 관례): onChange 는 숫자만 남기고, blur 에서 e.currentTarget.value 를 다시 읽어
  // 정규화(선행 0 제거)한다. 도중에 포맷(콤마 삽입 등)을 끼워 넣지 않는다 — 커서 위치가 튀는 사고 방지.
  return (
    <input
      className="input" style={{ ...inputStyle, textAlign: "right" }} inputMode="numeric" placeholder="0" autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value.replace(/[^0-9]/g, ""))}
      onBlur={(e) => { const n = parseInt(e.currentTarget.value.replace(/[^0-9]/g, ""), 10); onChange(Number.isFinite(n) ? String(n) : ""); }}
    />
  );
}

type EntryForm = { id?: string; direction: FinanceDirection; category: string; date: string; amount: string; memo: string };

function EntryModal({
  initial, todayIso, canPayroll, onClose, onSaved,
}: {
  initial: EntryForm; todayIso: string; canPayroll: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [direction, setDirection] = useState<FinanceDirection>(initial.direction);
  const [category, setCategory] = useState(() => {
    if (initial.category) return initial.category;
    const opts = (initial.direction === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).filter((c) => c.key !== PAYROLL_CATEGORY || canPayroll);
    return opts[0]?.key ?? "";
  });
  const [date, setDate] = useState(initial.date || todayIso);
  const [amount, setAmount] = useState(initial.amount);
  const [memo, setMemo] = useState(initial.memo);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isEdit = !!initial.id;

  const options = (direction === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)
    .filter((c) => c.key !== PAYROLL_CATEGORY || canPayroll);

  const changeDirection = (d: FinanceDirection) => {
    setDirection(d);
    const opts = (d === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).filter((c) => c.key !== PAYROLL_CATEGORY || canPayroll);
    if (!opts.some((o) => o.key === category)) setCategory(opts[0]?.key ?? "");
  };

  const save = () => {
    setError(null);
    if (!date) { setError("날짜를 입력하세요."); return; }
    if (!category) { setError("분류를 선택하세요."); return; }
    const n = parseInt(amount, 10);
    if (!Number.isFinite(n) || n <= 0) { setError("금액을 입력하세요."); return; }
    const fd = new FormData();
    if (initial.id) fd.set("id", initial.id);
    fd.set("direction", direction);
    fd.set("category", category);
    fd.set("date", date);
    fd.set("amount", String(n));
    fd.set("memo", memo);
    start(async () => {
      const r = isEdit ? await updateEntry(fd) : await addEntry(fd);
      if (r.ok) onSaved(); else setError(r.error);
    });
  };

  return (
    <Modal
      onClose={onClose}
      backdropBackground="rgba(20,22,30,.45)" backdropZIndex={62} panelZIndex={63}
      ariaLabelledBy="finance-entry-title"
      panelStyle={{ width: 420, maxWidth: "calc(100vw - 32px)", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 18, boxShadow: "0 24px 70px rgba(20,22,30,.35)" }}
    >
      <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)", fontSize: 16, fontWeight: 800 }} id="finance-entry-title">
        {isEdit ? "항목 수정" : "항목 추가"}
      </div>
      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        {!isEdit && (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => changeDirection("income")} className="chip" style={{ flex: 1, justifyContent: "center", cursor: "pointer", fontWeight: 700, ...(direction === "income" ? { borderColor: "var(--ok)", color: "var(--ok)" } : {}) }}>수입</button>
            <button type="button" onClick={() => changeDirection("expense")} className="chip" style={{ flex: 1, justifyContent: "center", cursor: "pointer", fontWeight: 700, ...(direction === "expense" ? { borderColor: "var(--danger-strong)", color: "var(--danger-strong)" } : {}) }}>지출</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input" style={{ ...inputStyle, flex: 1 }} type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
          <select className="input" style={{ ...inputStyle, flex: 1 }} value={category} onChange={(e) => setCategory(e.currentTarget.value)}>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <div className="label">금액(원)</div>
          <AmountField value={amount} onChange={setAmount} autoFocus />
        </div>
        <div>
          <div className="label">메모</div>
          <input className="input" style={{ ...inputStyle, width: "100%" }} value={memo} onChange={(e) => setMemo(e.currentTarget.value)} placeholder="선택" />
        </div>
        {error && <div style={{ fontSize: 12.5, color: "var(--danger-strong)" }}>{error}</div>}
        <div className="flex items-center justify-end gap-2" style={{ marginTop: 4 }}>
          <button className="chip" style={{ cursor: "pointer" }} onClick={onClose}>취소</button>
          <button className="btn btn-accent" style={{ height: 36, padding: "0 16px", fontSize: 13 }} disabled={pending} onClick={save}>저장</button>
        </div>
      </div>
    </Modal>
  );
}

export default function FinanceView({
  data, prevHref, nextHref, monthLabelText, canManageGeneral, canManagePayroll, width,
}: {
  data: MonthData; prevHref: string; nextHref: string; monthLabelText: string;
  canManageGeneral: boolean; canManagePayroll: boolean; width: number;
}) {
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<EntryForm | null>(null);
  const toast = useUndoToast();
  const canAddAny = canManageGeneral || canManagePayroll;
  const todayIso = `${data.year}-${String(data.month).padStart(2, "0")}-01`;

  const net = data.totalIncome - data.totalExpense;

  const incomeCats = useMemo(() => data.categorySummary.filter((c) => c.direction === "income"), [data.categorySummary]);
  const expenseCats = useMemo(() => data.categorySummary.filter((c) => c.direction === "expense"), [data.categorySummary]);

  const removeRow = (row: LedgerRow) => {
    const fd = new FormData(); fd.set("id", row.id);
    start(async () => {
      const r = await deleteEntry(fd);
      if (!r.ok) return;
      toast.notify(`${categoryLabel(row.direction, row.category)} 항목 삭제됨`, () => {
        const rfd = new FormData();
        rfd.set("id", row.id); rfd.set("date", row.date); rfd.set("direction", row.direction);
        rfd.set("category", row.category); rfd.set("amount", String(row.amount ?? 0)); rfd.set("memo", row.memo);
        if (row.createdById) rfd.set("createdBy", row.createdById);
        start(async () => { await restoreEntry(rfd); });
      });
    });
  };

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: width, margin: "0 auto", padding: "20px 20px 60px", display: "flex", flexDirection: "column", gap: 22 }}>
        {/* 월 이동 + 학원비 결제 화면 진입 */}
        <div className="flex items-center justify-center" style={{ position: "relative" }}>
          <div className="flex items-center gap-3">
            <Link href={prevHref} className="chip" aria-label="이전 달" title="이전 달">‹</Link>
            <div style={{ fontSize: 16, fontWeight: 800, minWidth: 100, textAlign: "center" }}>{monthLabelText}</div>
            <Link href={nextHref} className="chip" aria-label="다음 달" title="다음 달">›</Link>
          </div>
          <Link href="/m/finance/billing" className="chip" style={{ position: "absolute", right: 0, color: "var(--accent)", fontWeight: 700 }}>
            학원비 결제 관리 ›
          </Link>
        </div>

        {/* 월 손익 요약 */}
        <div className="flex" style={{ gap: 12 }}>
          <SummaryCard label="수입" value={won(data.totalIncome)} tone="ok" />
          <SummaryCard label="지출" value={won(data.totalExpense)} tone="danger" />
          <SummaryCard label="순이익" value={won(net)} tone={net >= 0 ? "ok" : "danger"} />
        </div>
        {data.hasHiddenAmount && (
          <div style={{ marginTop: -14, fontSize: 12, color: "var(--sub)" }}>
            일부 항목(인건비)은 권한이 없어 금액이 가려졌습니다. 위 합계에는 실제 금액이 반영돼 있습니다.
          </div>
        )}

        {/* 분류별 내역 */}
        <div className="flex" style={{ gap: 16 }}>
          <CategoryTable title="수입" rows={incomeCats} />
          <CategoryTable title="지출" rows={expenseCats} />
        </div>

        {/* 추이 */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 14, background: "var(--card)", padding: "16px 18px" }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>최근 12개월 추이</div>
            <TrendLegend />
          </div>
          <Trend points={data.trend} />
        </div>

        {/* 장부 */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 14, background: "var(--card)", overflow: "hidden" }}>
          <div className="flex items-center justify-between" style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>장부</div>
            {canAddAny && (
              <button className="btn btn-accent" style={{ height: 32, padding: "0 12px", fontSize: 12.5 }}
                onClick={() => setModal({ direction: canManageGeneral ? "income" : "expense", category: "", date: "", amount: "", memo: "" })}
              >+ 항목 추가</button>
            )}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>날짜</th><th style={th}>구분</th><th style={th}>분류</th>
                  <th style={{ ...th, textAlign: "right" }}>금액</th><th style={th}>메모</th><th style={th}>기록자</th><th style={th}></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={td}>—</td>
                  <td style={td}><span style={{ color: "var(--ok)", fontWeight: 700 }}>수입</span></td>
                  <td style={td}>학원비 <span style={{ fontSize: 11, color: "var(--sub)", border: "1px solid var(--line)", borderRadius: 999, padding: "1px 6px", marginLeft: 4 }}>자동</span></td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{won(data.tuitionIncome)}</td>
                  <td style={{ ...td, color: "var(--sub)" }}>
                    학원비 결제(billing_payment)에서 자동 집계 — 수정·삭제 불가 · <Link href="/m/finance/billing" style={{ color: "var(--accent)" }}>결제 화면에서 등록</Link>
                  </td>
                  <td style={td}>—</td><td style={td}></td>
                </tr>
                <tr>
                  <td style={td}>—</td>
                  <td style={td}><span style={{ color: "var(--ok)", fontWeight: 700 }}>수입</span></td>
                  <td style={td}>도시락 <span style={{ fontSize: 11, color: "var(--sub)", border: "1px solid var(--line)", borderRadius: 999, padding: "1px 6px", marginLeft: 4 }}>자동</span></td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{won(data.lunchIncome)}</td>
                  <td style={{ ...td, color: "var(--sub)" }}>도시락 결제(lunch_order)에서 자동 집계 — 수정·삭제 불가</td>
                  <td style={td}>—</td><td style={td}></td>
                </tr>
                {data.entries.length === 0 && (
                  <tr><td style={{ ...td, color: "var(--faint)" }} colSpan={7}>손으로 기록한 항목이 없습니다.</td></tr>
                )}
                {data.entries.map((row) => (
                  <tr key={row.id}>
                    <td style={td}>{row.date}</td>
                    <td style={td}>
                      <span style={{ color: row.direction === "income" ? "var(--ok)" : "var(--danger-strong)", fontWeight: 700 }}>
                        {row.direction === "income" ? "수입" : "지출"}
                      </span>
                    </td>
                    <td style={td}>{categoryLabel(row.direction, row.category)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>
                      {row.amount == null ? <span style={{ color: "var(--faint)" }} title="권한이 없어 가려짐">비공개</span> : won(row.amount)}
                    </td>
                    <td style={{ ...td, color: "var(--sub)" }}>{row.memo || "—"}</td>
                    <td style={{ ...td, color: "var(--sub)" }}>{row.createdByName ?? "—"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {row.editable && (
                        <div className="flex items-center gap-1">
                          <button className="chip" style={{ height: 26, padding: "0 8px", cursor: "pointer" }}
                            onClick={() => setModal({ id: row.id, direction: row.direction, category: row.category, date: row.date, amount: String(row.amount ?? ""), memo: row.memo })}
                          >수정</button>
                          <button className="chip" style={{ height: 26, padding: "0 8px", cursor: "pointer", color: "var(--danger-strong)" }} disabled={pending} onClick={() => removeRow(row)}>삭제</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {modal && (
        <EntryModal
          initial={modal} todayIso={todayIso} canPayroll={canManagePayroll}
          onClose={() => setModal(null)}
          onSaved={() => setModal(null)}
        />
      )}
      {toast.element}
    </div>
  );
}

function CategoryTable({ title, rows }: { title: string; rows: CategorySummaryRow[] }) {
  return (
    <div style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 14, background: "var(--card)", overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", fontSize: 13, fontWeight: 700 }}>{title} 분류별</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {rows.length === 0 && (
            <tr><td style={{ ...td, color: "var(--faint)" }}>내역 없음</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.category}>
              <td style={{ ...td, fontWeight: 600 }}>
                {r.label}
                {r.auto && <span style={{ fontSize: 10.5, color: "var(--sub)", border: "1px solid var(--line)", borderRadius: 999, padding: "1px 6px", marginLeft: 6 }}>자동</span>}
              </td>
              <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>
                {r.hidden ? <span style={{ color: "var(--faint)" }} title="권한이 없어 가려짐">비공개</span> : won(r.amount ?? 0)}
              </td>
              <td style={{ ...td, textAlign: "right", color: "var(--sub)", width: 56 }}>
                {r.hidden || r.share == null ? "—" : `${Math.round(r.share * 100)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
