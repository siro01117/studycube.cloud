// 계정 비밀번호 규칙 — 서버(검증)와 클라이언트(버튼 활성·안내문)가 같은 판단을 하도록 한곳에 둔다.
// 순수 모듈이라 양쪽에서 그대로 import 한다(db 를 물면 클라이언트에서 못 쓴다).
//
// 왜 4자에서 올렸나: 이 계정들은 학생 61명의 개인정보와 급여·재무 축에 닿는다. 숫자 4자리는
// 경우의 수가 만 가지뿐이라, 로그인 잠금(15분/10회)이 있어도 시간만 들이면 뚫린다.
// 그렇다고 대소문자·특수문자를 강제하면 카운터에서 매일 치는 비번이 못 외울 물건이 된다.
// 그래서 "길이"로만 요구하되 숫자만인 경우에만 더 길게 받는다 — 외우기 쉬운 단어+숫자는 8자로
// 통과하고, 순수 숫자는 12자리(1조 가지)라야 통과한다.
export const PIN_MIN = 8;
export const PIN_MIN_DIGITS_ONLY = 12;

/** 비밀번호가 규칙에 어긋나면 사람이 읽을 이유를, 괜찮으면 null 을 준다. */
export function pinProblem(pin: string): string | null {
  if (pin.length < PIN_MIN) return `비밀번호는 ${PIN_MIN}자 이상으로 정해주세요.`;
  if (/^\d+$/.test(pin) && pin.length < PIN_MIN_DIGITS_ONLY) {
    return `숫자만 쓰려면 ${PIN_MIN_DIGITS_ONLY}자 이상이어야 합니다. 글자를 섞으면 ${PIN_MIN}자로 충분합니다.`;
  }
  return null;
}

export const PIN_HINT = `${PIN_MIN}자 이상 (숫자만 쓰면 ${PIN_MIN_DIGITS_ONLY}자 이상)`;
