"use client";

// 폰용 좌석 배치도 — 한 방씩 보며 누가 어디 앉았는지 확인하고 입·퇴실을 찍는다.
// 데스크톱 FloorEditor(편집·툴바·층레일)와 별개 화면. 편집 기능은 PC/패드에서.
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import SeatCanvas from "../_shared/SeatCanvas";
import MobileNav from "../_shared/MobileNav";
import { SW, xyOf } from "@/lib/seatmap";
import { checkIn, checkOut } from "../m/seat/attendanceActions";
import { tint, line, ink, solid } from "@/lib/semantic-color";
import { needsAttentionCheck, type OccKind, type SeatOcc } from "@/lib/occupancy";
import {
  checkoutBranchAt, type DaySlot, type Period, type ActualAttendance, type CheckoutBranch,
} from "@/lib/schedule";
import { CHECKOUT_REASON_PRESETS, CHECKOUT_OTHER_REASON, CHECKOUT_REASON_KEY } from "@/lib/attendance";
import type { CSSProperties } from "react";

export type SRoom = { id: string; name: string; floor: number };
export type SSeat = { id: string; room_id: string | null; grid_x: number | null; grid_y: number | null; number: number | null; label: string; current_student_id: string | null };
export type SStudent = { id: string; name: string; grade: string | null; school: string | null; student_phone: string | null; guardian_phone: string | null };
// 오늘 재실/부재 최종 판정 = 순찰·출결 중 더 최근 기록(src/lib/occupancy.ts, page.tsx 가 서버에서 계산).
export type Att = OccKind;
// 오늘 요일 기준 학생별 스케쥴 파생 정보(page.tsx 가 branch 전체를 3개 쿼리로 읽어 memory join —
// m/seat/FloorEditor.tsx 의 ScheduleInfo/patrol/MobilePatrol.tsx 의 MScheduleInfo 와 동형).
export type SScheduleInfo = { hours: { arrive_min: number; leave_min: number } | null; slots: DaySlot[] };

// KST 기준 분(minute-of-day) 계산 — FloorEditor.tsx/MobilePatrol.tsx 와 동일(new Date() 는 반드시 이 함수로만).
function kstNowMin(): number {
  const d = new Date();
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + 540) % 1440;
}
// nowMin(분) → "HH:MM" — 순수 포맷팅, Date 미사용.
function fmtHM(min: number): string {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// 재실(in) = 순찰 '입석'/스케쥴 '자습'과 같은 의미 → SEMANTIC.present 재사용(FloorEditor.tsx 의
// ATT_COLOR 와 동일 계산). 하원(out)은 무채색(none).
const ATT = {
  in: { bg: tint("present", 15), bd: line("present", 55), fg: ink("present"), label: "재실" },
  out: { bg: tint("none", 12), bd: line("none", 40), fg: "var(--faint)", label: "하원" },
} as const;

// 퇴실 확인 바텀시트 사유 버튼 색 — 라벨→SemanticKey 매핑은 attendance.ts CHECKOUT_REASON_KEY(단일
// 정의, 데스크탑 FloorEditor.tsx 와 공유), 색 계산은 semantic-color.ts 함수 그대로(새 헥스 추가 안 함).
// filled=true 는 확정 선택 상태(예: '기타' 입력칸이 열린 상태)로 채워진 배경.
function checkoutReasonStyle(label: string, filled: boolean): CSSProperties {
  const key = CHECKOUT_REASON_KEY[label as keyof typeof CHECKOUT_REASON_KEY] ?? "none";
  return filled
    ? { backgroundColor: solid(key), borderColor: solid(key), color: "#fff" }
    : { backgroundColor: tint(key, 16), borderColor: line(key, 55), color: ink(key) };
}

export default function MobileSeat({ rooms, seats, students, occupancy, canAttend, scheduleMap, periods, actual, nowMin }: {
  rooms: SRoom[]; seats: SSeat[]; students: SStudent[];
  occupancy: Record<string, SeatOcc>; canAttend: boolean;
  scheduleMap: Record<string, SScheduleInfo>;
  periods: Period[];
  actual: Record<string, ActualAttendance>;
  nowMin: number; // 서버가 계산해 내려준 지금 KST 분(자정부터 경과) — "확인 필요" 판정 전용(클라 new Date() 금지 원칙)
}) {
  const [roomIdx, setRoomIdx] = useState(0);
  const [sel, setSel] = useState<SSeat | null>(null);
  // 퇴실 확인 바텀시트 — checkoutBranchAt() 분류 결과 + 사유 입력 진행 상태(데스크탑 FloorEditor.tsx 와
  // 같은 분류 로직 공유, UI 만 바텀시트).
  const [checkoutConfirm, setCheckoutConfirm] = useState<{
    studentId: string; branch: CheckoutBranch; expanded: boolean; otherOpen: boolean; otherText: string;
  } | null>(null);
  const [, start] = useTransition();

  const stOf = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const byRoom = useMemo(() => {
    const m = new Map<string, SSeat[]>();
    for (const s of seats) { if (!s.room_id) continue; (m.get(s.room_id) ?? m.set(s.room_id, []).get(s.room_id)!).push(s); }
    return m;
  }, [seats]);

  const room = rooms[roomIdx] ?? null;
  // 참조가 매 렌더 바뀌면 SeatCanvas 의 초기배율 계산이 매번 다시 돌아 팬·줌이 튄다 → 메모 고정.
  const roomSeats = useMemo(() => (room ? byRoom.get(room.id) ?? [] : []), [room, byRoom]);
  const seatById = useMemo(() => new Map(roomSeats.map((s) => [s.id, s])), [roomSeats]);
  const canvasSeats = useMemo(() => roomSeats.map((s, i) => ({ id: s.id, ...xyOf(s, i) })), [roomSeats]);

  const inCount = roomSeats.filter((s) => s.current_student_id && occupancy[s.current_student_id]?.kind === "in").length;
  const assigned = roomSeats.filter((s) => s.current_student_id).length;

  // 확인 필요 — 스케쥴상 지금 원 안에 있어야 하는데(자습/원내 사유, 쉬는시간 제외) 오늘 출결·순찰 기록이
  // 전혀 없는 학생. checkoutBranchAt() 이 이미 스케쥴·자정 넘김 판정을 끝낸 CheckoutBranch 를
  // needsAttentionCheck() 에 그대로 넘긴다(새 판정 로직 없음). scheduleMap/periods/actual/occupancy 모두
  // page.tsx 가 이미 내려준 값 재사용 — 추가 쿼리 없음. nowMin 은 서버가 계산해 내려준 값(클라 new Date() 금지).
  const attentionIds = useMemo(() => {
    const set = new Set<string>();
    for (const [sid, info] of Object.entries(scheduleMap)) {
      const branch = checkoutBranchAt(nowMin, info.hours, info.slots, periods, actual[sid] ?? null);
      if (needsAttentionCheck(branch, occupancy[sid])) set.add(sid);
    }
    return set;
  }, [scheduleMap, nowMin, periods, actual, occupancy]);
  const attentionCount = roomSeats.filter((s) => s.current_student_id && attentionIds.has(s.current_student_id)).length;

  // 수동 입/퇴실 버튼 — 로컬에 낙관적 상태를 두지 않고 서버 액션의 revalidatePath("/m/seat") 로 이
  // 페이지가 다시 렌더될 때 새로 내려오는 occupancy 를 그대로 반영한다(FloorEditor.tsx 와 동일 방식).
  // 예전엔 로컬 낙관적 state 가 순찰 기록 우선순위 버그와 겹쳐 수동 버튼을 눌러도 화면이 안 바뀌었다.
  const mark = (studentId: string, kind: Att) => {
    const fd = new FormData(); fd.set("studentId", studentId);
    start(async () => { await (kind === "in" ? checkIn(fd) : checkOut(fd)); });
    setSel(null);
  };

  // 퇴실 확인 시트 열기 — 클릭 시점의 신선한 kstNowMin() 으로 지금 이 순간의 분류를 계산한다.
  const openCheckout = (sid: string) => {
    const now = kstNowMin();
    const info = scheduleMap[sid];
    const branch = checkoutBranchAt(now, info?.hours ?? null, info?.slots ?? [], periods, actual[sid] ?? null);
    setCheckoutConfirm({ studentId: sid, branch, expanded: false, otherOpen: false, otherText: "" });
  };
  const confirmCheckout = (note: string | null) => {
    if (!checkoutConfirm) return;
    const fd = new FormData();
    fd.set("studentId", checkoutConfirm.studentId);
    fd.set("note", note ?? "");
    start(async () => { await checkOut(fd); });
    setCheckoutConfirm(null);
    setSel(null);
  };

  const selStudent = sel?.current_student_id ? stOf.get(sel.current_student_id) : null;
  const selAtt = sel?.current_student_id ? occupancy[sel.current_student_id]?.kind : undefined;

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* 상단: 현재 방 (전환은 하단 ‹ ›) */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--card)", borderBottom: "1px solid var(--line)" }}>
        <MobileNav current="/seat" />
        <div style={{ flex: 1, minWidth: 0, textAlign: "center", lineHeight: 1.25 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{room ? `${room.floor}층 ${room.name}` : "방 없음"}</div>
          <div style={{ fontSize: 11, color: "var(--faint)", fontVariantNumeric: "tabular-nums" }}>
            방 {roomIdx + 1}/{rooms.length} · 재실 {inCount}/{assigned}
            {attentionCount > 0 && <span style={{ color: "var(--warn)", fontWeight: 700 }}> · 확인 필요 {attentionCount}명</span>}
          </div>
        </div>
        <Link href="/patrol" className="chip" style={{ textDecoration: "none", height: 36, flex: "none", color: "var(--accent)", fontWeight: 700 }}>순찰</Link>
      </div>

      <SeatCanvas
        seats={canvasSeats}
        onTap={(id) => { const s = seatById.get(id); if (s?.current_student_id) setSel(s); }}
        renderSeat={(id) => {
          const s = seatById.get(id)!;
          const sid = s.current_student_id;
          // 재실/부재 판정: page.tsx 가 순찰·출결 중 더 최근 기록으로 이미 계산해 내려준 값을 그대로 쓴다.
          const o = sid ? occupancy[sid] : undefined;
          const a = o?.kind;
          const c = a ? ATT[a] : null;
          // 확인 필요 — occ 가 없을 때만(c 도 자동으로 null) 해당될 수 있다(needsAttentionCheck 규칙 그대로).
          const needsCheck = !!sid && attentionIds.has(sid);
          return (
            <div title={o?.title || (needsCheck ? "확인 필요 — 지금 자리에 있어야 하는데 오늘 출결·순찰 기록이 없습니다" : undefined)} style={{
              width: "100%", height: "100%", borderRadius: 10,
              background: c ? c.bg : sid ? "var(--card)" : "var(--panel2)",
              border: `1.5px solid ${c ? c.bd : "var(--line)"}`,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              position: "relative", opacity: sid ? 1 : 0.55,
            }}>
              <span style={{ position: "absolute", top: 2, left: 0, right: 0, textAlign: "center", fontSize: 10, fontWeight: 700, color: "var(--faint)" }}>{s.number ?? s.label}</span>
              {sid ? (
                <div style={{ marginTop: 11, display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, maxWidth: SW - 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stOf.get(sid)?.name ?? "?"}</span>
                  {c ? (
                    <span style={{ fontSize: 11, fontWeight: 800, color: c.fg, lineHeight: 1.1 }}>{c.label}</span>
                  ) : needsCheck ? (
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--warn)", lineHeight: 1.1 }}>확인 필요</span>
                  ) : null}
                  {/* 하원 사유 — 수동 퇴실 사유(attendance_event.note) 또는 없으면 스케쥴 추정(옅게).
                      o.reason 은 occupancy.ts buildOccupancy() 가 이미 우선순위를 적용해 내려준다. */}
                  {a === "out" && o?.reason && (
                    <span
                      style={{
                        fontSize: 10, fontWeight: 700, color: "var(--dim)", lineHeight: 1.1,
                        opacity: o.reasonEstimated ? 0.7 : 1,
                        maxWidth: SW - 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {o.reason}
                    </span>
                  )}
                </div>
              ) : <span style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 10 }}>공석</span>}
            </div>
          );
        }}
      />

      {/* 하단: 방 이동 */}
      <div style={{ flex: "none", display: "flex", gap: 8, padding: "10px 12px calc(10px + env(safe-area-inset-bottom))", background: "var(--card)", borderTop: "1px solid var(--line)" }}>
        <button className="btn" disabled={roomIdx === 0} onClick={() => setRoomIdx((i) => Math.max(0, i - 1))} style={{ height: 54, flex: "0 0 64px", fontSize: 20 }} aria-label="이전 방">‹</button>
        <div className="btn" style={{ height: 54, flex: 1, cursor: "default", fontSize: 14, fontWeight: 700, color: "var(--sub)" }}>
          {room ? `${room.floor}층 ${room.name}` : "-"}
        </div>
        <button className="btn" disabled={roomIdx >= rooms.length - 1} onClick={() => setRoomIdx((i) => Math.min(rooms.length - 1, i + 1))} style={{ height: 54, flex: "0 0 64px", fontSize: 20 }} aria-label="다음 방">›</button>
      </div>

      {/* 좌석 시트 — 학생 정보 + 입·퇴실 */}
      {sel && selStudent && (
        <>
          <div onClick={() => setSel(null)} style={{ position: "fixed", inset: 0, background: "rgba(10,12,18,.45)", zIndex: 40 }} />
          <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 41, background: "var(--card)", borderRadius: "18px 18px 0 0", padding: "18px 16px calc(16px + env(safe-area-inset-bottom))" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 19, fontWeight: 800 }}>{selStudent.name}</span>
              <span style={{ fontSize: 13, color: "var(--faint)" }}>{sel.number ?? sel.label}번</span>
              {selAtt && <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 800, color: ATT[selAtt].fg }}>{ATT[selAtt].label}</span>}
            </div>
            <div style={{ fontSize: 13, color: "var(--dim)", marginBottom: 14 }}>
              {[selStudent.grade, selStudent.school].filter(Boolean).join(" · ") || "학년·학교 미등록"}
            </div>
            {(selStudent.student_phone || selStudent.guardian_phone) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                {selStudent.student_phone && (
                  <a href={`tel:${selStudent.student_phone}`} className="btn" style={{ height: 48, justifyContent: "space-between", textDecoration: "none" }}>
                    <span style={{ color: "var(--faint)", fontSize: 12.5 }}>학생</span><span style={{ fontWeight: 700 }}>{selStudent.student_phone}</span>
                  </a>
                )}
                {selStudent.guardian_phone && (
                  <a href={`tel:${selStudent.guardian_phone}`} className="btn" style={{ height: 48, justifyContent: "space-between", textDecoration: "none" }}>
                    <span style={{ color: "var(--faint)", fontSize: 12.5 }}>보호자</span><span style={{ fontWeight: 700 }}>{selStudent.guardian_phone}</span>
                  </a>
                )}
              </div>
            )}
            {canAttend && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={() => mark(sel.current_student_id!, "in")} style={{ height: 54, flex: 1, fontSize: 15, fontWeight: 800, color: ink("present"), borderColor: line("present", 50), background: tint("present", 10) }}>입실</button>
                <button className="btn" onClick={() => openCheckout(sel.current_student_id!)} style={{ height: 54, flex: 1, fontSize: 15, fontWeight: 800 }}>하원</button>
              </div>
            )}
            <button className="btn" onClick={() => setSel(null)} style={{ height: 46, width: "100%", marginTop: 8 }}>닫기</button>
          </div>
        </>
      )}

      {/* 퇴실 확인 바텀시트 — checkoutBranchAt() 분류(원 안/밖/스케쥴 없음)에 따라 문구·사유 기본값이
          갈린다(데스크탑 FloorEditor.tsx 와 같은 분류 로직 공유). 학생 시트 위에 겹쳐 뜬다. */}
      {checkoutConfirm && (() => {
        const cc = checkoutConfirm;
        const branch = cc.branch;
        const name = stOf.get(cc.studentId)?.name ?? "학생";
        const occ = occupancy[cc.studentId];
        // 문장마다 줄바꿈 — 한 번에 읽기 쉽게(가독성 요건).
        let bodyLines: string[] = [];
        if (branch.kind === "inside") {
          bodyLines = [`지금은 ${branch.label} 시간입니다.`, "자리에 있어야 하는 시간인데 퇴실 처리할까요?"];
        } else if (branch.kind === "outside") {
          bodyLines = branch.slot
            ? [`지금은 ${branch.label} 일정입니다 (${fmtHM(branch.slot.start)}–${fmtHM(branch.slot.end)}).`, "퇴실 처리할까요?"]
            : [`지금은 ${branch.label} 상태입니다.`, "퇴실 처리할까요?"];
        } else {
          bodyLines = ["이 학생은 시간표가 없습니다.", "퇴실 처리할까요?"];
        }
        const presetPicker = (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {CHECKOUT_REASON_PRESETS.map((p) => (
                <button
                  key={p}
                  className="btn"
                  onClick={() => (p === CHECKOUT_OTHER_REASON ? setCheckoutConfirm({ ...cc, otherOpen: true }) : confirmCheckout(p))}
                  style={{ height: 40, padding: "0 14px", fontSize: 13, fontWeight: 700, ...checkoutReasonStyle(p, p === CHECKOUT_OTHER_REASON && cc.otherOpen) }}
                >
                  {p}
                </button>
              ))}
            </div>
            {cc.otherOpen && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <input
                  className="input"
                  autoFocus
                  placeholder="사유 입력"
                  value={cc.otherText}
                  onChange={(e) => setCheckoutConfirm({ ...cc, otherText: e.target.value })}
                  style={{ height: 44, flex: 1 }}
                />
                <button
                  className="btn btn-accent"
                  disabled={!cc.otherText.trim()}
                  onClick={() => confirmCheckout(cc.otherText.trim())}
                  style={{ height: 44, padding: "0 16px" }}
                >확인</button>
              </div>
            )}
          </>
        );
        return (
          <>
            <div onClick={() => setCheckoutConfirm(null)} style={{ position: "fixed", inset: 0, background: "rgba(10,12,18,.45)", zIndex: 42 }} />
            <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 43, background: "var(--card)", borderRadius: "18px 18px 0 0", padding: "18px 16px calc(16px + env(safe-area-inset-bottom))" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{name}</span>
                {cc.studentId === sel?.current_student_id && sel && <span style={{ fontSize: 12.5, color: "var(--dim)" }}>{sel.number ?? sel.label}번</span>}
                {occ && (
                  <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 999, backgroundColor: ATT[occ.kind].bg, color: ATT[occ.kind].fg }}>
                    {ATT[occ.kind].label}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, lineHeight: 1.65 }}>
                {bodyLines.map((ln, i) => <div key={i}>{ln}</div>)}
              </div>

              {branch.kind === "inside" && presetPicker}
              {branch.kind === "none" && (
                <>
                  {presetPicker}
                  <button className="btn btn-accent" onClick={() => confirmCheckout(null)} style={{ height: 48, width: "100%", marginTop: 12 }}>퇴실 처리</button>
                </>
              )}
              {branch.kind === "outside" && (
                cc.expanded ? presetPicker : (
                  <>
                    <button className="btn btn-accent" onClick={() => confirmCheckout(branch.label)} style={{ height: 48, width: "100%" }}>확인</button>
                    <button className="btn" onClick={() => setCheckoutConfirm({ ...cc, expanded: true })} style={{ height: 40, width: "100%", marginTop: 8, fontSize: 12.5 }}>다른 사유 선택</button>
                  </>
                )
              )}

              <button className="btn" onClick={() => setCheckoutConfirm(null)} style={{ height: 44, width: "100%", marginTop: 12 }}>취소</button>
            </div>
          </>
        );
      })()}
    </main>
  );
}
