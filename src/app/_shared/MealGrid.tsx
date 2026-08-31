"use client";

// 도시락 격자 공용 컴포넌트 — 주차 라벨 열 + 구분(중·석) 라벨 열 + 월~토 6열. 원본 일렉트론 도시락앱
// (ApplicationDialog/MonthSettings)의 시각 문법을 그대로 계승한다: 날짜×끼니 데이터 칸에는 상태를
// 나타내는 글자를 절대 넣지 않는다 — 신청 = 점, 휴무 = 대각선 빗금, 마감 = 옅은 배경 톤(안내는 title
// 툴팁으로만, 아이콘 상시 노출 금지). "주차"/"구분"/"월~토" 는 데이터가 아니라 축 라벨이라 텍스트 허용.
//
// 학생 폼(f/[slug]/forms/lch4k9wp.tsx)과 관리자 화면(m/meal/*)이 이 컴포넌트 하나를 같이 쓴다.
// 상호작용 의미(신청 토글 vs 휴무 오버라이드 토글)는 이 컴포넌트가 모른다 — onMealClick 콜백으로
// 호출부가 결정하고, 이 컴포넌트는 레이아웃·기호 렌더링·클릭 라우팅만 담당한다.
// onMealClick 이 없으면 완전 읽기 전용(신청 현황 탭처럼).
import { monthGrid, effectiveClosure, type Closure, type EffClosure, type MealType } from "@/lib/lunch";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토"];
export type MealKey = string; // `${date}|${meal}`
export const mealKey = (date: string, meal: MealType): MealKey => `${date}|${meal}`;

export type MealGridProps = {
  year: number;
  month: number;
  closureBy: Map<string, Closure>;
  /** 신청됨(점) 표시할 키 집합. */
  appliedSet: Set<MealKey>;
  /** 마감(잠김) 키 집합 — 옅은 배경 톤만, 아이콘은 title 툴팁으로만. */
  lockedSet?: Set<MealKey>;
  /** 오늘 날짜(iso) — 오늘 열 강조. */
  today?: string;
  /** 있으면 셀이 클릭 가능해진다(없으면 완전 읽기 전용). */
  onMealClick?: (date: string, meal: MealType, closure: EffClosure | null) => void;
  /** 개별 셀 클릭 비활성 여부(기본: onMealClick 있으면 항상 클릭 가능). */
  isMealDisabled?: (date: string, meal: MealType, closure: EffClosure | null, locked: boolean) => boolean;
  /** 팝오버 등으로 특정 날짜 열을 강조. */
  activeDate?: string | null;
  hideLegend?: boolean;
  /** 범례 끝에 덧붙일 안내(예: "클릭해 휴무 편집"). */
  legendExtra?: string;
};

export default function MealGrid({
  year, month, closureBy, appliedSet, lockedSet, today, onMealClick, isMealDisabled, activeDate, hideLegend, legendExtra,
}: MealGridProps) {
  const rows = monthGrid(year, month).filter((row) => row.some(Boolean));
  const interactive = !!onMealClick;
  const cols = "34px 44px repeat(6, minmax(56px, 1fr))";

  return (
    <div>
      <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 34 + 44 + 6 * 56 }}>
            <div style={{ display: "grid", gridTemplateColumns: cols, background: "var(--panel2)", borderBottom: "1px solid var(--line)" }}>
              <HeadCell>주차</HeadCell>
              <HeadCell>구분</HeadCell>
              {DAY_LABELS.map((l) => (
                <HeadCell key={l}>{l}</HeadCell>
              ))}
            </div>
            {rows.map((row, ri) => (
              <div key={ri} style={{ display: "grid", gridTemplateColumns: cols, borderTop: ri === 0 ? "none" : "1px solid var(--line)" }}>
                <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--line)", background: "var(--panel2)" }}>
                  <RowLabelCell strong>{ri + 1}주</RowLabelCell>
                  <RowLabelCell>중</RowLabelCell>
                  <RowLabelCell>석</RowLabelCell>
                </div>
                <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--line)" }}>
                  <RowLabelCell />
                  <RowLabelCell>중식</RowLabelCell>
                  <RowLabelCell>석식</RowLabelCell>
                </div>
                {row.slice(0, 6).map((cell, ci) => {
                  if (!cell) {
                    return (
                      <div key={ci} style={{ borderRight: ci === 5 ? "none" : "1px solid var(--line)", background: "var(--panel2)" }} />
                    );
                  }
                  const closure = effectiveClosure(cell.iso, cell.dow, closureBy);
                  const isToday = cell.iso === today;
                  const isActive = cell.iso === activeDate;
                  return (
                    <div key={ci} style={{ display: "flex", flexDirection: "column", borderRight: ci === 5 ? "none" : "1px solid var(--line)" }}>
                      <DateHeadCell day={cell.day} today={isToday} active={isActive} />
                      <MealCell
                        date={cell.iso}
                        meal="lunch"
                        closure={closure}
                        applied={appliedSet.has(mealKey(cell.iso, "lunch"))}
                        locked={!!lockedSet?.has(mealKey(cell.iso, "lunch"))}
                        interactive={interactive}
                        disabled={isMealDisabled?.(cell.iso, "lunch", closure, !!lockedSet?.has(mealKey(cell.iso, "lunch"))) ?? false}
                        onClick={onMealClick}
                        borderBottom
                      />
                      <MealCell
                        date={cell.iso}
                        meal="dinner"
                        closure={closure}
                        applied={appliedSet.has(mealKey(cell.iso, "dinner"))}
                        locked={!!lockedSet?.has(mealKey(cell.iso, "dinner"))}
                        interactive={interactive}
                        disabled={isMealDisabled?.(cell.iso, "dinner", closure, !!lockedSet?.has(mealKey(cell.iso, "dinner"))) ?? false}
                        onClick={onMealClick}
                        borderBottom={false}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {!hideLegend && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, fontSize: 11, color: "var(--faint)", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <DotIcon color="var(--ink)" /> 신청
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <HatchSwatch /> 휴무
          </span>
          {legendExtra && <span>{legendExtra}</span>}
        </div>
      )}
    </div>
  );
}

// ---------------- 내부 부품 ----------------
function HeadCell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--faint)", padding: "6px 2px" }}>{children}</div>
  );
}

function RowLabelCell({ children, strong }: { children?: React.ReactNode; strong?: boolean }) {
  return (
    <div
      style={{
        flex: 1, minHeight: 24, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: strong ? 10.5 : 9.5, fontWeight: strong ? 800 : 600, color: strong ? "var(--sub)" : "var(--faint)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {children}
    </div>
  );
}

function DateHeadCell({ day, today, active }: { day: number; today: boolean; active: boolean }) {
  return (
    <div
      style={{
        textAlign: "center", fontSize: 11, fontWeight: today ? 800 : 700, padding: "3px 2px",
        color: today ? "var(--accent)" : "var(--sub)",
        background: today ? "var(--accent-soft)" : "var(--panel2)",
        outline: active ? "1.5px solid var(--accent)" : "none",
        outlineOffset: -1.5,
        borderBottom: "1px solid var(--line)",
      }}
    >
      {day}
    </div>
  );
}

function MealCell({
  date, meal, closure, applied, locked, interactive, disabled, onClick, borderBottom,
}: {
  date: string; meal: MealType; closure: EffClosure | null; applied: boolean; locked: boolean;
  interactive: boolean; disabled: boolean;
  onClick?: (date: string, meal: MealType, closure: EffClosure | null) => void;
  borderBottom: boolean;
}) {
  const closed = closure ? (meal === "lunch" ? closure.lunch_closed : closure.dinner_closed) : false;
  const label = meal === "lunch" ? "중식" : "석식";
  const title = closed
    ? `${label} 휴무${closure?.label ? ` — ${closure.label}` : ""}`
    : locked
      ? `${label} 마감${applied ? " (신청됨)" : ""}`
      : applied
        ? `${label} 신청됨`
        : `${label}`;

  const common: React.CSSProperties = {
    position: "relative", height: 34, minHeight: 34, display: "flex", alignItems: "center", justifyContent: "center",
    borderBottom: borderBottom ? "1px solid var(--line)" : "none", padding: 0, width: "100%",
  };

  let bg: string | undefined;
  if (closed) bg = "var(--panel2)";
  else if (locked) bg = "var(--panel2)";

  const content = closed ? (
    <HatchSwatch full />
  ) : applied ? (
    <DotIcon color={locked ? "var(--dim)" : "var(--ink)"} />
  ) : null;

  if (!interactive) {
    return (
      <div style={{ ...common, background: bg ?? "var(--card)" }} title={title}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="mg-cell"
      style={{ ...common, ...(bg ? { background: bg } : null) }}
      title={title}
      disabled={disabled}
      aria-pressed={applied}
      aria-label={title}
      onClick={() => onClick?.(date, meal, closure)}
    >
      {content}
    </button>
  );
}

function DotIcon({ color }: { color: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

/** 대각선 빗금 — 휴무 상태 기호. 셀 전체를 덮는 용도(full)와 범례용 작은 스와치 둘 다 지원. */
function HatchSwatch({ full }: { full?: boolean }) {
  const hatchBg = "repeating-linear-gradient(-45deg, transparent 0px, transparent 4px, var(--line) 4px, var(--line) 5.5px)";
  if (full) {
    return <div aria-hidden="true" style={{ position: "absolute", inset: 0, backgroundImage: hatchBg }} />;
  }
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-block", width: 16, height: 11, borderRadius: 2, border: "1px solid var(--line)", backgroundImage: hatchBg }}
    />
  );
}
