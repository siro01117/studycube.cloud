// 문자 문구 템플릿 — 상황 카탈로그 + 변수 치환 순수 함수.
//
// "server-only" 를 붙이지 않는다: 이 파일은 서버(큐잉 직전 렌더링)와 클라이언트(미리보기 화면에서
// "실제로 나갈 문구"를 같은 규칙으로 보여주기 위함) 양쪽에서 그대로 import 해서 쓴다 — 문구 규칙이
// 두 곳에 따로 구현되면 미리보기와 실제 발송이 갈라질 수 있어서다(집주인 지시 "서버와 미리보기
// 화면이 같은 함수를 쓴다").
//
// situation 카탈로그는 sms_message.kind(src/lib/sms.ts SMS_KINDS)의 부분집합이다 — 'test'/'manual'
// 은 사람이 직접 문구를 입력하는 경우라 템플릿이 없다. sms_template DB 체크 제약(schema.modules.ts)
// 이 이 목록과 정확히 같은 값만 허용한다 — 여기가 바뀌면 그쪽도 같이 고칠 것.
//
// 용어: 화면·문구에는 "이용기간"을 쓴다(집주인 지시 — 기존 "수강기간"에서 변경). billing_payment
// 테이블·컬럼명(period_start/period_end 등)과 daysUntil 같은 코드 식별자는 그대로 둔다(표시 문자열만
// 바꾼다는 지시).

export const SMS_SITUATIONS = [
  "access_code",
  "notice_broadcast",
  "schedule_reminder",
  "attend_in",
  "attend_out",
  "expiry_reminder",
  "expired",
] as const;
export type SmsSituation = (typeof SMS_SITUATIONS)[number];
export const isSmsSituation = (v: string): v is SmsSituation =>
  (SMS_SITUATIONS as readonly string[]).includes(v);

export type SituationMeta = {
  label: string; // 사람이 알아볼 상황 이름(관리 화면 표시용)
  auto: boolean; // true=조건이 되면 자동 큐잉(기본 꺼짐, 관리자가 켜야 동작), false=사람이 버튼을 눌러야 나감
  variables: readonly string[]; // 이 상황의 문구에서 쓸 수 있는 변수(중괄호 없이). 화면이 그대로 보여준다.
  defaultTitle: string;
  defaultBody: string;
};

// 학원 이름은 시드에서 채우지 않는다(실제 branch.name 을 렌더링 시점에 넣는다) — 아래 defaultBody 의
// {학원이름} 은 그대로 변수로 남긴다.
export const SITUATION_META: Record<SmsSituation, SituationMeta> = {
  access_code: {
    label: "링크·로그인 코드 안내",
    auto: false,
    variables: ["학생이름", "링크", "코드", "학원이름"],
    defaultTitle: "링크·로그인 코드 안내",
    defaultBody: "[{학원이름}] {학생이름} 학생 홈페이지 {링크} 에서 이름과 코드 {코드} 로 로그인해 시간표를 확인해 주세요.",
  },
  notice_broadcast: {
    label: "공지 병행 발송",
    auto: false,
    variables: ["학원이름", "제목"],
    defaultTitle: "공지 병행 발송",
    defaultBody: "[{학원이름}] 새 공지가 등록되었습니다: {제목}. 자세한 내용은 홈페이지에서 확인해 주세요.",
  },
  schedule_reminder: {
    label: "스케쥴 미제출 독촉",
    auto: false,
    variables: ["학생이름", "학원이름"],
    defaultTitle: "등하원 스케쥴 미제출 안내",
    defaultBody: "[{학원이름}] {학생이름} 학생의 등하원 스케쥴이 아직 등록되지 않았습니다. 홈페이지에서 제출 부탁드립니다.",
  },
  attend_in: {
    label: "입실 알림(자동)",
    auto: true,
    variables: ["학생이름", "학원이름"],
    defaultTitle: "입실 알림",
    defaultBody: "[{학원이름}] {학생이름} 학생이 입실했습니다.",
  },
  attend_out: {
    label: "퇴실 알림(자동)",
    auto: true,
    variables: ["학생이름", "학원이름"],
    defaultTitle: "퇴실 알림",
    defaultBody: "[{학원이름}] {학생이름} 학생이 퇴실했습니다.",
  },
  expiry_reminder: {
    label: "이용기간 만료 임박(자동)",
    auto: true,
    variables: ["학생이름", "만료일", "학원이름"],
    defaultTitle: "이용기간 만료 임박 안내",
    defaultBody: "[{학원이름}] {학생이름} 학생의 이용기간이 {만료일}에 만료됩니다. 연장 등록 부탁드립니다.",
  },
  expired: {
    label: "이용기간 만료됨(자동)",
    auto: true,
    variables: ["학생이름", "만료일", "학원이름"],
    defaultTitle: "이용기간 만료 안내",
    defaultBody: "[{학원이름}] {학생이름} 학생의 이용기간({만료일} 만료)이 종료되었습니다. 연장 등록 부탁드립니다.",
  },
};

// 학생 로그인 공개 폼(studycube.co.kr, 공개 접수 폼과 같은 도메인). 링크 변수의 값 — 환경변수로
// 뺄 만한 설정값은 아니고(도메인 자체가 서비스 소개 사이트에 고정돼 있음, src/app/f/layout.tsx 주석
// 참고) 바뀌면 코드에서 여기 한 곳만 고치면 되게 상수로 둔다.
export const STUDENT_LOGIN_URL = "https://studycube.co.kr/apply";

const VAR_RE = /\{([^{}]+)\}/g;

/** 문구 안에 쓰인 {변수} 이름들(중복 제거, 중괄호 없이). */
export function extractVariables(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(VAR_RE)) found.add(m[1]!.trim());
  return [...found];
}

/** 이 상황에서 허용하지 않는 변수가 쓰였으면 그 목록을 돌려준다(빈 배열=문제 없음).
 *  저장(templateActions.ts)이 이걸로 막는다 — 발송 뒤에 "{만료일}" 이 그대로 나가는 사고를 막기 위함. */
export function unknownVariablesIn(situation: SmsSituation, body: string): string[] {
  const allowed = new Set<string>(SITUATION_META[situation].variables);
  return extractVariables(body).filter((v) => !allowed.has(v));
}

/** {변수} 를 실제 값으로 치환. vars 에 없는 변수는 그대로 남긴다(치환 누락을 조용히 삼키지 않고
 *  눈에 띄게 하기 위함 — 화면에서 "{만료일}" 처럼 보이면 무엇이 안 채워졌는지 바로 보인다). */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(VAR_RE, (whole, rawKey: string) => {
    const key = rawKey.trim();
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : whole;
  });
}

// SMS(단문)/LMS(장문) 경계 — 알리고를 비롯한 국내 문자 발송사는 보통 90바이트(EUC-KR 기준, 한글
// 완성형 2바이트)를 넘으면 자동으로 LMS 로 취급해 단가가 오른다. 정확한 바이트 수는 발송사 인코딩에
// 따라 갈릴 수 있어(EUC-KR vs UTF-8) 이건 "넘는지 아닌지 경고"용 근사치다 — 완성형 한글·영문/숫자
// 외 문자(이모지 등, 이 앱은 어차피 이모지를 안 쓰지만)는 3바이트로 셀 수도 있어 실제보다 적게 잡힐
// 수 있음을 화면 안내문에 같이 적는다.
export const SMS_LMS_BYTE_THRESHOLD = 90;

/** 문자 바이트 수 근사 계산(ASCII=1바이트, 그 외(한글 등 완성형)=2바이트). */
export function smsByteLength(text: string): number {
  let n = 0;
  for (const ch of text) n += (ch.codePointAt(0) ?? 0) > 0x7f ? 2 : 1;
  return n;
}
