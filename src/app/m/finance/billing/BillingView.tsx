"use client";

// 학원비 결제 화면 — 상품 관리 / 결제 등록 / 결제 내역 / 수강 현황(만료 관리) 네 탭.
// 삭제는 저장소 관례대로 하드 삭제 + 5초 실행취소 토스트(window.confirm 금지, UndoToast.tsx).
// 금액 입력은 onChange 에서 숫자만 남기고 blur 에서 정규화(저장소 관례) — AmountField 참고.
import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Modal from "../../_shared/Modal";
import { useUndoToast } from "../../_shared/UndoToast";
import { won } from "@/lib/finance";
import { computePeriod } from "@/lib/tuition";
import {
  saveProduct, setProductActive, addPayment, deletePayment, restorePayment, updateStudentMemo,
  type ProductRow, type StudentBillingOverview, type PaymentRow, type BillingMethod,
} from "./actions";

const inputStyle: CSSProperties = { height: 38, borderRadius: 8, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)", padding: "0 10px", fontSize: 13.5 };
const th: CSSProperties = { textAlign: "left", padding: "9px 12px", fontSize: 12, fontWeight: 700, color: "var(--sub)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "9px 12px", fontSize: 13.5, borderBottom: "1px solid var(--line)", verticalAlign: "top" };
const num: CSSProperties = { fontVariantNumeric: "tabular-nums" };

const METHOD_LABEL: Record<BillingMethod, string> = { card: "카드", transfer: "계좌이체", cash: "현금" };

function AmountField({ value, onChange, autoFocus, placeholder }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; placeholder?: string }) {
  return (
    <input
      className="input" style={{ ...inputStyle, textAlign: "right", width: "100%" }} inputMode="numeric" placeholder={placeholder ?? "0"} autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value.replace(/[^0-9]/g, ""))}
      onBlur={(e) => { const n = parseInt(e.currentTarget.value.replace(/[^0-9]/g, ""), 10); onChange(Number.isFinite(n) ? String(n) : ""); }}
    />
  );
}

const STATUS_LABEL: Record<StudentBillingOverview["status"], string> = {
  active: "정상", expiring_soon: "만료 임박", expired: "만료됨", never_paid: "결제 기록 없음",
};
function StatusDot({ status }: { status: StudentBillingOverview["status"] }) {
  const color = status === "active" ? "var(--ok)" : status === "expiring_soon" ? "var(--warn, #d9a441)" : status === "expired" ? "var(--danger-strong)" : "var(--faint)";
  return (
    <span className="flex items-center gap-1" style={{ fontSize: 12.5, color, fontWeight: 700 }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: color, flex: "none" }} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function Tabs({ tab, setTab }: { tab: string; setTab: (t: string) => void }) {
  const items: [string, string][] = [["register", "결제 등록"], ["history", "결제 내역"], ["products", "상품 관리"], ["expiry", "수강 현황"]];
  return (
    <div className="flex items-center gap-2" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
      {items.map(([key, label]) => (
        <button key={key} type="button" onClick={() => setTab(key)} className="chip"
          style={{ cursor: "pointer", fontWeight: 700, ...(tab === key ? { borderColor: "var(--accent)", color: "var(--accent)", background: "var(--accent-soft, rgba(79,70,229,.08))" } : {}) }}
        >{label}</button>
      ))}
    </div>
  );
}

// ================= 결제 등록 =================
function RegisterTab({ products, overview, canManage, todayIso, onRegistered }: {
  products: ProductRow[]; overview: StudentBillingOverview[]; canManage: boolean; todayIso: string; onRegistered: () => void;
}) {
  const activeProducts = useMemo(() => products.filter((p) => p.active), [products]);
  const [query, setQuery] = useState("");
  const [studentId, setStudentId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string>(activeProducts[0]?.id ?? "");
  const [paidAmount, setPaidAmount] = useState("");
  const [method, setMethod] = useState<BillingMethod>("card");
  const [paidDate, setPaidDate] = useState(todayIso);
  const [discountReason, setDiscountReason] = useState("");
  const [memo, setMemo] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const student = overview.find((s) => s.studentId === studentId) ?? null;
  const product = activeProducts.find((p) => p.id === productId) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return overview.slice(0, 8);
    return overview.filter((s) => s.studentName.includes(q)).slice(0, 8);
  }, [query, overview]);

  const preview = student && product ? computePeriod(paidDate || todayIso, product.durationDays, student.periodEnd) : null;
  const listPrice = product?.price ?? 0;
  const paid = paidAmount === "" ? listPrice : parseInt(paidAmount, 10) || 0;
  const diff = listPrice - paid;

  const pickStudent = (id: string, name: string) => { setStudentId(id); setQuery(name); };

  const submit = () => {
    setError(null); setNotice(null);
    if (!canManage) { setError("결제 관리 권한이 없습니다."); return; }
    if (!student) { setError("학생을 선택하세요."); return; }
    if (!product) { setError("상품을 선택하세요."); return; }
    if (!paidDate) { setError("결제일을 입력하세요."); return; }
    const fd = new FormData();
    fd.set("studentId", student.studentId);
    fd.set("productId", product.id);
    fd.set("paidAmount", String(paid));
    fd.set("method", method);
    fd.set("paidDate", paidDate);
    fd.set("discountReason", discountReason);
    fd.set("memo", memo);
    fd.set("externalRef", externalRef);
    start(async () => {
      const r = await addPayment(fd);
      if (!r.ok) { setError(r.error); return; }
      setNotice(`${student.studentName} · ${product.name} 결제 등록됨 (${preview?.start} ~ ${preview?.end})`);
      setPaidAmount(""); setDiscountReason(""); setMemo(""); setExternalRef("");
      onRegistered();
    });
  };

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div className="label">학생</div>
          <input className="input" style={{ ...inputStyle, width: "100%" }} value={query}
            placeholder="이름으로 검색"
            onChange={(e) => { setQuery(e.currentTarget.value); setStudentId(null); }}
          />
          {!studentId && query.trim() && (
            <div style={{ marginTop: 6, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
              {filtered.length === 0 && <div style={{ padding: "8px 10px", fontSize: 12.5, color: "var(--faint)" }}>일치하는 학생이 없습니다.</div>}
              {filtered.map((s) => (
                <button key={s.studentId} type="button" onClick={() => pickStudent(s.studentId, s.studentName)}
                  style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "var(--card)", border: "none", borderTop: "1px solid var(--line)", cursor: "pointer", fontSize: 13 }}
                  className="student-pick-row"
                >
                  <span>{s.studentName}</span>
                  <StatusDot status={s.status} />
                </button>
              ))}
            </div>
          )}
        </div>

        {student && (
          <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", background: "var(--panel2)", fontSize: 12.5 }}>
            <div className="flex items-center justify-between">
              <span style={{ fontWeight: 700 }}>{student.studentName}</span>
              <StatusDot status={student.status} />
            </div>
            <div style={{ color: "var(--sub)", marginTop: 4 }}>
              현재 만료일: {student.periodEnd ?? "결제 기록 없음"}
            </div>
            <div style={{ color: "var(--sub)", marginTop: 2 }}>
              메모: {student.studentMemo || "—"} <span style={{ color: "var(--faint)" }}>(예외 할인 확인용)</span>
            </div>
          </div>
        )}

        <div>
          <div className="label">상품</div>
          <select className="input" style={{ ...inputStyle, width: "100%" }} value={productId} onChange={(e) => setProductId(e.currentTarget.value)}>
            {activeProducts.length === 0 && <option value="">판매중인 상품이 없습니다</option>}
            {activeProducts.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {won(p.price)} · {p.durationDays}일</option>
            ))}
          </select>
        </div>

        <div className="flex" style={{ gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div className="label">정가</div>
            <div style={{ ...inputStyle, display: "flex", alignItems: "center", justifyContent: "flex-end", color: "var(--sub)", ...num }}>{won(listPrice)}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="label">실 결제 금액</div>
            <AmountField value={paidAmount} onChange={setPaidAmount} placeholder={String(listPrice)} />
          </div>
        </div>
        {diff !== 0 && (
          <div style={{ fontSize: 12.5, color: diff > 0 ? "var(--danger-strong)" : "var(--sub)" }}>
            {diff > 0 ? `정가보다 ${won(diff)} 적게 받음(할인)` : `정가보다 ${won(-diff)} 더 받음(추가결제)`}
          </div>
        )}
        {diff > 0 && (
          <div>
            <div className="label">할인 사유</div>
            <input className="input" style={{ ...inputStyle, width: "100%" }} value={discountReason} onChange={(e) => setDiscountReason(e.currentTarget.value)} placeholder="예: 형제 할인, 원장 재량" />
          </div>
        )}

        <div className="flex" style={{ gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div className="label">결제일</div>
            <input className="input" type="date" style={{ ...inputStyle, width: "100%" }} value={paidDate} onChange={(e) => setPaidDate(e.currentTarget.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="label">결제수단</div>
            <select className="input" style={{ ...inputStyle, width: "100%" }} value={method} onChange={(e) => setMethod(e.currentTarget.value as BillingMethod)}>
              <option value="card">카드</option>
              <option value="transfer">계좌이체</option>
              <option value="cash">현금</option>
            </select>
          </div>
        </div>

        <div>
          <div className="label">메모</div>
          <input className="input" style={{ ...inputStyle, width: "100%" }} value={memo} onChange={(e) => setMemo(e.currentTarget.value)} placeholder="선택" />
        </div>
        <div>
          <div className="label">외부 거래번호 (선택 — 카드사·PG 연동 전엔 승인번호 등을 수기로)</div>
          <input className="input" style={{ ...inputStyle, width: "100%" }} value={externalRef} onChange={(e) => setExternalRef(e.currentTarget.value)} placeholder="선택" />
        </div>

        {error && <div style={{ fontSize: 12.5, color: "var(--danger-strong)" }}>{error}</div>}
        {notice && <div style={{ fontSize: 12.5, color: "var(--ok)" }}>{notice}</div>}
        <button className="btn btn-accent" style={{ height: 40, fontSize: 13.5 }} disabled={pending || !canManage} onClick={submit}>결제 저장</button>
      </div>

      <div style={{ width: 280, flex: "none", border: "1px solid var(--line)", borderRadius: 12, padding: 16, background: "var(--card)", position: "sticky", top: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--sub)", marginBottom: 8 }}>수강기간 미리보기</div>
        {preview ? (
          <>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.01em" }}>{preview.start}</div>
            <div style={{ fontSize: 12.5, color: "var(--faint)", margin: "2px 0" }}>부터</div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.01em" }}>{preview.end}</div>
            <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 2 }}>까지</div>
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--sub)" }}>
              {student?.periodEnd
                ? (student.periodEnd >= paidDate ? "기존 기간에 이어 붙입니다(연장)." : "기존 기간이 지나 결제일부터 새로 시작합니다.")
                : "이 학생의 첫 결제입니다."}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--faint)" }}>학생과 상품을 선택하면 기간이 보입니다.</div>
        )}
      </div>
    </div>
  );
}

// ================= 결제 내역 =================
function HistoryTab({ payments, canManage, onChanged }: { payments: PaymentRow[]; canManage: boolean; onChanged: () => void }) {
  const [filterName, setFilterName] = useState("");
  const toast = useUndoToast();
  const [, start] = useTransition();

  const rows = useMemo(() => {
    const q = filterName.trim();
    return q ? payments.filter((p) => p.studentName.includes(q)) : payments;
  }, [filterName, payments]);

  const removeRow = (row: PaymentRow) => {
    const fd = new FormData(); fd.set("id", row.id);
    start(async () => {
      const r = await deletePayment(fd);
      if (!r.ok) return;
      toast.notify(`${row.studentName} · ${row.productName} 결제 삭제됨`, () => {
        const rfd = new FormData();
        rfd.set("id", row.id); rfd.set("studentId", row.studentId);
        if (row.productId) rfd.set("productId", row.productId);
        rfd.set("productName", row.productName); rfd.set("listPrice", String(row.listPrice));
        rfd.set("paidAmount", String(row.paidAmount)); rfd.set("method", row.method);
        rfd.set("paidDate", row.paidDate); rfd.set("periodStart", row.periodStart); rfd.set("periodEnd", row.periodEnd);
        rfd.set("discountReason", row.discountReason); rfd.set("memo", row.memo); rfd.set("externalRef", row.externalRef);
        if (row.createdById) rfd.set("createdBy", row.createdById);
        start(async () => { await restorePayment(rfd); onChanged(); });
      });
      onChanged();
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input className="input" style={{ ...inputStyle, width: 220 }} placeholder="학생 이름으로 검색" value={filterName} onChange={(e) => setFilterName(e.currentTarget.value)} />
      <div style={{ border: "1px solid var(--line)", borderRadius: 14, background: "var(--card)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>결제일</th><th style={th}>학생</th><th style={th}>상품</th>
                <th style={{ ...th, textAlign: "right" }}>정가</th><th style={{ ...th, textAlign: "right" }}>실납</th>
                <th style={{ ...th, textAlign: "right" }}>차액</th><th style={th}>수단</th><th style={th}>수강기간</th>
                <th style={th}>사유·메모</th><th style={th}>기록자</th><th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td style={{ ...td, color: "var(--faint)" }} colSpan={11}>결제 내역이 없습니다.</td></tr>}
              {rows.map((r) => {
                const diff = r.listPrice - r.paidAmount;
                return (
                  <tr key={r.id}>
                    <td style={td}>{r.paidDate}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{r.studentName}</td>
                    <td style={td}>{r.productName}</td>
                    <td style={{ ...td, textAlign: "right", ...num }}>{won(r.listPrice)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, ...num }}>{won(r.paidAmount)}</td>
                    <td style={{ ...td, textAlign: "right", color: diff > 0 ? "var(--danger-strong)" : diff < 0 ? "var(--sub)" : "var(--faint)", ...num }}>
                      {diff === 0 ? "—" : diff > 0 ? `-${won(diff)}` : `+${won(-diff)}`}
                    </td>
                    <td style={td}>{METHOD_LABEL[r.method]}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", ...num }}>{r.periodStart} ~ {r.periodEnd}</td>
                    <td style={{ ...td, color: "var(--sub)" }}>{[r.discountReason, r.memo].filter(Boolean).join(" · ") || "—"}</td>
                    <td style={{ ...td, color: "var(--sub)" }}>{r.createdByName ?? "—"}</td>
                    <td style={td}>
                      {r.editable && canManage && (
                        <button className="chip" style={{ height: 26, padding: "0 8px", cursor: "pointer", color: "var(--danger-strong)" }} onClick={() => removeRow(r)}>삭제</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {toast.element}
    </div>
  );
}

// ================= 상품 관리 =================
function ProductModal({ initial, onClose, onSaved }: { initial: { id?: string; name: string; price: string; durationDays: string; memo: string }; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial.name);
  const [price, setPrice] = useState(initial.price);
  const [durationDays, setDurationDays] = useState(initial.durationDays);
  const [memo, setMemo] = useState(initial.memo);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => {
    setError(null);
    if (!name.trim()) { setError("상품명을 입력하세요."); return; }
    const fd = new FormData();
    if (initial.id) fd.set("id", initial.id);
    fd.set("name", name.trim());
    fd.set("price", price || "0");
    fd.set("durationDays", durationDays || "30");
    fd.set("memo", memo);
    start(async () => {
      const r = await saveProduct(fd);
      if (r.ok) onSaved(); else setError(r.error);
    });
  };

  return (
    <Modal
      onClose={onClose}
      backdropBackground="rgba(20,22,30,.45)" backdropZIndex={62} panelZIndex={63}
      ariaLabelledBy="product-modal-title"
      panelStyle={{ width: 420, maxWidth: "calc(100vw - 32px)", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 18, boxShadow: "0 24px 70px rgba(20,22,30,.35)" }}
    >
      <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)", fontSize: 16, fontWeight: 800 }} id="product-modal-title">
        {initial.id ? "상품 수정" : "상품 추가"}
      </div>
      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <div className="label">상품명</div>
          <input className="input" style={{ ...inputStyle, width: "100%" }} value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="예: 관리반" autoFocus />
        </div>
        <div className="flex" style={{ gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div className="label">정가(원)</div>
            <AmountField value={price} onChange={setPrice} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="label">기간(일)</div>
            <input className="input" style={{ ...inputStyle, width: "100%", textAlign: "right" }} inputMode="numeric" value={durationDays}
              onChange={(e) => setDurationDays(e.currentTarget.value.replace(/[^0-9]/g, ""))} placeholder="30" />
          </div>
        </div>
        <div>
          <div className="label">메모</div>
          <input className="input" style={{ ...inputStyle, width: "100%" }} value={memo} onChange={(e) => setMemo(e.currentTarget.value)} placeholder="선택" />
        </div>
        {initial.id && (
          <div style={{ fontSize: 12, color: "var(--faint)" }}>가격을 바꿔도 이미 등록된 결제 금액은 그대로 유지됩니다(결제 시점 정가가 각 결제에 따로 저장됨).</div>
        )}
        {error && <div style={{ fontSize: 12.5, color: "var(--danger-strong)" }}>{error}</div>}
        <div className="flex items-center justify-end gap-2" style={{ marginTop: 4 }}>
          <button className="chip" style={{ cursor: "pointer" }} onClick={onClose}>취소</button>
          <button className="btn btn-accent" style={{ height: 36, padding: "0 16px", fontSize: 13 }} disabled={pending} onClick={save}>저장</button>
        </div>
      </div>
    </Modal>
  );
}

function ProductsTab({ products, canManage, onChanged }: { products: ProductRow[]; canManage: boolean; onChanged: () => void }) {
  const [modal, setModal] = useState<{ id?: string; name: string; price: string; durationDays: string; memo: string } | null>(null);
  const [, start] = useTransition();

  const toggle = (p: ProductRow) => {
    const fd = new FormData(); fd.set("id", p.id); fd.set("active", String(!p.active));
    start(async () => { await setProductActive(fd); onChanged(); });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {canManage && (
        <div className="flex justify-end">
          <button className="btn btn-accent" style={{ height: 34, padding: "0 12px", fontSize: 12.5 }}
            onClick={() => setModal({ name: "", price: "", durationDays: "30", memo: "" })}
          >+ 상품 추가</button>
        </div>
      )}
      <div style={{ border: "1px solid var(--line)", borderRadius: 14, background: "var(--card)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>상품명</th><th style={{ ...th, textAlign: "right" }}>정가</th>
              <th style={{ ...th, textAlign: "right" }}>기간</th><th style={th}>상태</th><th style={th}>메모</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && <tr><td style={{ ...td, color: "var(--faint)" }} colSpan={6}>등록된 상품이 없습니다.</td></tr>}
            {products.map((p) => (
              <tr key={p.id} style={{ opacity: p.active ? 1 : 0.55 }}>
                <td style={{ ...td, fontWeight: 700 }}>{p.name}</td>
                <td style={{ ...td, textAlign: "right", ...num }}>{won(p.price)}</td>
                <td style={{ ...td, textAlign: "right", ...num }}>{p.durationDays}일</td>
                <td style={td}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: p.active ? "var(--ok)" : "var(--faint)" }}>{p.active ? "판매중" : "판매중지"}</span>
                </td>
                <td style={{ ...td, color: "var(--sub)" }}>{p.memo || "—"}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {canManage && (
                    <div className="flex items-center gap-1">
                      <button className="chip" style={{ height: 26, padding: "0 8px", cursor: "pointer" }}
                        onClick={() => setModal({ id: p.id, name: p.name, price: String(p.price), durationDays: String(p.durationDays), memo: p.memo })}
                      >수정</button>
                      <button className="chip" style={{ height: 26, padding: "0 8px", cursor: "pointer" }} onClick={() => toggle(p)}>
                        {p.active ? "판매중지" : "판매재개"}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && <ProductModal initial={modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); onChanged(); }} />}
    </div>
  );
}

// ================= 수강 현황(만료 관리) =================
function ExpiryTab({ overview, canManage, todayIso, onChanged }: { overview: StudentBillingOverview[]; canManage: boolean; todayIso: string; onChanged: () => void }) {
  const [memoDrafts, setMemoDrafts] = useState<Record<string, string>>({});
  const [, start] = useTransition();
  const sorted = useMemo(
    () => [...overview].sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity)),
    [overview],
  );

  const saveMemo = (studentId: string, memo: string) => {
    const fd = new FormData(); fd.set("studentId", studentId); fd.set("memo", memo);
    start(async () => { await updateStudentMemo(fd); onChanged(); });
  };

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, background: "var(--card)", overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>학생</th><th style={th}>상태</th><th style={th}>만료일</th>
            <th style={{ ...th, textAlign: "right" }}>남은 일수</th><th style={th}>메모(예외 할인 확인용)</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <tr key={s.studentId}>
              <td style={{ ...td, fontWeight: 700 }}>{s.studentName}</td>
              <td style={td}><StatusDot status={s.status} /></td>
              <td style={{ ...td, ...num }}>{s.periodEnd ?? "—"}</td>
              <td style={{ ...td, textAlign: "right", ...num, color: s.daysLeft != null && s.daysLeft < 0 ? "var(--danger-strong)" : "var(--ink)" }}>
                {s.daysLeft == null ? "—" : s.daysLeft >= 0 ? `${s.daysLeft}일` : `${-s.daysLeft}일 지남`}
              </td>
              <td style={td}>
                {canManage ? (
                  <input
                    className="input" style={{ ...inputStyle, width: "100%" }}
                    value={memoDrafts[s.studentId] ?? s.studentMemo}
                    placeholder="선택"
                    onChange={(e) => setMemoDrafts((d) => ({ ...d, [s.studentId]: e.currentTarget.value }))}
                    onBlur={(e) => { if (e.currentTarget.value !== s.studentMemo) saveMemo(s.studentId, e.currentTarget.value); }}
                  />
                ) : (s.studentMemo || "—")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ================= 화면 셸 =================
export default function BillingView({ products, overview, payments, canManage, todayIso, width }: {
  products: ProductRow[]; overview: StudentBillingOverview[]; payments: PaymentRow[];
  canManage: boolean; todayIso: string; width: number;
}) {
  const [tab, setTab] = useState<"register" | "history" | "products" | "expiry">("register");
  const router = useRouter();
  // 서버 액션(actions.ts)이 revalidatePath 로 캐시를 무효화해도, 이미 클라에 내려와 있는 props 는
  // 저절로 안 바뀐다 — 등록·삭제 뒤 router.refresh() 로 이 서버 컴포넌트(page.tsx)를 다시 요청해
  // products/overview/payments 를 새로 받는다(탭 상태 등 클라 state 는 유지된 채로, 풀 리로드 아님).
  const onChanged = () => router.refresh();
  const expiringSoonCount = overview.filter((s) => s.status === "expiring_soon" || s.status === "expired").length;

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: width, margin: "0 auto", padding: "20px 20px 60px", display: "flex", flexDirection: "column", gap: 16 }}>
        <Tabs tab={tab} setTab={(t) => setTab(t as typeof tab)} />
        {tab === "expiry" && expiringSoonCount > 0 && (
          <div style={{ fontSize: 12.5, color: "var(--sub)" }}>만료 임박·만료된 학생 {expiringSoonCount}명</div>
        )}
        {tab === "register" && <RegisterTab products={products} overview={overview} canManage={canManage} todayIso={todayIso} onRegistered={onChanged} />}
        {tab === "history" && <HistoryTab payments={payments} canManage={canManage} onChanged={onChanged} />}
        {tab === "products" && <ProductsTab products={products} canManage={canManage} onChanged={onChanged} />}
        {tab === "expiry" && <ExpiryTab overview={overview} canManage={canManage} todayIso={todayIso} onChanged={onChanged} />}
      </div>
    </div>
  );
}
