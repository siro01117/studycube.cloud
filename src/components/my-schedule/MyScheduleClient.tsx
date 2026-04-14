"use client";

import {
  useState, useEffect, useCallback, useRef,
  useLayoutEffect, useMemo,
} from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { HomeIcon } from "@/components/ui/Icons";
import { getMonday } from "@/components/classroom-schedule/constants";

// ── 레이아웃 상수 ──────────────────────────────────────────────
const BASE_HOUR   = 8;
const TOTAL_HOURS = 17;
const FIXED_PPH   = 60;
const TIME_COL_W  = 52;
const MIN_BLOCK_H = 16;

const DAYS = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
] as const;
type DayKey = typeof DAYS[number]["key"];

const FALLBACK_ACCENTS = [
  "#00e875","#5badff","#c084fc","#fb923c",
  "#fbbf24","#f472b6","#2dd4bf","#f87171",
];

// ── 타입 ──────────────────────────────────────────────────────
export interface ScheduleBlock {
  id:          string;
  day:         DayKey;
  start_time:  string;
  end_time:    string;
  title:       string;
  subtitle?:   string;
  color?:      string;
  isPersonal:  boolean;
  notes?:      string;
  // 원본 personal_schedule 레코드 (수정용)
  raw?:        any;
}

interface Props {
  userRole:          string;
  userName:          string;
  userId:            string;
  classSchedules:    any[];
  enrollments?:      any[];
  personalSchedules: any[];
  readOnly?:         boolean;
}

// ── 유틸 ──────────────────────────────────────────────────────
function toHHMM(t: string) { return t.slice(0, 5); }

function timeToMin(t: string): number {
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  if (h < BASE_HOUR) h += 24;
  return (h - BASE_HOUR) * 60 + m;
}

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  const n = parseInt(c.length === 3 ? c.split("").map(x => x+x).join("") : c, 16);
  return [(n>>16)&255, (n>>8)&255, n&255];
}

function blockColor(accent: string, isDark: boolean) {
  const [r, g, b] = hexToRgb(accent);
  if (isDark) {
    return {
      bg:    `rgb(${Math.round(r*0.35+15)},${Math.round(g*0.35+15)},${Math.round(b*0.35+17)})`,
      border: accent, text: "#fff", muted: "rgba(255,255,255,0.65)",
    };
  }
  return {
    bg:    `rgb(${Math.min(252,Math.round(r*0.30+175))},${Math.min(252,Math.round(g*0.30+175))},${Math.min(250,Math.round(b*0.30+173))})`,
    border: `rgb(${Math.round(r*0.52)},${Math.round(g*0.52)},${Math.round(b*0.52)})`,
    text: "#0d0d0d", muted: "rgba(15,15,15,0.58)",
  };
}

function accentFor(key: string): string {
  const hash = key.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return FALLBACK_ACCENTS[hash % FALLBACK_ACCENTS.length];
}

function fmtWeekRange(monday: Date, sunday: Date): string {
  const m1 = monday.getMonth() + 1, d1 = monday.getDate();
  const m2 = sunday.getMonth() + 1, d2 = sunday.getDate();
  return m1 === m2 ? `${m1}월 ${d1}일 ~ ${d2}일` : `${m1}월 ${d1}일 ~ ${m2}월 ${d2}일`;
}

const DAY_TO_KEY: Record<number, DayKey | null> = {
  0: null, 1:"mon", 2:"tue", 3:"wed", 4:"thu", 5:"fri", 6:"sat",
};

// ── 훅 ────────────────────────────────────────────────────────
function useDarkMode() {
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains("dark"));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

function useNowPx() {
  const [px, setPx] = useState<number | null>(null);
  const calc = useCallback(() => {
    const now = new Date();
    let h = now.getHours(); const m = now.getMinutes();
    const ok = h >= BASE_HOUR || h === 0 || (h === 1 && m === 0);
    if (!ok) { setPx(null); return; }
    if (h < BASE_HOUR) h += 24;
    const mins = (h - BASE_HOUR)*60 + m;
    if (mins > TOTAL_HOURS*60) { setPx(null); return; }
    setPx(mins * (FIXED_PPH/60));
  }, []);
  useEffect(() => { calc(); const id = setInterval(calc, 30_000); return () => clearInterval(id); }, [calc]);
  return px;
}

function useIsWideLayout() {
  const [isWide, setIsWide] = useState(false);
  useLayoutEffect(() => {
    function check() { setIsWide(window.innerWidth / window.innerHeight > 1.4); }
    check(); window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isWide;
}

function useCounterZoom(base: number): number {
  const initialDPR = useRef<number>(1);
  const [zoom, setZoom] = useState(base);
  useLayoutEffect(() => {
    initialDPR.current = window.devicePixelRatio;
    function update() {
      const cssZoom = window.devicePixelRatio / initialDPR.current;
      setZoom(base / Math.max(0.25, Math.min(4, cssZoom)));
    }
    update(); window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [base]);
  return zoom;
}

// ── WeekNav ───────────────────────────────────────────────────
function WeekNav({ weekOffset, setWeekOffset, compact = false }: {
  weekOffset: number;
  setWeekOffset: (fn: (o: number) => number) => void;
  compact?: boolean;
}) {
  const [pickerVal, setPickerVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const monday = getMonday(weekOffset);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const isCurrentWeek = weekOffset === 0;

  function goToDate(dateStr: string) {
    if (!dateStr) return;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return;
    const thisMonday   = getMonday(0);
    const targetMonday = new Date(d);
    targetMonday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const diffWeeks = Math.round((targetMonday.getTime() - thisMonday.getTime()) / (7*86400000));
    setWeekOffset(() => diffWeeks);
  }

  function openPicker() {
    const y = monday.getFullYear();
    const m = String(monday.getMonth()+1).padStart(2,"0");
    const d = String(monday.getDate()).padStart(2,"0");
    setPickerVal(`${y}-${m}-${d}`);
    setTimeout(() => inputRef.current?.showPicker?.(), 80);
  }

  const navBtn = (dir: -1 | 1) => (
    <button onClick={() => setWeekOffset(o => o + dir)}
      style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        display:"flex", alignItems:"center", justifyContent:"center",
        background:"var(--sc-raised)", border:"1px solid var(--sc-border)",
        color:"var(--sc-white)", fontSize:14, cursor:"pointer",
        transition:"transform 0.1s",
      }}
      onMouseEnter={e=>(e.currentTarget.style.transform="scale(1.1)")}
      onMouseLeave={e=>(e.currentTarget.style.transform="")}>
      {dir === -1 ? "‹" : "›"}
    </button>
  );

  const dateBtn = (
    <div style={{ position:"relative" }}>
      <button onClick={openPicker}
        style={{ fontSize: compact ? 13 : 14, fontWeight:800, color:"var(--sc-white)", background:"none", border:"none", cursor:"pointer", padding:0, lineHeight:1.5 }}>
        {fmtWeekRange(monday, sunday)}
      </button>
      <input ref={inputRef} type="date" value={pickerVal}
        onChange={e => { setPickerVal(e.target.value); goToDate(e.target.value); }}
        style={{ position:"absolute", top:0, left:0, width:"100%", height:"100%", opacity:0, pointerEvents:"none" }}
      />
    </div>
  );

  const thisWeekBtn = (
    <button onClick={() => setWeekOffset(() => 0)}
      style={{
        fontSize:11, fontWeight:800, padding:"3px 10px", borderRadius:7, flexShrink:0,
        color:      isCurrentWeek ? "var(--sc-bg)"    : "var(--sc-dim)",
        background: isCurrentWeek ? "var(--sc-green)" : "var(--sc-raised)",
        border:     `1px solid ${isCurrentWeek ? "var(--sc-green)" : "var(--sc-border)"}`,
        cursor:"pointer", transition:"all 0.15s",
      }}>
      이번 주
    </button>
  );

  if (compact) {
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {dateBtn}
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {navBtn(-1)}
          <div style={{ flex:1, display:"flex", justifyContent:"center" }}>{thisWeekBtn}</div>
          {navBtn(1)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginTop:6 }}>
      {navBtn(-1)}{dateBtn}{navBtn(1)}{thisWeekBtn}
    </div>
  );
}

// ── 블록 컴포넌트 ─────────────────────────────────────────────
function Block({ b, isDark, onClick }: {
  b: ScheduleBlock; isDark: boolean; onClick: () => void;
}) {
  const top    = timeToMin(b.start_time) * (FIXED_PPH/60);
  const height = Math.max((timeToMin(b.end_time) - timeToMin(b.start_time)) * (FIXED_PPH/60), MIN_BLOCK_H);
  const accent = b.color ?? accentFor(b.title);
  const clr    = blockColor(accent, isDark);
  const fzTitle = Math.max(8,  Math.min(14, Math.round(height*0.217)));
  const fzTime  = Math.max(6,  Math.min(10, Math.round(height*0.158)));
  const fzBadge = Math.max(5,  Math.min(9,  Math.round(height*0.133)));

  return (
    <div
      className="sched-block"
      onClick={e => { e.stopPropagation(); onClick(); }}
      style={{
        position:"absolute", top, height, left:3, right:3,
        background:clr.bg, borderLeft:`3px solid ${clr.border}`,
        borderRadius:6, cursor:"pointer", overflow:"hidden",
        padding:"4px 6px", userSelect:"none",
        transition:"filter 0.15s, transform 0.15s", zIndex:2,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.filter    = isDark ? "brightness(1.4)" : "brightness(0.88)";
        e.currentTarget.style.transform = "scaleX(1.015)";
        e.currentTarget.style.zIndex    = "10";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.filter    = "";
        e.currentTarget.style.transform = "";
        e.currentTarget.style.zIndex    = "2";
      }}
    >
      {b.isPersonal && height > 14 && (
        <div style={{
          position:"absolute", top:3, right:4,
          fontSize:fzBadge, fontWeight:800, color:"#000",
          background:clr.border, borderRadius:3, padding:"1px 4px", opacity:0.9,
        }}>개인</div>
      )}
      {height > 16 && (
        <p style={{
          fontSize:fzTitle, fontWeight:800, color:clr.text,
          margin:0, lineHeight:1.3, overflow:"hidden",
          whiteSpace:"nowrap", textOverflow:"ellipsis",
          paddingRight: b.isPersonal ? 26 : 0,
        }}>{b.title}</p>
      )}
      {height > 28 && (
        <div style={{
          position:"absolute", bottom:3, left:6, right:5,
          fontSize:fzTime, fontWeight:600, color:clr.muted,
          whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
        }}>
          {toHHMM(b.start_time)} ~ {toHHMM(b.end_time)}
        </div>
      )}
    </div>
  );
}

// ── 블록 상세 모달 ────────────────────────────────────────────
function DetailModal({ block, onClose, onEdit, onDelete }: {
  block:    ScheduleBlock;
  onClose:  () => void;
  onEdit:   (b: ScheduleBlock) => void;
  onDelete: (id: string, soft: boolean) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState<"soft"|"hard"|null>(null);
  const accent = block.color ?? accentFor(block.title);
  const isRecurring = block.isPersonal && !block.raw?.specific_date;
  const DAY_KR: Record<string, string> = {
    mon:"월",tue:"화",wed:"수",thu:"목",fri:"금",sat:"토",sun:"일",
  };

  async function doDelete(soft: boolean) {
    const msg = soft
      ? "이 일정을 임시로 숨길까요?\n(고정 일정이 이번 주부터 보이지 않게 됩니다)"
      : "이 일정을 완전히 삭제할까요?";
    if (!confirm(msg)) return;
    setDeleting(soft ? "soft" : "hard");
    await onDelete(block.id, soft);
    setDeleting(null);
    onClose();
  }

  const delBtn = (soft: boolean, label: string) => (
    <button
      onClick={() => doDelete(soft)}
      disabled={deleting !== null}
      style={{
        flex:1, padding:"8px 0", borderRadius:8, fontSize:12, fontWeight:800,
        cursor: deleting !== null ? "not-allowed" : "pointer",
        background: soft ? "rgba(251,191,36,0.12)" : "rgba(248,113,113,0.15)",
        color:      soft ? "#fbbf24"               : "#f87171",
        border:     soft ? "1px solid rgba(251,191,36,0.3)" : "1px solid rgba(248,113,113,0.3)",
        opacity: deleting !== null ? 0.5 : 1,
        transition:"opacity 0.15s",
      }}>
      {deleting === (soft ? "soft" : "hard") ? "처리 중…" : label}
    </button>
  );

  return (
    <div
      style={{ position:"fixed", inset:0, zIndex:50, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background:"var(--sc-surface)", border:"1px solid var(--sc-border)",
          borderRadius:16, padding:"22px 22px 18px", width:"100%", maxWidth:320,
          display:"flex", flexDirection:"column", gap:14,
        }}
      >
        {/* 상단 색 바 + 제목 */}
        <div style={{ borderLeft:`4px solid ${accent}`, paddingLeft:10 }}>
          <p style={{ fontSize:11, fontWeight:700, color:"var(--sc-dim)", margin:"0 0 3px", textTransform:"uppercase", letterSpacing:"0.1em" }}>
            {block.isPersonal ? (isRecurring ? "고정 일정" : "임시 일정") : "수업"}
          </p>
          <p style={{ fontSize:17, fontWeight:900, color:"var(--sc-white)", margin:0, lineHeight:1.3 }}>
            {block.title}
          </p>
          {block.subtitle && (
            <p style={{ fontSize:12, color:"var(--sc-dim)", margin:"4px 0 0", fontWeight:600 }}>
              {block.subtitle}
            </p>
          )}
        </div>

        {/* 정보 */}
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {isRecurring
            ? <Row label="요일" value={`${DAY_KR[block.day] ?? block.day}요일 (매주)`} />
            : <Row label="날짜" value={block.raw?.specific_date ?? ""} />
          }
          <Row label="시간" value={`${toHHMM(block.start_time)} ~ ${toHHMM(block.end_time)}`} />
          {block.notes && <Row label="메모" value={block.notes} />}
        </div>

        {/* 버튼 */}
        {block.isPersonal ? (
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:2 }}>
            {/* 닫기 + 수정 */}
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={onClose}
                style={{ flex:1, padding:"8px 0", borderRadius:8, fontSize:13, fontWeight:800, cursor:"pointer", background:"var(--sc-raised)", color:"var(--sc-dim)", border:"1px solid var(--sc-border)" }}>
                닫기
              </button>
              <button onClick={() => { onClose(); onEdit(block); }}
                style={{ flex:1, padding:"8px 0", borderRadius:8, fontSize:13, fontWeight:800, cursor:"pointer", background:"var(--sc-raised)", color:"var(--sc-white)", border:"1px solid var(--sc-border)" }}>
                수정
              </button>
            </div>
            {/* 삭제 버튼 — 고정: 임시/완전 | 임시: 삭제만 */}
            <div style={{ display:"flex", gap:8 }}>
              {isRecurring ? (
                <>
                  {delBtn(true,  "임시 삭제")}
                  {delBtn(false, "완전 삭제")}
                </>
              ) : (
                delBtn(false, "삭제")
              )}
            </div>
          </div>
        ) : (
          <div style={{ display:"flex", gap:8, marginTop:2 }}>
            <button onClick={onClose}
              style={{ flex:1, padding:"8px 0", borderRadius:8, fontSize:13, fontWeight:800, cursor:"pointer", background:"var(--sc-raised)", color:"var(--sc-dim)", border:"1px solid var(--sc-border)" }}>
              닫기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
      <span style={{ fontSize:11, fontWeight:700, color:"var(--sc-dim)", minWidth:36, flexShrink:0 }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:600, color:"var(--sc-white)", lineHeight:1.4 }}>{value}</span>
    </div>
  );
}

// ── 개인 일정 폼 데이터 타입 ──────────────────────────────────
export type PersonalFormData = {
  title:         string;
  start_time:    string;
  end_time:      string;
  color:         string;
  notes:         string;
  isRecurring:   boolean;
  days:          DayKey[];      // 고정 일정 — 복수 요일
  specific_date: string;        // 임시 일정 — 날짜 (YYYY-MM-DD)
};

// ── 개인 일정 추가/수정 모달 ───────────────────────────────────
function PersonalFormModal({ initial, onClose, onSave }: {
  initial?: ScheduleBlock | null;
  onClose: () => void;
  onSave:  (data: PersonalFormData) => Promise<void>;
}) {
  const isEdit        = !!initial;
  // 수정 시: raw.specific_date 있으면 임시, 없으면 고정 (모드 고정)
  const editIsRecurring = isEdit ? !initial!.raw?.specific_date : true;

  const [title,       setTitle]       = useState(initial?.title ?? "");
  const [isRecurring, setIsRecurring] = useState<boolean>(editIsRecurring);
  // 고정 — 복수 요일 (수정 시에는 현재 요일 1개만)
  const [days,        setDays]        = useState<DayKey[]>(
    isEdit ? [initial!.day] : ["mon"]
  );
  // 임시 — 날짜
  const [specDate,    setSpecDate]    = useState<string>(
    initial?.raw?.specific_date ?? new Date().toISOString().split("T")[0]
  );
  const [start,       setStart]       = useState(initial ? toHHMM(initial.start_time) : "09:00");
  const [end,         setEnd]         = useState(initial ? toHHMM(initial.end_time)   : "10:00");
  const [color,       setColor]       = useState(initial?.color ?? "#5badff");
  const [notes,       setNotes]       = useState(initial?.notes ?? "");
  const [saving,      setSaving]      = useState(false);

  function toggleDay(key: DayKey) {
    setDays(prev =>
      prev.includes(key) ? (prev.length > 1 ? prev.filter(d => d !== key) : prev) : [...prev, key]
    );
  }

  async function handleSave() {
    if (!title.trim()) return;
    if (isRecurring && days.length === 0) return;
    setSaving(true);
    await onSave({ title, start_time:start, end_time:end, color, notes, isRecurring, days, specific_date:specDate });
    setSaving(false);
  }

  const inp: React.CSSProperties = {
    width:"100%", borderRadius:8, padding:"8px 12px", fontSize:13, fontWeight:600,
    outline:"none", border:"1px solid var(--sc-border)",
    background:"var(--sc-raised)", color:"var(--sc-white)", boxSizing:"border-box",
  };

  const tabBtn = (active: boolean, label: string, onClick: () => void) => (
    <button onClick={onClick}
      style={{
        flex:1, padding:"7px 0", borderRadius:8, fontSize:12, fontWeight:800, cursor:"pointer",
        background: active ? "var(--sc-green)" : "var(--sc-raised)",
        color:      active ? "var(--sc-bg)"    : "var(--sc-dim)",
        border:     active ? "none"            : "1px solid var(--sc-border)",
        transition:"all 0.15s",
      }}>{label}</button>
  );

  return (
    <div style={{ position:"fixed", inset:0, zIndex:50, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.6)" }}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()}
        style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:16, padding:24, width:"100%", maxWidth:360, display:"flex", flexDirection:"column", gap:14 }}>

        <h3 style={{ fontSize:15, fontWeight:900, color:"var(--sc-white)", margin:0 }}>
          {isEdit ? "개인 일정 수정" : "개인 일정 추가"}
        </h3>

        {/* 고정/임시 탭 — 수정 시 잠금 */}
        <div style={{ display:"flex", gap:6 }}>
          {isEdit ? (
            <div style={{ flex:1, padding:"7px 0", borderRadius:8, fontSize:12, fontWeight:800, textAlign:"center",
              background:"var(--sc-raised)", color:"var(--sc-dim)", border:"1px solid var(--sc-border)" }}>
              {isRecurring ? "고정 일정" : "임시 일정"}
            </div>
          ) : (
            <>
              {tabBtn( isRecurring, "고정 일정", () => setIsRecurring(true))}
              {tabBtn(!isRecurring, "임시 일정", () => setIsRecurring(false))}
            </>
          )}
        </div>

        {/* 제목 */}
        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
          <label style={{ fontSize:11, fontWeight:700, color:"var(--sc-dim)" }}>제목</label>
          <input style={inp} value={title} onChange={e=>setTitle(e.target.value)} placeholder="예) 수학 준비, 개인 약속" />
        </div>

        {/* 요일 (고정) or 날짜 (임시) */}
        {isRecurring ? (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <label style={{ fontSize:11, fontWeight:700, color:"var(--sc-dim)" }}>
              요일{!isEdit && <span style={{ fontWeight:500, marginLeft:4 }}>(복수 선택 가능)</span>}
            </label>
            <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
              {DAYS.map(d => {
                const active = days.includes(d.key);
                const locked = isEdit; // 수정 시 요일 변경은 단일
                return (
                  <button key={d.key}
                    onClick={() => locked ? setDays([d.key]) : toggleDay(d.key)}
                    style={{
                      width:38, height:34, borderRadius:8, fontSize:12, fontWeight:800,
                      cursor:"pointer", transition:"all 0.12s",
                      background: active ? "var(--sc-green)" : "var(--sc-raised)",
                      color:      active ? "var(--sc-bg)"    : "var(--sc-dim)",
                      border:     active ? "none"            : "1px solid var(--sc-border)",
                    }}>{d.label}</button>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <label style={{ fontSize:11, fontWeight:700, color:"var(--sc-dim)" }}>날짜</label>
            <input type="date" style={inp} value={specDate} onChange={e=>setSpecDate(e.target.value)} />
          </div>
        )}

        {/* 색상 */}
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <label style={{ fontSize:11, fontWeight:700, color:"var(--sc-dim)" }}>색상</label>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {["#00e875","#5badff","#c084fc","#fb923c","#fbbf24","#f472b6"].map(c=>(
              <button key={c} onClick={()=>setColor(c)}
                style={{ width:24, height:24, borderRadius:6, background:c, cursor:"pointer",
                  border: color===c ? "2.5px solid white" : "2px solid transparent",
                  outline: color===c ? `2px solid ${c}` : "none", transition:"all 0.12s" }} />
            ))}
          </div>
        </div>

        {/* 시간 */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <label style={{ fontSize:11, fontWeight:700, color:"var(--sc-dim)" }}>시작</label>
            <input type="time" style={inp} value={start} onChange={e=>setStart(e.target.value)} />
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <label style={{ fontSize:11, fontWeight:700, color:"var(--sc-dim)" }}>종료</label>
            <input type="time" style={inp} value={end} onChange={e=>setEnd(e.target.value)} />
          </div>
        </div>

        {/* 메모 */}
        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
          <label style={{ fontSize:11, fontWeight:700, color:"var(--sc-dim)" }}>메모</label>
          <textarea style={{ ...inp, resize:"none" } as React.CSSProperties} rows={2}
            value={notes} onChange={e=>setNotes(e.target.value)} placeholder="선택 입력" />
        </div>

        {/* 버튼 */}
        <div style={{ display:"flex", gap:8, marginTop:2 }}>
          <button onClick={onClose}
            style={{ flex:1, padding:"9px 0", borderRadius:8, fontSize:13, fontWeight:800, cursor:"pointer", background:"var(--sc-raised)", color:"var(--sc-dim)", border:"1px solid var(--sc-border)" }}>
            취소
          </button>
          <button onClick={handleSave} disabled={saving || !title.trim()}
            style={{ flex:1, padding:"9px 0", borderRadius:8, fontSize:13, fontWeight:800,
              cursor: saving||!title.trim() ? "not-allowed" : "pointer",
              background:"var(--sc-green)", color:"var(--sc-bg)", border:"none",
              opacity: saving||!title.trim() ? 0.5 : 1, transition:"opacity 0.15s" }}>
            {saving ? "저장 중…" : isEdit ? "수정 저장" : `저장${!isEdit && isRecurring && days.length > 1 ? ` (${days.length}개)` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 시간표 그리드 ──────────────────────────────────────────────
function ScheduleGrid({ blocks, isDark, nowPx, todayKey, onBlockClick }: {
  blocks:       ScheduleBlock[];
  isDark:       boolean;
  nowPx:        number | null;
  todayKey:     DayKey | null;
  onBlockClick: (b: ScheduleBlock) => void;
}) {
  const TOTAL_H   = TOTAL_HOURS * FIXED_PPH;
  const gridCols  = `${TIME_COL_W}px repeat(${DAYS.length}, minmax(80px, 1fr))`;
  const gridMinW  = TIME_COL_W + DAYS.length * 80;
  const HOUR_IDXS = Array.from({ length: TOTAL_HOURS+1 }, (_, i) => i);

  return (
    <div style={{ minWidth:gridMinW }}>
      {/* 컬럼 헤더 */}
      <div style={{
        display:"grid", gridTemplateColumns:gridCols,
        position:"sticky", top:0, zIndex:10,
        background:"var(--sc-surface)",
        borderBottom:"1px solid var(--sc-border)",
        borderRadius:"12px 12px 0 0",
      }}>
        <div />
        {DAYS.map(d => (
          <div key={d.key} style={{
            padding:"10px 4px", textAlign:"center",
            fontSize:12, fontWeight:800,
            color: d.key === todayKey ? "var(--sc-green)" : "var(--sc-dim)",
            borderLeft:"1px solid var(--sc-border)",
          }}>{d.label}요일</div>
        ))}
      </div>

      {/* 그리드 본문 */}
      <div style={{
        display:"grid", gridTemplateColumns:gridCols,
        background:"var(--sc-surface)", borderRadius:"0 0 12px 12px",
        overflow:"clip", minWidth:gridMinW,
      }}>
        {/* 시간축 */}
        <div style={{ position:"relative", height:TOTAL_H, borderRight:"1px solid var(--sc-border)" }}>
          {HOUR_IDXS.map(i => (
            <div key={i} style={{
              position:"absolute", top:i*FIXED_PPH-1,
              width:"100%", paddingRight:8, textAlign:"right",
              fontSize:10, fontWeight:700, color:"var(--sc-dim)", lineHeight:1,
            }}>
              {String((BASE_HOUR+i)%24).padStart(2,"0")}:00
            </div>
          ))}
        </div>

        {/* 요일 컬럼 */}
        {DAYS.map(d => {
          const colBlocks = blocks.filter(b => b.day === d.key);
          return (
            <div key={d.key} style={{ position:"relative", height:TOTAL_H, borderLeft:"1px solid var(--sc-border)" }}>
              {HOUR_IDXS.map(i => (
                <div key={i} style={{ position:"absolute", top:i*FIXED_PPH, left:0, right:0, height:1, background:"var(--sc-border)", opacity:0.45 }} />
              ))}
              {d.key === todayKey && nowPx !== null && (
                <div style={{ position:"absolute", top:nowPx, left:0, right:0, height:1.5, background:"var(--sc-green)", opacity:0.8, zIndex:15 }} />
              )}
              {colBlocks.map(b => (
                <Block key={b.id} b={b} isDark={isDark} onClick={() => onBlockClick(b)} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function MyScheduleClient({
  userRole, userName, userId,
  classSchedules=[], enrollments=[],
  personalSchedules: initialPersonal,
  readOnly=false,
}: Props) {
  const isDark      = useDarkMode();
  const nowPx       = useNowPx();
  const isWide      = useIsWideLayout();
  const sidebarZoom = useCounterZoom(1.0);
  const headerZoom  = useCounterZoom(0.8);
  const supabase    = useMemo(() => createClient(), []);

  const todayKey = DAY_TO_KEY[new Date().getDay()];

  const [weekOffset, setWeekOffset] = useState(0);
  const [personal,   setPersonal]   = useState<any[]>(initialPersonal);
  const [detailBlock, setDetailBlock] = useState<ScheduleBlock | null>(null);
  const [editBlock,   setEditBlock]   = useState<ScheduleBlock | null>(null);
  const [showAdd,     setShowAdd]     = useState(false);

  // ── 현재 주 날짜 범위 ────────────────────────────────────
  const { weekDates } = useMemo(() => {
    const monday  = getMonday(weekOffset);
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      dates.push(d.toISOString().split("T")[0]);
    }
    return { weekDates: dates };
  }, [weekOffset]);

  // ── 블록 빌드 ─────────────────────────────────────────────
  const allBlocks = useMemo((): ScheduleBlock[] => {
    const result: ScheduleBlock[] = [];

    // 선생님: classroom_schedules (반복 일정)
    for (const s of classSchedules) {
      if (!s.day || !s.start_time || !s.end_time) continue;
      result.push({
        id: s.id, day: s.day as DayKey,
        start_time: toHHMM(s.start_time), end_time: toHHMM(s.end_time),
        title:    s.courses?.subject ?? s.courses?.name ?? "수업",
        subtitle: s.classrooms?.name,
        color:    s.courses?.accent_color ?? accentFor(s.courses?.name ?? s.id),
        isPersonal: false,
      });
    }

    // 학생: enrollments → courses → classroom_schedules
    for (const e of enrollments) {
      const course = e.courses; if (!course) continue;
      const accent = course.accent_color ?? accentFor(course.name ?? e.id);
      for (const cs of (course.classroom_schedules ?? [])) {
        if (!cs.day || !cs.start_time || !cs.end_time) continue;
        result.push({
          id: cs.id, day: cs.day as DayKey,
          start_time: toHHMM(cs.start_time), end_time: toHHMM(cs.end_time),
          title:    course.subject ?? course.name ?? "수업",
          subtitle: course.instructors?.name ? `${course.instructors.name}T` : undefined,
          color:    accent, isPersonal: false,
        });
      }
    }

    // 개인 일정 — 반복(day) + 특정 날짜(specific_date) 모두 지원
    for (const p of personal) {
      if (!p.is_active || !p.start_time || !p.end_time) continue;

      // specific_date: 해당 주에 포함될 때만 표시
      if (p.specific_date) {
        const dayIdx = weekDates.indexOf(p.specific_date);
        if (dayIdx < 0 || dayIdx > 5) continue;  // 월~토 범위 밖이면 skip
        const dayKey = DAYS[dayIdx]?.key;
        if (!dayKey) continue;
        result.push({
          id: p.id, day: dayKey,
          start_time: toHHMM(p.start_time), end_time: toHHMM(p.end_time),
          title: p.title ?? "개인 일정",
          color: p.color ?? "#888",
          notes: p.notes ?? undefined,
          isPersonal: true, raw: p,
        });
        continue;
      }

      // 반복 일정(day)
      if (!p.day) continue;
      result.push({
        id: p.id, day: p.day as DayKey,
        start_time: toHHMM(p.start_time), end_time: toHHMM(p.end_time),
        title: p.title ?? "개인 일정",
        color: p.color ?? "#888",
        notes: p.notes ?? undefined,
        isPersonal: true, raw: p,
      });
    }

    return result;
  }, [classSchedules, enrollments, personal, weekDates]);

  // ── CRUD ──────────────────────────────────────────────────
  async function handleAdd(data: PersonalFormData) {
    if (data.isRecurring) {
      // 고정 일정 — 선택된 요일 수만큼 레코드 삽입
      const rows = data.days.map(d => ({
        profile_id: userId, title: data.title,
        day: d, start_time: data.start_time, end_time: data.end_time,
        color: data.color, notes: data.notes || null, is_active: true,
      }));
      const { data: inserted, error } = await supabase
        .from("personal_schedules").insert(rows).select();
      if (!error && inserted) setPersonal(prev => [...prev, ...inserted]);
    } else {
      // 임시 일정 — specific_date
      const { data: inserted, error } = await supabase
        .from("personal_schedules")
        .insert({ profile_id:userId, title:data.title, specific_date:data.specific_date,
          start_time:data.start_time, end_time:data.end_time,
          color:data.color, notes:data.notes||null, is_active:true })
        .select().single();
      if (!error && inserted) setPersonal(prev => [...prev, inserted]);
    }
    setShowAdd(false);
  }

  async function handleUpdate(data: PersonalFormData) {
    if (!editBlock) return;
    const patch = data.isRecurring
      ? { title:data.title, day:data.days[0], start_time:data.start_time, end_time:data.end_time, color:data.color, notes:data.notes||null }
      : { title:data.title, specific_date:data.specific_date, start_time:data.start_time, end_time:data.end_time, color:data.color, notes:data.notes||null };
    const { data: updated, error } = await supabase
      .from("personal_schedules").update(patch).eq("id", editBlock.id).select().single();
    if (!error && updated) setPersonal(prev => prev.map(p => p.id === editBlock.id ? updated : p));
    setEditBlock(null);
  }

  async function handleDelete(id: string, soft: boolean) {
    if (soft) {
      // 임시 삭제 — is_active = false (DB에 보존, 화면에서만 숨김)
      const { data: updated } = await supabase
        .from("personal_schedules")
        .update({ is_active: false })
        .eq("id", id)
        .select().single();
      if (updated) setPersonal(prev => prev.map(p => p.id === id ? updated : p));
    } else {
      // 완전 삭제
      await supabase.from("personal_schedules").delete().eq("id", id);
      setPersonal(prev => prev.filter(p => p.id !== id));
    }
  }

  // ── 공통 UI 조각 ──────────────────────────────────────────
  const isTeacher = ["admin","manager","teacher"].includes(userRole);

  function NavLinks() {
    const ls: React.CSSProperties = { color:"var(--sc-dim)", opacity:0.6 };
    const on  = (e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.opacity="1");
    const off = (e: React.MouseEvent<HTMLAnchorElement>) => (e.currentTarget.style.opacity="0.6");
    return (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"nowrap", gap:6, marginBottom: isWide ? 16 : 0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"nowrap", flexShrink:0 }}>
          <Link href="/portal" style={{ ...ls, display:"flex", alignItems:"center", gap:5, fontSize:12, fontWeight:700, textDecoration:"none", transition:"opacity 0.15s" }}
            onMouseEnter={on} onMouseLeave={off}>
            <HomeIcon size={14}/> 홈
          </Link>
          <span style={{ color:"var(--sc-border)", fontSize:12 }}>·</span>
          <span style={{ ...ls, fontSize:12, fontWeight:700 }}>내 시간표</span>
        </div>
        <ThemeToggle />
      </div>
    );
  }

  const addBtn = !readOnly && (
    <button onClick={() => setShowAdd(true)}
      style={{
        display:"flex", alignItems:"center", gap:4,
        background:"var(--sc-green)", color:"var(--sc-bg)",
        border:"none", borderRadius:6, padding:"4px 10px",
        fontSize:11, fontWeight:800, cursor:"pointer", flexShrink:0,
      }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      개인 일정 추가
    </button>
  );

  const grid = (
    <ScheduleGrid
      blocks={allBlocks} isDark={isDark} nowPx={nowPx}
      todayKey={todayKey} onBlockClick={b => setDetailBlock(b)}
    />
  );

  const modals = (
    <>
      {detailBlock && (
        <DetailModal
          block={detailBlock}
          onClose={() => setDetailBlock(null)}
          onEdit={b => { setDetailBlock(null); setEditBlock(b); }}
          onDelete={handleDelete}
        />
      )}
      {(showAdd || editBlock) && (
        <PersonalFormModal
          initial={editBlock ?? null}
          onClose={() => { setShowAdd(false); setEditBlock(null); }}
          onSave={editBlock ? handleUpdate : handleAdd}
        />
      )}
    </>
  );

  // ── 가로 레이아웃 ─────────────────────────────────────────
  if (isWide) {
    return (
      <div style={{ display:"flex", height:"100vh", background:"var(--sc-bg)" }}>
        <div style={{
          width:260, flexShrink:0, position:"sticky", top:0,
          height:"100vh", overflowY:"auto",
          borderRight:"1px solid var(--sc-border)",
          background:"var(--sc-bg)", padding:"20px 18px",
          display:"flex", flexDirection:"column", gap:0,
          zoom: sidebarZoom,
        }}>
          <NavLinks />
          <p style={{ fontSize:10, fontWeight:800, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--sc-dim)", margin:"0 0 4px" }}>
            {isTeacher ? "Schedule" : "My Schedule"}
          </p>
          <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"nowrap" }}>
            <h1 style={{ fontSize:18, fontWeight:900, color:"var(--sc-white)", margin:0, whiteSpace:"nowrap" }}>내 시간표</h1>
            <span style={{ fontSize:10, fontWeight:700, color:"var(--sc-dim)", background:"var(--sc-raised)", border:"1px solid var(--sc-border)", borderRadius:5, padding:"2px 6px", whiteSpace:"nowrap", flexShrink:0 }}>
              {userName}
            </span>
          </div>

          <div style={{ marginTop:14 }}>
            <WeekNav weekOffset={weekOffset} setWeekOffset={setWeekOffset} compact />
          </div>

          {!readOnly && (
            <button onClick={() => setShowAdd(true)}
              style={{ marginTop:14, display:"flex", alignItems:"center", justifyContent:"center", gap:4, background:"var(--sc-green)", color:"var(--sc-bg)", border:"none", borderRadius:7, padding:"5px 0", fontSize:11, fontWeight:800, cursor:"pointer", width:"100%" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              개인 일정 추가
            </button>
          )}
        </div>

        <div style={{ width:780, flexShrink:0, height:"100vh", overflow:"auto" }}>
          <div style={{ padding:"12px 20px 40px" }}>{grid}</div>
        </div>

        {modals}
      </div>
    );
  }

  // ── 세로 레이아웃 ─────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:"var(--sc-bg)" }}>
      <div style={{ position:"sticky", top:0, zIndex:30, background:"var(--sc-bg)", borderBottom:"1px solid var(--sc-border)", backdropFilter:"blur(12px)" }}>
        <div style={{ zoom:headerZoom, padding:"14px 32px 10px" }}>
          <NavLinks />
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:6, flexWrap:"nowrap" }}>
            <p style={{ fontSize:10, fontWeight:800, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--sc-dim)", margin:0, whiteSpace:"nowrap" }}>
              {isTeacher ? "Schedule" : "My Schedule"}
            </p>
            <span style={{ color:"var(--sc-border)" }}>·</span>
            <h1 style={{ fontSize:20, fontWeight:900, color:"var(--sc-white)", margin:0, whiteSpace:"nowrap" }}>내 시간표</h1>
            <span style={{ fontSize:11, fontWeight:700, color:"var(--sc-dim)", background:"var(--sc-raised)", border:"1px solid var(--sc-border)", borderRadius:6, padding:"2px 8px", whiteSpace:"nowrap", flexShrink:0 }}>
              {userName} · {isTeacher ? "선생님" : "학생"}
            </span>
            <div style={{ flex:1 }} />
            {addBtn}
          </div>
          <WeekNav weekOffset={weekOffset} setWeekOffset={setWeekOffset} />
        </div>
      </div>

      <div style={{ width:820, margin:"0 auto", padding:"20px 32px" }}>
        {grid}
      </div>

      {modals}
    </div>
  );
}
