"use client";

// 직원 근무·수업·상담 주간 일정 관리 화면.
// 격자는 하나뿐이다 — 세로 = 공유 시간 축(반복 없음), 가로 = 요일 7칸. 사람은 그 격자 안의 블록으로
// 나타난다("사람별/공간별" 전환은 이제 행의 정체성이 아니라 블록에 적는 라벨의 정체성만 바꾼다:
// 사람별=이름, 공간별=방 이름). 같은 요일·시간대에 여러 사람이 겹치면(서버는 같은 사람·같은 공간의
// 겹침만 막으므로 서로 다른 사람끼리 겹치는 건 정상이다) src/lib/staff-schedule.ts 의 layoutLanes 로
// 나란히 배치한다 — 학생 스케쥴러(ScheduleDemo.tsx layoutDay)와 같은 구간-클러스터링 알고리즘.
// 시간 축·오늘 열 강조·주말 요일색·현재 시각선도 학생 스케쥴러에서 그대로 가져온 어휘다.
// 겹침 "판정"(추가·수정 시 막는 로직)은 그대로 src/lib/staff-schedule.ts 의 순수 함수 — 이 파일과
// 서버 액션이 같은 함수를 쓴다. 이 파일은 표시(레인 배치)만 새로 손댔다.
import { useEffect, useMemo, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { weekDays, addDays, weekdayOf } from "@/lib/date";
import {
  STAFF_SCHEDULE_KINDS, STAFF_SCHEDULE_BY_KEY, findPersonConflicts, findRoomConflicts,
  weeklyMinutesByPerson, layoutLanes, hoursLabel, parseClock, clockLabel, type ScheduleBlock, type StaffScheduleKind,
} from "@/lib/staff-schedule";
import Modal from "../_shared/Modal";
import { useUndoToast } from "../_shared/UndoToast";
import {
  createStaffSchedule, updateStaffSchedule, deleteStaffSchedule, restoreStaffSchedule,
  createSpace, updateSpace, deleteSpace,
} from "./actions";

export type StaffRow = { id: string; name: string };
export type SpaceRow = { id: string; name: string; floor: number; capacity: number | null };
export type ScheduleRow = {
  id: string; personId: string; personName: string; date: string; start: number; end: number;
  kind: string; roomId: string | null; roomName: string | null; note: string | null;
};

const START = 7 * 60, END = 24 * 60, STEP = 30; // 07:00~24:00 그리드 범위
const SLOTS = (END - START) / STEP; // 30분 슬롯 개수(28)
const ROW_H = 22; // 30분 슬롯당 px(시간당 44px) — 사람마다 반복되던 행이 없어졌으니 전체 높이는 이제 고정으로 충분하다.
const TICK_STEP = 60; // 시간 축 눈금 간격(분) — 정시마다
// "성수기" 톤 경계(표시용 휴리스틱일 뿐 운영 규칙이 아니다) — 이 구간 밖(이른 아침·늦은 밤)은
// 학생 스케쥴러의 등하원 이전/이후 음영과 같은 방식(panel2 반투명 워시)으로 배경에서 물러나게 한다.
const BIZ_START = 9 * 60, BIZ_END = 22 * 60;

// 사이드바 — DESIGN.md §1 "화면 위쪽에 조작거리가 쌓이면 본문이 아래로 밀려 안 보인다 ... 옆으로
// 보내라"에 따라 예전엔 상단에 세 줄(보기 전환·사람 필터·주간 합계)로 쌓여 있던 걸 옆으로 옮겼다.
// 좌측엔 이미 전역 네비 레일이 있어 사이드바를 또 왼쪽에 붙이면 레일+사이드바+본문 세 겹이 되어
// 시선이 더 늘어난다 — 그래서 우측에 둔다. 타임테이블(TABLE_W=980, DESIGN.md 확정값)은 그대로 두고
// 사이드바 폭만 더한 값이 이 화면의 새 폭 상한이다: 980 + 16(gap) + 220(펼침) = 1216.
const TABLE_W = 980, SIDEBAR_GAP = 16, SIDEBAR_W = 220, SIDEBAR_W_COLLAPSED = 44;
const SIDEBAR_COLLAPSE_KEY = "sc-collapse:staff-schedule-sidebar";

const yPx = (min: number) => ((min - START) / STEP) * ROW_H;
const hPx = (a: number, b: number) => ((b - a) / STEP) * ROW_H;
const ticks: number[] = (() => { const out: number[] = []; for (let m = START; m <= END; m += TICK_STEP) out.push(m); return out; })();

// ── 인라인 라인 아이콘(이모지 금지) ──
const ic = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function IconPlus() { return <svg {...ic}><path d="M8 3v10M3 8h10" /></svg>; }
function IconUser() { return <svg {...ic}><circle cx="8" cy="5.5" r="2.8" /><path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /></svg>; }
function IconRoom() { return <svg {...ic}><rect x="2" y="2.5" width="12" height="11" rx="1.3" /><path d="M2 7.5h12" /></svg>; }
function IconClose() { return <svg {...ic}><path d="M4 4l8 8M12 4l-8 8" /></svg>; }
function IconTrash() { return <svg {...ic}><path d="M3 4.5h10M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5M4.5 4.5l.6 8a1.5 1.5 0 001.5 1.4h2.8a1.5 1.5 0 001.5-1.4l.6-8" /></svg>; }
function IconPencil() { return <svg {...ic}><path d="M10.5 2.5l3 3L5 14H2v-3z" /></svg>; }
function IconSidebarCollapse() { return <svg {...ic}><rect x="2" y="2.5" width="12" height="11" rx="1.3" /><path d="M6.5 2.5v11" /><path d="M9.5 6.5L8 8l1.5 1.5" /></svg>; }
function IconSidebarExpand() { return <svg {...ic}><rect x="2" y="2.5" width="12" height="11" rx="1.3" /><path d="M6.5 2.5v11" /><path d="M8.5 6.5L10 8l-1.5 1.5" /></svg>; }

type View = "person" | "room";
type FormState = {
  id: string | null; date: string; personId: string; kind: StaffScheduleKind; roomId: string; start: string; end: string; note: string;
};

function blockOf(r: ScheduleRow): ScheduleBlock {
  return { id: r.id, personId: r.personId, roomId: r.roomId, date: r.date, start: r.start, end: r.end };
}

/** "YYYY-MM-DD" 가 속한 주의 월요일 — date.ts weekStartKey() 와 같은 계산을 문자열 인자로. */
function mondayOfKey(key: string): string {
  return addDays(key, -(((weekdayOf(key) + 6) % 7)));
}

export default function StaffScheduleView({
  weekStart, staff, spaces, schedule, canManage, today,
}: {
  weekStart: string; staff: StaffRow[]; spaces: SpaceRow[]; schedule: ScheduleRow[]; canManage: boolean; today: string;
}) {
  const [view, setView] = useState<View>("person");
  const [personFilter, setPersonFilter] = useState<string[]>([]); // 빈 배열 = 전체
  const [form, setForm] = useState<FormState | null>(null);
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [pending, start] = useTransition();
  const toast = useUndoToast();

  // 사이드바 접힘 — StudentList.tsx 의 방 목록 접힘과 같은 관례(localStorage, 마운트 후에만 읽어
  // 하이드레이션 불일치를 피한다). 화면(staff-schedule)당 하나뿐이라 Set 대신 boolean.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1") setSidebarCollapsed(true);
    } catch {
      // 읽기 실패는 무시 — 기본값(펼침) 유지.
    }
  }, []);
  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // 저장 실패(프라이빗 모드 등)는 무시 — 이번 세션 동안만 유지.
      }
      return next;
    });
  };

  const days = useMemo(() => weekDays(weekStart), [weekStart]);

  // ── 현재 시각(KST, 실시간) — 학생 스케쥴러와 같은 패턴: 서버 렌더 시점엔 알 수 없으므로 null로
  // 시작해 하이드레이션 미스매치를 피하고, 마운트 이펙트에서 계산 후 30초마다 갱신한다.
  const [nowMin, setNowMin] = useState<number | null>(null);
  const [kstDate, setKstDate] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowMin((d.getUTCHours() * 60 + d.getUTCMinutes() + 540) % 1440);
      const kd = new Date(d.getTime() + 9 * 60 * 60 * 1000);
      setKstDate(`${kd.getUTCFullYear()}-${String(kd.getUTCMonth() + 1).padStart(2, "0")}-${String(kd.getUTCDate()).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);
  const effToday = kstDate ?? today;
  const isCurrentWeek = weekStart === mondayOfKey(effToday);
  const nowTop = isCurrentWeek && nowMin != null && nowMin >= START && nowMin <= END ? yPx(nowMin) : null;

  // (날짜) → 그 날 격자에 들어갈 블록들. 공간 보기는 공간이 없는 카운터 근무를 표시할 칸이 없으므로 제외한다.
  // 사람 필터가 걸려 있으면 그 사람들만.
  const byDate = useMemo(() => {
    const map = new Map<string, ScheduleRow[]>();
    for (const r of schedule) {
      if (view === "room" && !r.roomId) continue;
      if (personFilter.length && !personFilter.includes(r.personId)) continue;
      const arr = map.get(r.date) ?? [];
      arr.push(r);
      map.set(r.date, arr);
    }
    return map;
  }, [schedule, view, personFilter]);

  const weeklyMinutes = useMemo(
    () => weeklyMinutesByPerson(schedule.map((r) => ({ personId: r.personId, start: r.start, end: r.end }))),
    [schedule],
  );

  const toggleFilter = (id: string) => setPersonFilter((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  const openCreate = (date: string, defaultPersonId?: string) => {
    if (!canManage) return;
    const personId = defaultPersonId ?? staff[0]?.id ?? "";
    setForm({ id: null, date, personId, kind: "counter", roomId: "", start: "09:00", end: "10:00", note: "" });
  };
  const openEdit = (r: ScheduleRow) => {
    if (!canManage) return;
    setForm({ id: r.id, date: r.date, personId: r.personId, kind: r.kind as StaffScheduleKind, roomId: r.roomId ?? "", start: clockLabel(r.start), end: clockLabel(r.end), note: r.note ?? "" });
  };

  const doDelete = (r: ScheduleRow) => {
    setForm(null);
    const fd = new FormData();
    fd.set("id", r.id);
    start(async () => {
      await deleteStaffSchedule(fd);
      const kindLabel = STAFF_SCHEDULE_BY_KEY[r.kind]?.label ?? r.kind;
      toast.notify(`"${r.personName} · ${kindLabel}" 삭제됨`, () => {
        const rfd = new FormData();
        rfd.set("id", r.id);
        rfd.set("personId", r.personId);
        rfd.set("date", r.date);
        rfd.set("kind", r.kind);
        if (r.roomId) rfd.set("roomId", r.roomId);
        rfd.set("start", String(r.start));
        rfd.set("end", String(r.end));
        if (r.note) rfd.set("note", r.note);
        start(async () => { await restoreStaffSchedule(rfd); });
      });
    });
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {schedule.length === 0 && (
        <div style={{ padding: "8px 20px", fontSize: 11.5, color: "var(--sub)", flex: "none" }}>
          이번 주 등록된 근무표가 없습니다{canManage ? " — 빈 칸을 클릭하거나 사이드바의 “근무표 추가”로 만드세요." : "."}
        </div>
      )}

      {/* 그리드 — 세로 = 하나뿐인 공유 시간 축, 가로 = 요일 7칸. 사람은 격자 안의 블록.
          옆에는 사이드바(보기 전환·사람 필터·주간 합계·관리) — 예전엔 이 셋이 상단에 세 줄로 쌓여
          본문(격자)을 아래로 밀어냈다(DESIGN.md §1 "화면 위쪽에 조작거리가 쌓이면 ... 옆으로
          보내라"). 주 이동은 집주인이 전에 지시한 대로 타임테이블 중앙 상단(page.tsx)에 그대로 둔다.
          넓은 화면에서 요일 칸이 끝없이 벌어지지 않게 타임테이블 폭(TABLE_W=980, DESIGN.md 확정값)은
          그대로 두고 사이드바 폭만 더해 전체를 가운데 정렬한다. */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "10px 16px 14px" }}>
        <div
          className="staff-sched-layout"
          style={{ maxWidth: TABLE_W + SIDEBAR_GAP + (sidebarCollapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W), margin: "0 auto", gap: SIDEBAR_GAP }}
        >
        <div style={{ width: "100%", maxWidth: TABLE_W, minWidth: 0, flex: "1 1 auto" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 3, background: "var(--bg)", paddingBottom: 3 }}>
          <div style={{ display: "grid", gridTemplateColumns: "46px repeat(7,1fr)", gap: 6 }}>
            <div />
            {days.map((d) => {
              const isToday = d.key === effToday;
              const wdColor = d.wd === "토" ? "#2563eb" : d.wd === "일" ? "var(--danger)" : "var(--sub)";
              return (
                <div key={d.key} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "2px 0" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: wdColor }}>{d.wd}</span>
                  <span style={{
                    fontSize: 12, fontWeight: isToday ? 800 : 600, fontVariantNumeric: "tabular-nums",
                    color: isToday ? "#fff" : "var(--ink)", background: isToday ? "var(--accent)" : "transparent",
                    borderRadius: 999, minWidth: 20, height: 20, lineHeight: "20px", padding: isToday ? "0 5px" : 0,
                  }}>{d.dayNum}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ position: "relative" }}>
          <div style={{ display: "grid", gridTemplateColumns: "46px repeat(7,1fr)", gap: 6 }}>
            {/* 시간 축 — 격자 전체에서 딱 한 번. */}
            <div style={{ position: "relative", height: SLOTS * ROW_H }}>
              {ticks.map((m) => (
                <span key={m} style={{
                  position: "absolute", right: 4, top: yPx(m),
                  // 가운데 정렬이 기본이지만 첫·마지막 눈금은 그대로 두면 글자 절반이 격자 밖으로
                  // 잘린다 — 양 끝만 안쪽으로 붙인다.
                  transform: m === START ? "translateY(0)" : m === END ? "translateY(-100%)" : "translateY(-50%)",
                  fontSize: 10, fontWeight: 700, color: "var(--sub)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                }}>{clockLabel(m)}</span>
              ))}
              {nowTop != null && (
                <span style={{ position: "absolute", right: 2, top: nowTop, transform: "translateY(-50%)", fontSize: 9.5, fontWeight: 800, color: "#fff", background: "var(--accent)", borderRadius: 4, padding: "1px 4px", whiteSpace: "nowrap" }}>
                  {clockLabel(nowMin!)}
                </span>
              )}
            </div>

            {days.map((d) => {
              const isToday = d.key === effToday;
              const laid = layoutLanes(byDate.get(d.key) ?? []);
              return (
                <div
                  key={d.key}
                  style={{
                    position: "relative", height: SLOTS * ROW_H, borderRadius: 9, overflow: "hidden",
                    border: `1px solid ${isToday ? "var(--accent)" : "var(--line)"}`,
                    background: "var(--card)", backgroundImage: hourLines((TICK_STEP / STEP) * ROW_H),
                    cursor: canManage ? "copy" : "default",
                  }}
                  onClick={(e) => {
                    if (!canManage || e.target !== e.currentTarget) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const rawMin = START + ((e.clientY - rect.top) / ROW_H) * STEP;
                    const slot = Math.max(START, Math.min(END - 60, Math.round(rawMin / STEP) * STEP));
                    openCreate(d.key, personFilter.length === 1 ? personFilter[0] : undefined);
                    setForm((f) => f && { ...f, start: clockLabel(slot), end: clockLabel(slot + 60) });
                  }}
                >
                  {/* 운영 시간대 밖(이른 아침·늦은 밤)은 톤을 낮춰 배경으로 물러나게 한다 — 학생 스케쥴러의
                      등하원 이전/이후 워시와 같은 기법. 클릭을 가리지 않도록 pointerEvents:none. */}
                  {BIZ_START > START && <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: yPx(BIZ_START), background: "var(--panel2)", opacity: 0.55, pointerEvents: "none" }} />}
                  {BIZ_END < END && <div style={{ position: "absolute", left: 0, right: 0, top: yPx(BIZ_END), bottom: 0, background: "var(--panel2)", opacity: 0.55, pointerEvents: "none" }} />}

                  {laid.map((r) => {
                    const k = STAFF_SCHEDULE_BY_KEY[r.kind];
                    const label = view === "person" ? r.personName : (r.roomName ?? k?.label ?? r.kind);
                    const width = 100 / r.lanes;
                    const blockH = Math.max(hPx(r.start, r.end), 16) - 2;
                    const showTime = blockH >= 22;
                    const isNow = isToday && nowMin != null && nowMin >= r.start && nowMin < r.end;
                    return (
                      <div
                        key={r.id}
                        title={`${r.personName} · ${k?.label ?? r.kind}${r.roomName ? " · " + r.roomName : ""} · ${clockLabel(r.start)}~${clockLabel(r.end)}${r.note ? " · " + r.note : ""}`}
                        onClick={(e) => { e.stopPropagation(); openEdit(r); }}
                        style={{
                          position: "absolute", left: `calc(${r.lane * width}% + 2px)`, width: `calc(${width}% - 4px)`,
                          top: yPx(r.start), height: blockH, zIndex: isNow ? 3 : 2, boxSizing: "border-box",
                          background: k?.bg ?? "var(--panel2)", borderLeft: `3px solid ${k?.dot ?? "var(--sub)"}`, borderRadius: 5,
                          boxShadow: isNow ? "0 0 0 1px var(--accent)" : undefined,
                          fontSize: 10, fontWeight: 700, color: "var(--ink)", padding: "2px 5px", overflow: "hidden",
                          whiteSpace: "nowrap", textOverflow: "ellipsis", cursor: canManage ? "pointer" : "default", lineHeight: 1.25,
                        }}
                      >
                        {label}
                        {showTime && (
                          <div style={{ fontSize: 8, fontWeight: 600, opacity: 0.75, fontVariantNumeric: "tabular-nums" }}>
                            {clockLabel(r.start)}–{clockLabel(r.end)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {nowTop != null && (
            <div style={{ position: "absolute", left: 46, right: 0, top: nowTop, height: 0, borderTop: "1.5px solid var(--accent)", zIndex: 4, pointerEvents: "none" }} />
          )}
        </div>
        </div>

        <StaffScheduleSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebar}
          view={view}
          onSetView={setView}
          staff={staff}
          personFilter={personFilter}
          onClearFilter={() => setPersonFilter([])}
          onToggleFilter={toggleFilter}
          weeklyMinutes={weeklyMinutes}
          canManage={canManage}
          spacesEmpty={view === "room" && spaces.length === 0}
          onAdd={() => openCreate(effToday >= days[0].key && effToday <= days[6].key ? effToday : days[0].key, personFilter.length === 1 ? personFilter[0] : undefined)}
          onManageSpaces={() => setSpacesOpen(true)}
        />
        </div>
      </div>

      {form && (
        <ScheduleFormModal
          form={form} setForm={setForm} days={days} staff={staff} spaces={spaces} schedule={schedule}
          onClose={() => setForm(null)} onDelete={doDelete} pending={pending} start={start}
        />
      )}
      {spacesOpen && <SpacesModal spaces={spaces} onClose={() => setSpacesOpen(false)} />}
      {toast.element}
    </div>
  );
}

/** 시간 눈금선 배경 — 축 눈금과 같은 간격(px)으로 그려 축과 그리드가 서로 어긋나지 않게 한다. */
function hourLines(pxPerTick: number): string {
  return `repeating-linear-gradient(to bottom, var(--line) 0, var(--line) 1px, transparent 1px, transparent ${pxPerTick}px)`;
}

const viewBtn = (active: boolean): CSSProperties => ({
  height: 30, padding: "0 10px", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 5,
  border: "none", cursor: "pointer", background: active ? "var(--accent)" : "var(--card)", color: active ? "#fff" : "var(--sub)",
});
const filterChip = (active: boolean): CSSProperties => ({
  fontSize: 11, fontWeight: 700,
  border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
  background: active ? "var(--accent-soft)" : "var(--card)",
  color: active ? "var(--accent)" : "var(--sub)",
});

// ---------------- 사이드바 — 보기 전환·사람 필터·주간 합계·관리(공간·추가) ----------------
// DESIGN.md §1 마지막 항목 근거로 예전에 상단에 쌓여 있던 세 줄을 옆으로 옮긴 자리.
// 이 안의 내용은 전부 "타임테이블을 보면서 계속 볼 필요가 없는 것"이다 — 필터·보기는 한 번
// 누르고 나면 격자만 보면 되고, 주간 합계는 가끔 참조하는 요약이다. 시선이 계속 오가야 하는
// 것(오늘 날짜·주 이동)은 그대로 타임테이블 중앙 상단(page.tsx)에 남겨 뒀다.
function StaffScheduleSidebar({
  collapsed, onToggleCollapsed, view, onSetView, staff, personFilter, onClearFilter, onToggleFilter,
  weeklyMinutes, canManage, spacesEmpty, onAdd, onManageSpaces,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  view: View;
  onSetView: (v: View) => void;
  staff: StaffRow[];
  personFilter: string[];
  onClearFilter: () => void;
  onToggleFilter: (id: string) => void;
  weeklyMinutes: Record<string, number>;
  canManage: boolean;
  spacesEmpty: boolean;
  onAdd: () => void;
  onManageSpaces: () => void;
}) {
  const asideVars = { "--aside-w": `${collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W}px` } as CSSProperties;

  if (collapsed) {
    return (
      <div className="staff-sched-aside" style={asideVars}>
        <button
          className="chip" onClick={onToggleCollapsed} aria-label="사이드바 펼치기" title="사이드바 펼치기"
          style={{ height: 30, width: 30, padding: 0, justifyContent: "center", cursor: "pointer" }}
        ><IconSidebarExpand /></button>
      </div>
    );
  }

  const totalRows = staff.filter((p) => (weeklyMinutes[p.id] ?? 0) > 0);

  return (
    <div className="staff-sched-aside" style={{ ...asideVars, display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 11, fontWeight: 800, color: "var(--sub)" }}>도구</span>
        <button
          className="chip" onClick={onToggleCollapsed} aria-label="사이드바 접기" title="사이드바 접기"
          style={{ height: 26, width: 26, padding: 0, justifyContent: "center", cursor: "pointer" }}
        ><IconSidebarCollapse /></button>
      </div>

      <SidebarSection title="보기">
        <div style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 9, overflow: "hidden" }}>
          <button onClick={() => onSetView("person")} style={{ ...viewBtn(view === "person"), flex: 1, justifyContent: "center" }}><IconUser /> 사람별</button>
          <button onClick={() => onSetView("room")} style={{ ...viewBtn(view === "room"), flex: 1, justifyContent: "center" }}><IconRoom /> 공간별</button>
        </div>
      </SidebarSection>

      {staff.length > 0 && (
        <SidebarSection title="사람 필터">
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            <button onClick={onClearFilter} className="chip" style={{ ...filterChip(personFilter.length === 0), cursor: "pointer" }}>전체</button>
            {staff.map((p) => (
              <button key={p.id} onClick={() => onToggleFilter(p.id)} className="chip" style={{ ...filterChip(personFilter.includes(p.id)), cursor: "pointer" }}>{p.name}</button>
            ))}
          </div>
        </SidebarSection>
      )}

      <SidebarSection title="이번 주 합계">
        {totalRows.length === 0 ? (
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>기록 없음</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {totalRows.map((p) => (
              <div key={p.id} className="flex items-center justify-between" style={{ fontSize: 11.5 }}>
                <span style={{ color: "var(--ink)", fontWeight: 600 }}>{p.name}</span>
                <span style={{ color: "var(--accent)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{hoursLabel(weeklyMinutes[p.id] ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </SidebarSection>

      {canManage && (
        <SidebarSection title="관리">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              className="btn btn-accent" onClick={onAdd}
              style={{ height: 32, padding: "0 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 5, justifyContent: "center" }}
            ><IconPlus /> 근무표 추가</button>
            <button className="chip" onClick={onManageSpaces} style={{ cursor: "pointer", fontWeight: 700, justifyContent: "center" }}>공간 관리</button>
          </div>
          {spacesEmpty && (
            <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 8, lineHeight: 1.5 }}>등록된 공간이 없습니다 — 공간이 배정된 근무표만 격자에 표시됩니다.</div>
          )}
        </SidebarSection>
      )}
    </div>
  );
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--sub)", marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

// ---------------- 일정 추가·수정 모달 ----------------
function ScheduleFormModal({
  form, setForm, days, staff, spaces, schedule, onClose, onDelete, pending, start,
}: {
  form: FormState;
  setForm: (f: FormState | null | ((prev: FormState | null) => FormState | null)) => void;
  days: { key: string; wd: string; dayNum: number }[];
  staff: StaffRow[]; spaces: SpaceRow[]; schedule: ScheduleRow[];
  onClose: () => void;
  onDelete: (r: ScheduleRow) => void;
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const kindDef = STAFF_SCHEDULE_BY_KEY[form.kind];
  const startMin = parseClock(form.start);
  const endMin = parseClock(form.end);

  const conflicts = useMemo(() => {
    if (startMin == null || endMin == null || endMin <= startMin) return { person: [] as ScheduleBlock[], room: [] as ScheduleBlock[] };
    const cand = { id: form.id ?? undefined, personId: form.personId, roomId: kindDef.needsRoom ? (form.roomId || null) : null, date: form.date, start: startMin, end: endMin };
    const dayBlocks = schedule.filter((r) => r.date === form.date).map(blockOf);
    return { person: findPersonConflicts(dayBlocks, cand), room: findRoomConflicts(dayBlocks, cand) };
  }, [schedule, form, startMin, endMin, kindDef.needsRoom]);

  const timeValid = startMin != null && endMin != null && endMin > startMin;
  const roomOk = !kindDef.needsRoom || !!form.roomId;
  const canSave = timeValid && roomOk && !conflicts.person.length && !conflicts.room.length;

  const findPersonName = (id: string) => staff.find((p) => p.id === id)?.name ?? "";
  const findRoomName = (id: string) => spaces.find((r) => r.id === id)?.name ?? "";

  const submit = () => {
    if (!canSave) return;
    const fd = new FormData();
    if (form.id) fd.set("id", form.id);
    fd.set("personId", form.personId);
    fd.set("date", form.date);
    fd.set("kind", form.kind);
    if (kindDef.needsRoom && form.roomId) fd.set("roomId", form.roomId);
    fd.set("start", String(startMin));
    fd.set("end", String(endMin));
    if (form.note.trim()) fd.set("note", form.note.trim());
    start(async () => {
      const r = form.id ? await updateStaffSchedule(fd) : await createStaffSchedule(fd);
      if (r.ok) onClose(); else setError(r.error);
    });
  };

  return (
    <Modal
      onClose={onClose}
      backdropBackground="rgba(20,22,30,.45)"
      backdropZIndex={60}
      panelZIndex={61}
      ariaLabelledBy="staff-sched-form-title"
      panelStyle={{ width: 440, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100dvh - 60px)", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "0 24px 70px rgba(20,22,30,.35)" }}
    >
      <div className="flex items-center justify-between" style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
        <div id="staff-sched-form-title" style={{ fontSize: 17, fontWeight: 800 }}>{form.id ? "근무표 수정" : "근무표 추가"}</div>
        <button onClick={onClose} className="chip" style={{ height: 30, width: 30, padding: 0, justifyContent: "center", cursor: "pointer" }}><IconClose /></button>
      </div>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div className="label">담당자</div>
          <select className="input" style={{ height: 42 }} value={form.personId} onChange={(e) => setForm((f) => f && { ...f, personId: e.target.value })}>
            {staff.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <div className="label">날짜</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {days.map((d) => (
              <button key={d.key} type="button" onClick={() => setForm((f) => f && { ...f, date: d.key })}
                style={dayBtn(form.date === d.key)}>{d.wd} {d.dayNum}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="label">종류</div>
          <div style={{ display: "flex", gap: 6 }}>
            {STAFF_SCHEDULE_KINDS.map((k) => (
              <button key={k.key} type="button" onClick={() => setForm((f) => f && { ...f, kind: k.key })}
                style={{ ...dayBtn(form.kind === k.key), flex: 1, borderColor: form.kind === k.key ? k.dot : "var(--line)" }}>{k.label}</button>
            ))}
          </div>
        </div>
        {kindDef.needsRoom && (
          <div>
            <div className="label">공간</div>
            <select className="input" style={{ height: 42 }} value={form.roomId} onChange={(e) => setForm((f) => f && { ...f, roomId: e.target.value })}>
              <option value="">공간 선택</option>
              {spaces.map((r) => <option key={r.id} value={r.id}>{r.name}{r.capacity ? ` (정원 ${r.capacity})` : ""}</option>)}
            </select>
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <TimeField label="시작" value={form.start} onChange={(v) => setForm((f) => f && { ...f, start: v })} />
          <TimeField label="종료" value={form.end} onChange={(v) => setForm((f) => f && { ...f, end: v })} />
        </div>
        <div>
          <div className="label">메모</div>
          <input className="input" style={{ height: 42 }} value={form.note} onChange={(e) => setForm((f) => f && { ...f, note: e.target.value })} placeholder="선택 입력" />
        </div>

        {!timeValid && <Warn text="시작·종료 시간을 확인하세요(예: 09:00, 930)." />}
        {timeValid && kindDef.needsRoom && !form.roomId && <Warn text="공간을 선택하세요." />}
        {conflicts.person.length > 0 && (
          <Warn text={`같은 사람(${findPersonName(form.personId)})이 이미 그 시간에 배정되어 있습니다: ${conflicts.person.map((c) => `${clockLabel(c.start)}~${clockLabel(c.end)}`).join(", ")}`} />
        )}
        {conflicts.room.length > 0 && (
          <Warn text={`같은 공간(${findRoomName(form.roomId)})이 이미 그 시간에 배정되어 있습니다: ${conflicts.room.map((c) => `${clockLabel(c.start)}~${clockLabel(c.end)}`).join(", ")}`} />
        )}
        {error && <Warn text={error} />}

        <div className="flex items-center justify-between" style={{ marginTop: 4 }}>
          {form.id ? (
            <button type="button" className="chip" style={{ color: "var(--danger)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
              onClick={() => { const row = schedule.find((r) => r.id === form.id); if (row) onDelete(row); }}
            ><IconTrash /> 삭제</button>
          ) : <span />}
          <button className="btn btn-accent" style={{ height: 42, padding: "0 20px" }} disabled={!canSave || pending} onClick={submit}>
            {form.id ? "수정 완료" : "추가"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Warn({ text }: { text: string }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: "var(--danger)", background: "color-mix(in srgb, var(--danger) 12%, var(--card))", borderRadius: 8, padding: "8px 10px" }}>{text}</div>;
}

const dayBtn = (active: boolean): CSSProperties => ({
  height: 34, padding: "0 10px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer",
  border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`, background: active ? "var(--accent)" : "var(--card)", color: active ? "#fff" : "var(--sub)",
});

// "입력은 raw 유지, 정규화는 blur" — onChange 는 허용 문자만 거르고, 유효하면 blur 시점에 HH:MM 으로 정규화.
function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ flex: 1 }}>
      <div className="label">{label}</div>
      <input
        className="input" style={{ height: 42 }} inputMode="numeric" placeholder="HH:MM"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value.replace(/[^0-9:]/g, ""))}
        onBlur={(e) => { const m = parseClock(e.currentTarget.value); if (m != null) onChange(clockLabel(m)); }}
      />
    </div>
  );
}

// ---------------- 공간 관리 모달 ----------------
function SpacesModal({ spaces, onClose }: { spaces: SpaceRow[]; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Modal
      onClose={onClose}
      backdropBackground="rgba(20,22,30,.45)"
      backdropZIndex={62}
      panelZIndex={63}
      ariaLabelledBy="spaces-title"
      panelStyle={{ width: 460, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100dvh - 60px)", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "0 24px 70px rgba(20,22,30,.35)" }}
    >
      <div className="flex items-center justify-between" style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
        <div id="spaces-title" style={{ fontSize: 17, fontWeight: 800 }}>공간 관리</div>
        <button onClick={onClose} className="chip" style={{ height: 30, width: 30, padding: 0, justifyContent: "center", cursor: "pointer" }}><IconClose /></button>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 11.5, color: "var(--sub)" }}>정원은 강제 규칙이 아니라 방을 고를 때 보이는 표시용입니다. 좌석 격자가 있는 방(자습실)의 정원·좌석 구성은 좌석 배치도에서 관리합니다.</div>
        {spaces.map((r) =>
          editing === r.id ? (
            <SpaceEditRow key={r.id} space={r} onDone={() => setEditing(null)} pending={pending} start={start} />
          ) : (
            <div key={r.id} className="flex items-center justify-between" style={{ padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {r.name} <span style={{ color: "var(--sub)", fontWeight: 500, fontSize: 11.5 }}>{r.floor}층{r.capacity ? ` · 정원 ${r.capacity}` : ""}</span>
              </div>
              <div className="flex items-center gap-1">
                <button className="chip" style={{ height: 28, padding: "0 8px", cursor: "pointer" }} onClick={() => setEditing(r.id)}><IconPencil /></button>
                {confirmDel === r.id ? (
                  <button className="chip" style={{ height: 28, padding: "0 8px", cursor: "pointer", color: "var(--danger)", fontWeight: 700 }}
                    disabled={pending}
                    onClick={() => {
                      const fd = new FormData(); fd.set("id", r.id);
                      start(async () => { await deleteSpace(fd); setConfirmDel(null); });
                    }}
                  >정말 삭제?</button>
                ) : (
                  <button className="chip" style={{ height: 28, padding: "0 8px", cursor: "pointer", color: "var(--danger)" }} onClick={() => setConfirmDel(r.id)}><IconTrash /></button>
                )}
              </div>
            </div>
          ),
        )}
        {adding ? (
          <SpaceEditRow onDone={() => setAdding(false)} pending={pending} start={start} />
        ) : (
          <button className="chip" style={{ cursor: "pointer", fontWeight: 700, justifyContent: "center" }} onClick={() => setAdding(true)}><IconPlus /> 공간 추가</button>
        )}
      </div>
    </Modal>
  );
}

function SpaceEditRow({ space, onDone, pending, start }: { space?: SpaceRow; onDone: () => void; pending: boolean; start: (fn: () => Promise<void>) => void }) {
  const [name, setName] = useState(space?.name ?? "");
  const [floor, setFloor] = useState(String(space?.floor ?? 4));
  const [capacity, setCapacity] = useState(space?.capacity ? String(space.capacity) : "");
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!name.trim()) { setError("이름을 입력하세요."); return; }
    const fd = new FormData();
    if (space) fd.set("id", space.id);
    fd.set("name", name.trim());
    fd.set("floor", floor || "4");
    if (capacity) fd.set("capacity", capacity);
    start(async () => {
      const r = space ? await updateSpace(fd) : await createSpace(fd);
      if (r.ok) onDone(); else setError(r.error);
    });
  };

  return (
    <div style={{ padding: 10, border: "1px solid var(--accent)", borderRadius: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input className="input" style={{ height: 38, flex: 2 }} placeholder="이름 (예: 4층 1:1실)" value={name}
          onChange={(e) => setName(e.currentTarget.value)} autoFocus />
        <input className="input" style={{ height: 38, flex: 1 }} type="number" min={1} max={9} placeholder="층" value={floor}
          onChange={(e) => setFloor(e.currentTarget.value.replace(/[^0-9]/g, ""))} />
        <input className="input" style={{ height: 38, flex: 1 }} type="number" min={1} placeholder="정원" value={capacity}
          onChange={(e) => setCapacity(e.currentTarget.value.replace(/[^0-9]/g, ""))} />
      </div>
      {error && <Warn text={error} />}
      <div className="flex items-center justify-end gap-2">
        <button className="chip" style={{ cursor: "pointer" }} onClick={onDone}>취소</button>
        <button className="btn btn-accent" style={{ height: 34, padding: "0 14px", fontSize: 12.5 }} disabled={pending} onClick={save}>저장</button>
      </div>
    </div>
  );
}
