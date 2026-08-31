import type { ClosureInfo } from '../types'
import {
  isoDate as libIsoDate,
  monthGrid as libMonthGrid,
  defaultClosure as libDefaultClosure,
  effectiveClosure as libEffectiveClosure,
  type Closure,
} from '@/lib/lunch'

// 이 파일의 격자·휴무 판정은 전부 src/lib/lunch.ts 의 순수 함수에 위임한다(재구현 금지) —
// 관리 화면(여기)과 학생 신청 폼(f/[slug]/forms/lch4k9wp.tsx)이 같은 규칙을 써야 어긋나지 않는다.
// 원본 렌더러(MonthSettings/ApplicationDialog/pdfHtml/Students)는 Date 객체 기반 시그니처를
// 그대로 쓰므로, 여기서만 iso 문자열로 변환해 lunch.ts 를 호출하고 다시 Date 기반으로 감싼다.

export function isoDate(y: number, m: number, d: number): string {
  return libIsoDate(y, m, d)
}

export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate()
}

/** Returns 6-column (Mon-Sat) grid rows; Sunday column is omitted. */
export function monthGrid(y: number, m: number): (Date | null)[][] {
  return libMonthGrid(y, m).map((row) => row.map((cell) => (cell ? new Date(y, m - 1, cell.day) : null)))
}

/** Default closure for a day (no DB overrides). src/lib/lunch.ts의 defaultClosure 그대로. */
export function getDefaultClosure(d: Date, _holidayLabels: Record<string, string>): ClosureInfo | null {
  const iso = isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
  const eff = libDefaultClosure(iso, d.getDay())
  return eff ? { lunch_closed: eff.lunch_closed, dinner_closed: eff.dinner_closed, label: eff.label } : null
}

/** Merged closure: DB override takes priority over default. src/lib/lunch.ts의 effectiveClosure 그대로. */
export function effectiveClosure(
  d: Date,
  overrides: Record<string, ClosureInfo>,
  _holidayLabels: Record<string, string>
): ClosureInfo | null {
  const iso = isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
  const map = new Map<string, Closure>()
  const ov = overrides[iso]
  if (ov) map.set(iso, { date: iso, lunch_closed: ov.lunch_closed, dinner_closed: ov.dinner_closed, label: ov.label })
  const eff = libEffectiveClosure(iso, d.getDay(), map)
  return eff ? { lunch_closed: eff.lunch_closed, dinner_closed: eff.dinner_closed, label: eff.label } : null
}

export function isFullyClosed(c: ClosureInfo | null): boolean {
  return !!c && c.lunch_closed && c.dinner_closed
}
