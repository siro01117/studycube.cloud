// 공개 폼(/f/<슬러그>) 등록부. 빌더 없음 — 화면은 설문마다 직접 짠다(3-6 forms/ 참고).
// 여기 없는 슬러그는 404. 새 설문 추가 = 이 배열에 항목 추가 + forms/index.ts 매핑 추가.

export type FormDef = {
  slug: string;              // 추측 불가 문자열(영숫자 6~10자) — 경로에 그대로 노출
  type: string;               // submission.type — lunch | schedule | counsel | content | survey | hub 등
  title: string;               // 학생에게 보이는 제목
  intro?: string;              // 짧은 안내
  requiresStudent: boolean;    // 이름+코드 본인확인 필요 여부
  open: boolean;                // false 면 마감 안내만 표시("hub" 항목은 이 값을 쓰지 않음)
  multiple?: boolean;           // true = 제출마다 새 행 적재, false/미지정 = 같은 학생 재제출 시 기존 행 갱신(기본)
  hub?: boolean;                // 허브(선택 화면) 목록에 카드로 노출할지. 기본 false(=허브 안 보임, 주소를 아는 사람만 접근)
  desc?: string;                // 허브 카드 한 줄 설명
  order?: number;               // 허브 카드 정렬(오름차순, 미지정은 뒤로. 섹션 안에서만 정렬됨)
  section?: "info";             // 허브에서 묶일 섹션. 미지정("apply" 취급) = 신청 항목, "info" = "내 정보"(조회 전용) 항목 — Hub.tsx 가 이 값으로 시각적으로 구분해서 그린다.
};

export const FORMS: FormDef[] = [
  {
    // 허브(설문 선택 화면). 주소는 추측 불가 — /f/<slug> 로만 진입, /f 단독 접근은 404.
    slug: "hb3n7qxr",
    type: "hub",
    title: "바로가기", // 탭 제목용(def.title). Hub 화면 자체 제목은 Hub.tsx 에서 직접 쓴다.
    requiresStudent: false,
    open: true,
  },
  {
    slug: "lch4k9wp",
    type: "lunch",
    title: "도시락 신청",
    desc: "한 달 치 식사를 신청합니다",
    requiresStudent: true,
    open: false, // 폼 화면 아직 없음 — 만들어지면 true 로만 바꾸면 열림
    hub: true,
    order: 1,
  },
  {
    slug: "sch9m2vt",
    type: "schedule",
    title: "스케쥴 입력",
    desc: "등·하원 시간과 학원 일정을 알려주세요",
    requiresStudent: true,
    open: true,
    hub: true,
    order: 2,
  },
  {
    slug: "svq82fk1",
    type: "survey",
    title: "이용 만족도 설문",
    intro: "2~3분이면 끝나요. 솔직한 의견 부탁드립니다.",
    requiresStudent: true,
    open: true,
    hub: false, // 허브에 안 보임 — 주소를 아는 사람만 접근
  },
  {
    // 일회성 일정 변경 신청 — 정기 입력 기간(schedule_window/schedule_grant)과 무관하게 언제나 신청
    // 가능(수정이 아니라 신청). 저장은 submission 이 아니라 schedule_request 에 직접(전용 액션 파일
    // f/[slug]/forms/schedule-request-actions.ts) — f/actions.ts 의 submitForm 을 거치지 않는다.
    slug: "exr8k3mq",
    type: "schedule_change",
    title: "일정 변경 신청",
    desc: "하루짜리 일정 변경을 신청해요",
    requiresStudent: true,
    open: true,
    hub: true,
    order: 3,
  },
  {
    // 내 정보 조회(읽기 전용) 3종 — 이름+코드 확인이 곧 학생 로그인이라는 점을 살려, 신청/설문과
    // 별개로 "내 데이터 보기" 메뉴를 둔다. 전부 서버에서 이름+코드를 재검증해 studentId 를 확정하고
    // (클라가 보낸 값 불신), 쓰기 동작은 전혀 없다(f/actions.ts submitForm 을 거치지 않음).
    slug: "myts7fq2",
    type: "my_schedule",
    title: "내 시간표",
    desc: "등·하원 시간과 정기 일정을 확인해요",
    requiresStudent: true,
    open: true,
    hub: true,
    section: "info",
    order: 1,
  },
  {
    slug: "myat4wkd",
    type: "my_attendance",
    title: "내 출결",
    desc: "최근 30일 등·하원 기록을 확인해요",
    requiresStudent: true,
    open: true,
    hub: true,
    section: "info",
    order: 2,
  },
  {
    slug: "mypt9rxb",
    type: "my_penalty",
    title: "내 벌점",
    desc: "이번 주 벌점과 최근 위반 내역을 확인해요",
    requiresStudent: true,
    open: true,
    hub: true,
    section: "info",
    order: 3,
  },
];

/** 허브 목록에 노출할 항목만, order 오름차순(미지정은 뒤). */
export function getHubItems(): FormDef[] {
  return FORMS.filter((f) => f.hub).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
}

export function getForm(slug: string): FormDef | null {
  return FORMS.find((f) => f.slug === slug) ?? null;
}

/** type 으로 슬러그를 역조회(예: "schedule" → "sch9m2vt"). 관리 화면(m/schedule) 처럼 특정 폼 타입을
 *  다뤄야 하는데 슬러그를 하드코딩하고 싶지 않을 때 쓴다. 같은 type 을 쓰는 폼이 여럿이면 첫 번째. */
export function getFormSlugByType(type: string): string | null {
  return FORMS.find((f) => f.type === type)?.slug ?? null;
}

/** 허브(설문 선택 화면) 슬러그. 폼에서 "신원 없음 → 허브로" 리다이렉트할 때 이 함수로 얻어서
 *  쓴다 — 슬러그를 폼 코드에 직접 하드코딩하지 말 것(허브 슬러그가 바뀌어도 여기만 고치면 됨). */
export function getHubSlug(): string {
  return FORMS.find((f) => f.type === "hub")?.slug ?? "";
}
