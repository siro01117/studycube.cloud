// 두벌식(2-beolsik) 한글 자모 ↔ QWERTY 매핑 — 순수 함수, DB/네트워크 접근 없음(테스트하기 쉬움).
//
// 쓰임: 로그인 아이디 입력칸은 "영문 소문자·숫자만" 규칙이다(auth.ts). 그런데 사용자가 한글 IME를
// 켜둔 채로 그 칸에 타이핑하면(실수로, 또는 습관적으로) 손가락은 영문 자판 위치를 그대로 눌렀는데
// 화면엔 한글이 조합되어 나타난다. 이 모듈은 그렇게 "조합된 한글"을 IME가 꺼져 있었다면 나왔을
// 원래의 영문 키 입력열로 되돌린다 — 한글 이름을 로마자로 "번역"하는 게 아니라, 키보드에 찍힌
// 물리적 위치를 그대로 읽어내는 것에 가깝다. 그래서 결과가 사람이 읽기 좋은 로마자 표기가 아닐 수
// 있다(예: "나한결" → "skgksruf") — 의도된 동작이다.
//
// 완성형 한글(가-힣, U+AC00~U+D7A3)만 분해 대상이고, 조합 안 된 낱자모(ㄱ,ㅏ 등)나 그 외 문자는
// normalizeLoginId 최종 단계에서 영문 소문자·숫자가 아니면 그냥 버려진다.

// 초성 19개 (유니코드 순서): ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ
const CHO = ["r", "R", "s", "e", "E", "f", "a", "q", "Q", "t", "T", "d", "w", "W", "c", "z", "x", "v", "g"];

// 중성 21개 (유니코드 순서): ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ
// 복합모음(ㅘㅙㅚㅝㅞㅟㅢ)은 두벌식에서 구성 단모음 두 키를 연달아 눌러 만든다(ㅘ=ㅗ+ㅏ 등).
const JUNG = [
  "k", "o", "i", "O", "j", "p", "u", "P", "h", "hk", "ho", "hl", "y", "n", "nj", "np", "nl", "b", "m", "ml", "l",
];

// 종성 28개 (유니코드 순서, 0번=받침 없음): ''ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ
// 겹받침(ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ)도 마찬가지로 구성 자음 두 키의 연속.
const JONG = [
  "", "r", "R", "rt", "s", "sw", "sg", "e", "f", "fr", "fa", "fq", "ft", "fx", "fv", "fg",
  "a", "q", "qt", "t", "T", "d", "w", "c", "z", "x", "v", "g",
];

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

/** 완성형 한글 한 글자(가-힣)를 두벌식 키 입력열로 되돌린다. 완성형이 아니면 그대로 반환.
 *  예: decomposeSyllable("김") === "rla" / decomposeSyllable("a") === "a" */
export function decomposeSyllable(ch: string): string {
  const code = ch.codePointAt(0);
  if (code === undefined || code < HANGUL_BASE || code > HANGUL_LAST) return ch;
  const off = code - HANGUL_BASE;
  const jong = off % 28;
  const rem1 = (off - jong) / 28; // cho*21 + jung
  const jung = rem1 % 21;
  const cho = (rem1 - jung) / 21;
  return CHO[cho] + JUNG[jung] + JONG[jong];
}

/** 로그인 아이디 정규화: 완성형 한글은 위 규칙으로 영문 키 입력열로 환원하고, 그 결과를 포함한
 *  전체 문자열에서 영문 소문자·숫자만 남긴다(대문자는 소문자로, 공백·기호·낱자모는 제거).
 *  순수 함수 — 같은 입력엔 항상 같은 출력, 이미 정규화된 문자열을 다시 넣어도 그대로(멱등).
 *
 *  기대 출력 예:
 *    normalizeLoginId("김")        === "rla"
 *    normalizeLoginId("나한결")     === "skgksruf"
 *    normalizeLoginId("irium")     === "irium"     (이미 영문 소문자 — 그대로 통과)
 *    normalizeLoginId("Ab12!")     === "ab12"       (대문자→소문자, 기호 제거)
 *    normalizeLoginId(" na Ha ")   === "naha"       (공백 제거)
 *    normalizeLoginId("skgksruf")  === "skgksruf"   (멱등 — 재정규화해도 불변)
 */
export function normalizeLoginId(input: string): string {
  let out = "";
  for (const ch of input) out += decomposeSyllable(ch);
  return out.toLowerCase().replace(/[^a-z0-9]/g, "");
}
