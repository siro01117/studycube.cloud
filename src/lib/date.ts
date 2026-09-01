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

/** timestamptz 문자열 → en-GB KST 부품(get(type))으로 뽑는 공용 헬퍼. timeLabel/dateTimeLabel/
 * minuteOfKST 가 각자 반복하던 Intl.DateTimeFormat(...).formatToParts() + find() 패턴을 여기 하나로
 * 합친다. opts 만 다르고 나머지(로케일 en-GB, timeZone KST)는 항상 같다. */
function kstParts(at: string, opts: Intl.DateTimeFormatOptions): (type: string) => string | undefined {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: KST, ...opts }).formatToParts(new Date(at));
  return (type: string) => parts.find((p) => p.type === type)?.value;
}

/** timestamptz 문자열 → KST 기준 "HH:MM"(24시간제). 서버에서 미리 포맷해 클라로 내려주기 위함
 * (클라 렌더에서 new Date()/toLocale* 호출 금지 — 좌석 배치도의 "순찰 20:12 · 자리비움" 같은 title 용). */
export function timeLabel(at: string): string {
  const get = kstParts(at, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${get("hour") ?? "00"}:${get("minute") ?? "00"}`;
}

/** timestamptz 문자열 → KST 기준 "M월 D일 HH:MM"(제출 목록 등에서 날짜+시각을 함께 보일 때).
 *  클라 렌더에서 new Date()/toLocale* 호출 금지 원칙 — 서버에서 미리 문자열로 내려준다. */
export function dateTimeLabel(at: string): string {
  const get = kstParts(at, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${get("month") ?? ""}월 ${get("day") ?? ""}일 ${get("hour") ?? ""}:${get("minute") ?? ""}`;
}

/** timestamptz 문자열 → KST 기준 자정부터의 경과분(0..1439). schedule.ts statusAt() 에 실제 출결
 * (firstInMin/lastOutMin)을 넘기기 전 서버에서 변환하는 용도(클라 렌더에서 new Date() 호출 금지 원칙 —
 * 이 값은 반드시 서버 컴포넌트/서버 액션에서만 계산해 내려준다). */
export function minuteOfKST(at: string): number {
  const get = kstParts(at, { hour: "2-digit", minute: "2-digit", hour12: false });
  const h = Number(get("hour") ?? "0");
  const m = Number(get("minute") ?? "0");
  return h * 60 + m;
}

/** "YYYY-MM-DD" 에 일수를 더/빼기(음수 가능). 날짜 문자열만 다루므로 TZ 무관. */
export function addDays(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** 날짜 이동 UI용 짧은 라벨 — 오늘이면 "오늘", 아니면 "8월 11일". */
export function dayLabel(key: string, today: string): string {
  if (key === today) return "오늘";
  const [, m, d] = key.split("-").map(Number);
  return `${m}월 ${d}일`;
}

/** 분 단위 경과 시간 → "방금 전"/"42분 전"/"2시간 15분 전" 라벨. 순수 포맷팅(Date 미사용) — 서버가
 * (지금 - 마지막 순찰 시각)을 분으로 계산한 뒤 이 함수로 문자열화해 클라로 내려준다(순찰 화면 "감으로
 * 돌지 않게" 안내용 — 클라에서 시각 계산 금지 원칙 유지). */
export function elapsedLabel(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 1) return "방금 전";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60), rem = m % 60;
  // 하루를 넘으면 시간 단위는 읽히지 않는다("928시간 54분 전"). 일 단위로 올린다.
  if (h < 24) return rem > 0 ? `${h}시간 ${rem}분 전` : `${h}시간 전`;
  const d = Math.floor(h / 24), remH = h % 24;
  if (d < 7) return remH > 0 ? `${d}일 ${remH}시간 전` : `${d}일 전`;
  return `${d}일 전`;
}

/** 주 시작 라벨 "7월 20일 (월)" — KST 날짜 문자열 기준. */
export function weekStartLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  // 정오 UTC 로 만들어 로케일 변환 시 날짜가 밀리지 않게 한다.
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("ko-KR", {
    timeZone: KST, month: "long", day: "numeric", weekday: "short",
  });
}
