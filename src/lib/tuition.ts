// 학원비 결제 1건의 수강기간(시작~종료)을 계산하는 순수 함수 — 서버 액션(billing/actions.ts)과
// 결제 등록 화면(등록 전 미리보기)이 반드시 이 함수 하나만 같이 쓴다. 규칙이 두 곳에 따로 있으면
// 언젠가 어긋난다(서버는 계산 A, 화면은 계산 B — 미리보기가 실제 저장값과 다르게 뜨는 사고).
//
// 날짜는 전부 KST 기준 "YYYY-MM-DD" 문자열이다(src/lib/date.ts addDays). 이 함수는 Date.now() 를
// 쓰지 않는다 — "지금"에 의존하면 순수 함수가 아니게 되고, 서버 렌더와 클라 미리보기가 같은 순간에
// 계산하지 않으면(네트워크 왕복 사이 자정을 넘기면) 서로 다른 값을 낼 수 있다. 대신 "직전 결제
// 종료일"을 인자로 받아 그 값과 "이번 결제일"만 비교한다.
//
// 규칙(집주인 지시, 그대로):
//  - 첫 결제(그 학생의 이전 결제가 없음): 시작 = 결제일, 종료 = 시작 + 기간일수 - 1일.
//  - 이후 결제: 직전 결제 종료일이 "이번 결제일" 기준으로 아직 지나지 않았으면(종료일 >= 결제일)
//    그 다음날부터 이어 붙인다(연장). 이미 지났으면(종료일 < 결제일) 결제일부터 새로 시작한다
//    (재등록 취급 — 공백 기간을 메꿔주지 않는다, 실제로 안 다닌 기간을 다닌 걸로 만들면 안 된다).
//
// "직전 결제 종료일"의 정의: 그 학생의 기존 결제들 중 period_end 의 최댓값(등록 순서가 아니라 기간이
// 가장 늦게 끝나는 결제 기준) — 학생의 "현재 수강 만료 프런티어"를 뜻한다. 결제를 시간 순서와 다르게
// (예: 과거 결제를 뒤늦게 입력) 등록하는 경우까지 완벽히 다루지는 않는다(그런 경우는 화면에서 각
// 결제 기간을 직접 확인하고 등록해야 한다) — 실제 운영에서는 결제를 접수한 순서대로 입력하므로
// 이 정의로 충분하다.
//
// 삭제 시 처리(중요, 보고 대상): 결제를 지워도 "다른" 결제들의 기간은 재계산하지 않는다. 각 결제의
// period_start/period_end 는 등록 시점에 이 함수로 계산해 DB 에 그대로 저장한 값이고, 그 때 화면에
// 뜬 "언제부터 언제까지"를 직원이 보고 확인한 뒤 저장을 눌렀다 — 뒤 결제를 지웠다고 앞뒤 결제들의
// 기간이 자동으로 밀리면, 직원이 보지 않은 사이에 학생의 수강 종료일이 조용히 바뀌는 셈이 된다
// (예: 3번째 결제를 취소했더니 4번째 결제의 종료일이 하루 만에 바뀌어 있음 — 아무도 그 화면을 다시
// 열어보지 않으면 아무도 모른다). 대신: 결제를 잘못 등록했으면 그 결제만 지우고, 필요하면 그 뒤로
// "다시" 새 결제를 등록해 그 시점 기준으로 새로 계산한다. 이게 도시락 모듈이 이미 겪은 교훈과
// 같은 방향이다 — 스냅샷은 등록 시점에 고정하고, 나중 사건이 과거 스냅샷을 소급해서 흔들지 않는다.
import { addDays } from "./date";

export type Period = { start: string; end: string };

export function computePeriod(
  paidDate: string, // "YYYY-MM-DD" — 이번 결제일(KST)
  durationDays: number, // 상품의 기간(일). 결제 시점 스냅샷값을 넘긴다(상품이 나중에 바뀌어도 무관).
  previousPeriodEnd: string | null, // 그 학생의 기존 결제 중 가장 늦은 period_end. 없으면 null(첫 결제).
): Period {
  const start = previousPeriodEnd && previousPeriodEnd >= paidDate ? addDays(previousPeriodEnd, 1) : paidDate;
  const end = addDays(start, durationDays - 1);
  return { start, end };
}

/** periodEnd 가 asOfDate 기준으로 아직 유효한지(당일 포함, 종료일까지는 유효). */
export function isActive(periodEnd: string, asOfDate: string): boolean {
  return periodEnd >= asOfDate;
}

/** asOfDate → periodEnd 까지 남은 일수(음수 = 이미 지난 일수). 순수 날짜 문자열 산술(연도가 걸쳐도
 *  정확하도록 Date.UTC 로 하루 단위 차이를 계산 — addDays 를 반복 호출하는 것보다 빠르고, 두 함수가
 *  같은 "YYYY-MM-DD 파싱 → UTC 자정" 규약을 공유해 결과가 항상 일치한다). */
export function daysUntil(periodEnd: string, asOfDate: string): number {
  const [ey, em, ed] = periodEnd.split("-").map(Number);
  const [ay, am, ad] = asOfDate.split("-").map(Number);
  const endMs = Date.UTC(ey, em - 1, ed);
  const asOfMs = Date.UTC(ay, am - 1, ad);
  return Math.round((endMs - asOfMs) / 86_400_000);
}
