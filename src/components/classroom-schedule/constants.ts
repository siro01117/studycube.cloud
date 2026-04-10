export type ViewMode = "day" | "room" | "teacher";
export type TabMode  = "fixed" | "weekly";
export type DayKey   = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
  { key: "sun", label: "일" },
];

// 08:00 ~ 01:00 (다음날), 1시간 단위
export const TIME_SLOTS = [
  "08:00", "09:00", "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00", "16:00", "17:00",
  "18:00", "19:00", "20:00", "21:00", "22:00",
  "23:00", "00:00", "01:00",
];

// 교실 표시 순서 고정 (DB 순서 보정용)
export const CLASSROOM_ORDER = ["5-1", "5-2", "4-1", "4-2", "4-3", "Desk"];

// 셀 색상 팔레트 — 솔리드 짙은 배경 + 액센트 보더
export const CELL_COLORS = [
  { bg: "#11422a", border: "#00e875", text: "#ffffff" },  // green
  { bg: "#112244", border: "#5badff", text: "#ffffff" },  // blue
  { bg: "#271044", border: "#c084fc", text: "#ffffff" },  // purple
  { bg: "#3d1a04", border: "#fb923c", text: "#ffffff" },  // orange
  { bg: "#302600", border: "#fbbf24", text: "#ffffff" },  // amber
  { bg: "#3d0a22", border: "#f472b6", text: "#ffffff" },  // pink
  { bg: "#073030", border: "#2dd4bf", text: "#ffffff" },  // teal
  { bg: "#3d0a0a", border: "#f87171", text: "#ffffff" },  // red
];

/** 주 오프셋 → 해당 주 월요일 Date 반환 */
export function getMonday(weekOffset: number): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff + weekOffset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Date → "YYYY.MM.DD" */
export function fmt(d: Date) {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
