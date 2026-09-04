// 재무제표(수입·지출 장부) 공용 — 서버·클라 공용 순수 모듈. 분류는 여기 상수가 단일 출처다
// (자유 입력을 허용하면 나중에 집계·추이가 오타 하나로 깨진다 — src/lib/staff-schedule.ts 가
// STAFF_SCHEDULE_KINDS 를 두는 방식과 같은 선례). key 는 DB 저장값이라 절대 바꾸지 않는다.
//
// "도시락" 은 의도적으로 분류 목록에 없다 — lunch_order.paid 가 이미 돈이 오간 유일한 실제 기록이라
// 장부에 손으로 또 적으면 이중계상이 된다. 화면은 그 달 lunch_order 를 직접 합산해 "자동" 수입
// 항목으로 얹는다(수정·삭제 불가). 이 목록에 'lunch' 를 아예 넣지 않고 DB check 제약도 이 목록만
// 허용하므로, 수동 입력 경로 자체가 스키마 단에서 막힌다(화면 경고가 아니라 구조적 차단).
//
// "학원비"(tuition, 2026-09-02 학원비 결제 모듈 도입)도 같은 이유로 여기서 뺐다 — billing_payment.
// paid_amount 가 이제 실제 입금 기록이라 여기 또 적으면 이중계상이다. 화면은 그 달 billing_payment
// 를 직접 합산해 "자동" 수입 항목으로 얹는다(src/app/m/finance/actions.ts getMonthData 의 tuitionIncome
// 참고). DB check 제약도 bootstrap.ts 마이그레이션에서 'tuition' 을 뺐다 — 다만 그 이전에 손으로
// 적어둔 tuition 행은 과거 회계 기록이라 지우지 않고 그대로 둔다(그 제약은 NOT VALID 라 기존 행은
// 검증하지 않고 새 insert/update 만 막는다). 그런 과거 행은 화면에서 "학원비(과거 수기입력)" 로 계속
// 보이되 수정·삭제는 안 된다(isValidCategory 가 'tuition' 을 더 이상 인정하지 않으므로 자동으로
// editable=false).
import { won as wonFmt } from "./lunch";

export type FinanceDirection = "income" | "expense";

export type FinanceCategoryDef = { key: string; label: string; direction: FinanceDirection };

// 순서 = 관리 화면 선택 목록 순서 · 분류별 내역 표시 순서.
export const FINANCE_CATEGORIES: FinanceCategoryDef[] = [
  { key: "other", label: "기타", direction: "income" },
  { key: "payroll", label: "인건비", direction: "expense" },
  { key: "rent", label: "임대료", direction: "expense" },
  { key: "utility", label: "공과금", direction: "expense" },
  { key: "supplies", label: "비품", direction: "expense" },
  { key: "ingredients", label: "식자재", direction: "expense" },
  { key: "other", label: "기타", direction: "expense" },
];

export const INCOME_CATEGORIES = FINANCE_CATEGORIES.filter((c) => c.direction === "income");
export const EXPENSE_CATEGORIES = FINANCE_CATEGORIES.filter((c) => c.direction === "expense");

// "기타" 가 수입·지출 양쪽에 같은 key("other")를 쓰므로 조회는 항상 (direction,category) 쌍으로 한다.
export function categoryLabel(direction: FinanceDirection, category: string): string {
  const hit = FINANCE_CATEGORIES.find((c) => c.direction === direction && c.key === category);
  return hit?.label ?? category;
}

export function isValidCategory(direction: FinanceDirection, category: string): boolean {
  return FINANCE_CATEGORIES.some((c) => c.direction === direction && c.key === category);
}

// 인건비는 급여 축(payroll.view/manage) 권한자에게만 금액을 보인다 — 이 분류 하나만 특별 취급.
export const PAYROLL_CATEGORY = "payroll";

export const won = wonFmt;

const pad = (n: number) => String(n).padStart(2, "0");

/** year/month(1~12) → SQL date 범위 [start, nextStart) 문자열. date 컬럼은 TZ 가 없으므로
 * KST 여부를 신경 쓸 필요가 없다(달력월 그대로). */
export function monthRange(year: number, month: number): { start: string; nextStart: string } {
  const start = `${year}-${pad(month)}-01`;
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const nextStart = `${ny}-${pad(nm)}-01`;
  return { start, nextStart };
}

/** year/month 를 delta 만큼 이동(음수 가능). */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/** 지정한 달을 포함해 과거로 count개월(오래된 순). 추이 차트용. */
export function trailingMonths(year: number, month: number, count: number): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(shiftMonth(year, month, -i));
  return out;
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

export function monthLabel(year: number, month: number): string {
  return `${year}년 ${month}월`;
}

export function monthLabelShort(month: number): string {
  return `${month}월`;
}
