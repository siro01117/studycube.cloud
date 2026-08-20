"use client";

// 스케줄 JSON 업로드 → 미리보기 → 부분 적용. src/lib/schedule-import.ts 의 스펙/검증/비교 함수만 쓰고
// DB 접근은 ./actions.ts(loadImportBase/applyImportSelection) 를 통해서만 한다.
import { useMemo, useRef, useState } from "react";
import {
  parseScheduleImportText, academyToDbFields,
  type StudentResult, type ImportHours, type DbAcademy,
} from "@/lib/schedule-import";
import { applyImportSelection, type ImportBase, type ApplyResult } from "./actions";
import { diffAgainstExisting, type DiffStatus } from "@/lib/schedule-import";

// ---------------- 아이콘(라인 스트로크, 이모지 금지) ----------------
function IconUpload() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 10.5V2" /><path d="M4.8 5.2L8 2l3.2 3.2" /><path d="M2.5 10.5v2a1.5 1.5 0 001.5 1.5h8a1.5 1.5 0 001.5-1.5v-2" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5l3.2 3.2L13 4.5" />
    </svg>
  );
}
function IconWarn() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5l7 12.2H1L8 1.5z" /><path d="M8 6.3v3.4" /><circle cx="8" cy="11.6" r="0.15" fill="currentColor" />
    </svg>
  );
}
function IconAlertCircle() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.3" /><path d="M8 5.2v3.4" /><circle cx="8" cy="10.9" r="0.15" fill="currentColor" />
    </svg>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "7px 10px", fontSize: 11.5, fontWeight: 700, color: "var(--faint)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 10px", fontSize: 13, borderBottom: "1px solid var(--line)", verticalAlign: "middle" };

type MatchStatus = "matched" | "unmatched" | "duplicate";

type Row = {
  index: number;
  parseOk: boolean;
  parseError?: string;
  name: string;
  seat: number | null;
  hours: ImportHours[];
  restDays: number[];
  academies: DbAcademy[];
  warnings: string[];
  matchStatus: MatchStatus;
  studentId: string | null;
  duplicateNames?: string[];
  diffStatus: DiffStatus | "n/a";
  diffDetail: string;
};

const DAY_LABEL = ["", "월", "화", "수", "목", "금", "토", "일"];

function summaryOf(hours: ImportHours[], academies: DbAcademy[], restDays: number[]): string {
  const parts: string[] = [];
  if (hours.length) parts.push(`등하원 ${hours.length}일`);
  if (academies.length) parts.push(`학원 ${academies.length}건`);
  if (restDays.length) parts.push(`휴무 ${restDays.map((d) => DAY_LABEL[d]).join("")}`);
  if (parts.length === 0) parts.push("반영할 내용 없음");
  return parts.join(" · ");
}

function buildRows(results: StudentResult[], base: ImportBase): Row[] {
  const byName = new Map<string, { id: string; name: string }[]>();
  for (const s of base.students) {
    const list = byName.get(s.name) ?? [];
    list.push(s);
    byName.set(s.name, list);
  }
  const hoursByStudent = new Map<string, ImportHours[]>();
  for (const h of base.hours) {
    const list = hoursByStudent.get(h.studentId) ?? [];
    list.push({ day: h.day, arrive: h.arrive, leave: h.leave });
    hoursByStudent.set(h.studentId, list);
  }
  const acadByStudent = new Map<string, DbAcademy[]>();
  for (const a of base.academies) {
    const list = acadByStudent.get(a.studentId) ?? [];
    list.push({ reason: a.reason, title: a.title, days: a.days, start: a.start, end: a.end });
    acadByStudent.set(a.studentId, list);
  }

  return results.map((r): Row => {
    if (!r.ok) {
      return {
        index: r.index, parseOk: false, parseError: r.error, name: r.name ?? "(이름 없음)", seat: null,
        hours: [], restDays: [], academies: [], warnings: [],
        matchStatus: "unmatched", studentId: null, diffStatus: "n/a", diffDetail: "",
      };
    }
    const st = r.student;
    const dbAcademies = st.academies.map(academyToDbFields);
    const candidates = byName.get(st.name) ?? [];
    let matchStatus: MatchStatus = "unmatched";
    let studentId: string | null = null;
    let diffStatus: DiffStatus | "n/a" = "n/a";
    let diffDetail = "";
    if (candidates.length === 1) {
      matchStatus = "matched";
      studentId = candidates[0].id;
      const existingHours = hoursByStudent.get(studentId) ?? [];
      const existingAcad = acadByStudent.get(studentId) ?? [];
      const diff = diffAgainstExisting(st.hours, dbAcademies, existingHours, existingAcad);
      diffStatus = diff.status;
      diffDetail = diff.detail;
    } else if (candidates.length > 1) {
      matchStatus = "duplicate";
    }
    return {
      index: r.index, parseOk: true, name: st.name, seat: st.seat,
      hours: st.hours, restDays: st.restDays, academies: dbAcademies, warnings: st.warnings,
      matchStatus, studentId,
      duplicateNames: candidates.length > 1 ? candidates.map((c) => c.id) : undefined,
      diffStatus, diffDetail,
    };
  });
}

const matchChip: Record<MatchStatus, { label: string; fg: string; bg: string }> = {
  matched: { label: "매칭됨", fg: "var(--sub)", bg: "var(--panel2)" },
  unmatched: { label: "이름 없음", fg: "var(--danger)", bg: "var(--panel2)" },
  duplicate: { label: "동명이인", fg: "var(--danger)", bg: "var(--panel2)" },
};
const diffChip: Record<DiffStatus | "n/a", { label: string; fg: string; bg: string }> = {
  same: { label: "변경 없음", fg: "var(--faint)", bg: "var(--panel2)" },
  new: { label: "새로 등록", fg: "var(--accent)", bg: "var(--accent-soft)" },
  changed: { label: "수정", fg: "var(--accent)", bg: "var(--accent-soft)" },
  "n/a": { label: "-", fg: "var(--faint)", bg: "transparent" },
};

function Chip({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, color: fg, background: bg }}>
      {label}
    </span>
  );
}

export default function ImportView({ base }: { base: ImportBase }) {
  const [rawText, setRawText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doParse = (text: string) => {
    setApplyResult(null);
    const result = parseScheduleImportText(text);
    if (!result.ok) {
      setParseError(result.error);
      setRows(null);
      return;
    }
    setParseError(null);
    const built = buildRows(result.file.results, base);
    setRows(built);
    // 기본 선택: 매칭되고 변경이 있는 학생만.
    const def = new Set<number>();
    for (const row of built) {
      if (row.parseOk && row.matchStatus === "matched" && (row.diffStatus === "new" || row.diffStatus === "changed")) {
        def.add(row.index);
      }
    }
    setSelected(def);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setRawText(text);
      doParse(text);
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  };

  const selectableRows = useMemo(() => (rows ?? []).filter((r) => r.parseOk && r.matchStatus === "matched"), [rows]);

  const toggleAll = (on: boolean) => {
    setSelected(on ? new Set(selectableRows.map((r) => r.index)) : new Set());
  };
  const toggleOne = (index: number, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(index); else next.delete(index);
      return next;
    });
  };

  const doApply = async () => {
    if (!rows) return;
    const items = rows
      .filter((r) => r.parseOk && r.matchStatus === "matched" && r.studentId && selected.has(r.index))
      .map((r) => ({ studentId: r.studentId as string, name: r.name, hours: r.hours, academies: r.academies }));
    if (items.length === 0) return;
    setApplying(true);
    setApplyResult(null);
    try {
      const result = await applyImportSelection(JSON.stringify(items));
      setApplyResult(result);
    } catch (e) {
      setApplyResult({ applied: 0, skipped: 0, failed: [{ name: "-", error: e instanceof Error ? e.message : "적용에 실패했습니다" }] });
    } finally {
      setApplying(false);
    }
  };

  const errorRows = (rows ?? []).filter((r) => !r.parseOk);
  const okRows = (rows ?? []).filter((r) => r.parseOk);
  const allSelectableChecked = selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.index));

  return (
    <>
      <div className="card" style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", flexWrap: "wrap" }}>
        <span style={{ fontSize: 20, fontWeight: 700 }}>스케줄 JSON 업로드</span>
        <span style={{ fontSize: 12, color: "var(--faint)" }}>정제된 JSON 을 올리면 학생별로 무엇이 바뀌는지 미리 보고, 선택한 학생만 반영합니다</span>
      </div>

      <div className="card" style={{ flex: "none", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-accent" style={{ height: 36, padding: "0 14px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}
            onClick={() => fileRef.current?.click()}>
            <IconUpload />파일 선택(.json)
          </button>
          <input ref={fileRef} type="file" accept="application/json" onChange={onFileChange} style={{ display: "none" }} />
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>또는 아래에 JSON 을 붙여넣고 파싱하세요</span>
        </div>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder='{"version":1,"students":[...]}'
          style={{
            width: "100%", minHeight: 120, resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 12.5,
            padding: 10, borderRadius: 8, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)",
          }}
        />
        <div>
          <button type="button" className="btn" style={{ height: 34, padding: "0 14px", fontSize: 12.5 }}
            disabled={!rawText.trim()} onClick={() => doParse(rawText)}>
            파싱 · 미리보기
          </button>
        </div>
        {parseError && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--danger)", fontSize: 12.5 }}>
            <IconAlertCircle />{parseError}
          </div>
        )}
      </div>

      {rows && (
        <div className="card" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 12.5, color: "var(--faint)" }}>
              전체 {rows.length}명 · 매칭 {okRows.filter((r) => r.matchStatus === "matched").length}명 · 이름 없음 {okRows.filter((r) => r.matchStatus === "unmatched").length}명 ·
              동명이인 {okRows.filter((r) => r.matchStatus === "duplicate").length}명 · 형식 오류 {errorRows.length}명 · 선택됨 {selected.size}명
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn" style={{ height: 30, padding: "0 10px", fontSize: 11.5 }} onClick={() => toggleAll(!allSelectableChecked)}>
                {allSelectableChecked ? "전체 해제" : "전체 선택"}
              </button>
              <button type="button" className="btn btn-accent" style={{ height: 30, padding: "0 12px", fontSize: 11.5 }}
                disabled={selected.size === 0 || applying} onClick={doApply}>
                {applying ? "적용 중…" : `선택 ${selected.size}명 적용`}
              </button>
            </div>
          </div>

          {applyResult && (
            <div style={{ padding: "10px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--panel2)", fontSize: 12.5 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                적용 결과 — 반영 {applyResult.applied}명 / 건너뜀 {applyResult.skipped}명 / 실패 {applyResult.failed.length}명
              </div>
              {applyResult.failed.length > 0 && (
                <div style={{ color: "var(--danger)" }}>
                  {applyResult.failed.map((f, i) => (
                    <div key={i}>{f.name}: {f.error}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}></th>
                  <th style={th}>이름</th>
                  <th style={th}>좌석</th>
                  <th style={th}>매칭 상태</th>
                  <th style={th}>내용</th>
                  <th style={th}>변경</th>
                  <th style={th}>경고</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const selectable = row.parseOk && row.matchStatus === "matched";
                  return (
                    <tr key={row.index} style={{ opacity: row.parseOk ? 1 : 0.6 }}>
                      <td style={td}>
                        <input type="checkbox" disabled={!selectable} checked={selected.has(row.index)}
                          onChange={(e) => toggleOne(row.index, e.target.checked)} />
                      </td>
                      <td style={{ ...td, fontWeight: 700 }}>{row.name}</td>
                      <td style={td}>{row.seat ?? "-"}</td>
                      <td style={td}>
                        {!row.parseOk ? (
                          <span title={row.parseError} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--danger)" }}>
                            <IconAlertCircle />형식 오류
                          </span>
                        ) : row.matchStatus === "duplicate" ? (
                          <span title={`동명이인 학생 id: ${row.duplicateNames?.join(", ")}`}>
                            <Chip {...matchChip.duplicate} label={`동명이인 ${row.duplicateNames?.length ?? 0}명`} />
                          </span>
                        ) : (
                          <Chip {...matchChip[row.matchStatus]} />
                        )}
                      </td>
                      <td style={td}>{row.parseOk ? summaryOf(row.hours, row.academies, row.restDays) : "-"}</td>
                      <td style={td}>{row.parseOk && row.matchStatus === "matched" ? <Chip {...diffChip[row.diffStatus]} /> : <Chip {...diffChip["n/a"]} />}</td>
                      <td style={td}>
                        {!row.parseOk ? (
                          <span style={{ color: "var(--danger)" }}>{row.parseError}</span>
                        ) : row.warnings.length > 0 ? (
                          <span title={row.warnings.join("\n")} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--danger)" }}>
                            <IconWarn />{row.warnings.length}건
                          </span>
                        ) : (
                          <span style={{ display: "inline-flex", alignItems: "center", color: "var(--faint)" }}><IconCheck /></span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
