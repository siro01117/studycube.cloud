// 날짜 키(YYYY-MM-DD)는 항상 한국시간(KST) 기준으로 계산한다.
// 서버는 Vercel에서 UTC로 도는데, 그냥 new Date().getDate() 를 쓰면
// KST 자정~오전 9시 사이엔 UTC가 아직 '어제'라 하루가 어긋난다
// (출결·순찰·벌점이 잘못된 날짜에 기록되고, 요일 탭도 밀린다).
// Intl 로 KST 날짜 부품을 직접 뽑으면 서버 TZ와 무관하게 정확하다.

const KST = "Asia/Seoul";

/** KST 기준 오늘 "YYYY-MM-DD" (en-CA 로케일이 이 포맷을 준다) */
export function todayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KST }).format(now);
}

/** "YYYY-MM-DD" 문자열의 요일 (0=일 … 6=토). 날짜만 다루므로 TZ 무관. */
export function weekdayOf(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** KST 기준 이번 주 월요일 "YYYY-MM-DD" — 벌점은 매주 월요일 리셋. */
export function weekStartKey(now: Date = new Date()): string {
  const today = todayKey(now);
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();            // 0=일 … 6=토
  const diff = day === 0 ? 6 : day - 1;  // 월요일까지 되돌릴 일수
  dt.setUTCDate(dt.getUTCDate() - diff);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** weekStart(월) 기준 이번 주 7일. wd = 요일 라벨, dayNum = 날짜. */
const WD = ["일", "월", "화", "수", "목", "금", "토"];
export function weekDays(weekStart: string): { key: string; wd: string; dayNum: number }[] {
  const [y, m, d] = weekStart.split("-").map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    return {
      key: `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`,
      wd: WD[dt.getUTCDay()],
      dayNum: dt.getUTCDate(),
    };
  });
}

/** 주 시작 라벨 "7월 20일 (월)" — KST 날짜 문자열 기준. */
export function weekStartLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  // 정오 UTC 로 만들어 로케일 변환 시 날짜가 밀리지 않게 한다.
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("ko-KR", {
    timeZone: KST, month: "long", day: "numeric", weekday: "short",
  });
}
