// 모듈 카탈로그 — 홈 Dock 카드가 될 기능 목록. 지점마다 켜고 끔(branch_module).
// mvp=true 인 것만 본점에서 처음부터 켜둠. 나머지는 앱에서 나중에 켬.
//
// category — NavRail 묶음 키. DB(module 테이블)에는 저장하지 않는다(스키마 변경 없이, 이 정적
// 카탈로그를 key 로만 조인해서 화면에서 묶는다 — layout.tsx/NavRail.tsx 참고). 세 갈래로 나눴다:
//  - "student": 그 학생에 대해 시간이 지나며 쌓이는 기록/판단 (관리·출결·벌점·성적·플래너·상담·멘토·스케쥴러)
//  - "today":   오늘 현장을 굴리는 즉시성 작업 (좌석 배치도·순찰·도시락 — "지금 뭘 하나" 축)
//  - "staff":   직원·지점 운영 (공지·직원 관리·결제·재무·활동로그 — 학생이 아니라 지점을 향한 축)
export type ModuleCategory = "student" | "today" | "staff";
export type ModuleDef = {
  key: string;
  label: string;
  requires: string[]; // 이 모듈을 보려면 필요한 권한
  ord: number;
  category: ModuleCategory;
  mvp?: boolean;
};

export const MODULE_CATEGORY_LABEL: Record<ModuleCategory, string> = {
  student: "학생",
  today: "오늘 현장",
  staff: "직원·운영",
};

// 실제 화면이 구현된 모듈의 경로. 모듈 이식할 때마다 여기 추가 → 홈 포털에서 클릭 진입.
// 여기 없는 모듈은 홈에서 '준비중'으로 뜸.
export const MODULE_ROUTES: Record<string, string> = {
  notice: "/m/notice",
  student: "/m/student",
  seat: "/m/seat",
  patrol: "/m/patrol",
  schedule: "/m/schedule",
  lunch: "/m/meal",
  staff_schedule: "/m/staff",
  payment: "/m/finance", // 화면은 다른 작업이 구현 중(src/app/m/finance/**) — 경로만 먼저 연결
  sms: "/m/sms",
};

export const MODULES: ModuleDef[] = [
  // 직원 모듈 1번째. ord=25 — 학생 관리(20) 바로 뒤, 좌석(30)보다 앞. 폰 하단 탭(NavRail, 상위 4개)에
  // 들어가려면 이 범위가 필요하다 — "읽음 확인이 핵심"인 기능이라 진입 장벽을 최소화한다(대신 순찰(45)이
  // 상위 4개에서 밀려 '더보기'로 가지만, 순찰·기록 화면은 /seat·/patrol 폰 전용 화면의 자체 메뉴로도
  // 바로 오가므로 실사용 손실은 작다).
  { key: "notice", label: "공지사항", requires: ["notice.view"], ord: 25, category: "staff", mvp: true },
  { key: "student", label: "학생 관리", requires: ["student.view"], ord: 20, category: "student", mvp: true },
  // 직원 모듈 2번째(공지 다음). 조회는 전 직원(자기 일정 확인), 편집은 staff_schedule.manage 로 갈린다 —
  // 홈 Dock 카드는 requires 를 만족하는 사람에게만 뜨므로 view 권한만 있어도 카드는 보인다.
  { key: "staff_schedule", label: "직원 관리", requires: ["staff_schedule.view"], ord: 58, category: "staff", mvp: true },
  { key: "seat", label: "좌석 배치도", requires: ["seat.view"], ord: 30, category: "today", mvp: true },
  { key: "attendance", label: "출결", requires: ["attendance.view"], ord: 40, category: "student", mvp: true },
  // "벌점" 모듈은 없앴다(집주인 지시) — 개별 부여·조회는 좌석 배치도 학생 상세의 사이드 패널로,
  // 지점 전체 집계·순위·주 이동은 순찰 기록(patrol, /m/patrol) 화면의 "벌점 현황" 탭으로 흡수됐다.
  // penalty.view/penalty.manage 권한 키 자체는 그대로 쓴다(사이드 패널·현황 탭이 여전히 이 권한으로 갈린다).
  { key: "patrol", label: "순찰 기록", requires: ["patrol.view"], ord: 45, category: "today", mvp: true },
  { key: "schedule", label: "학생 스케쥴러", requires: ["schedule.view"], ord: 60, category: "student", mvp: true },
  { key: "payment", label: "결제·재무", requires: ["billing.view"], ord: 70, category: "staff", mvp: true },
  { key: "lunch", label: "도시락", requires: ["lunch.view"], ord: 80, category: "today", mvp: true },
  { key: "grade", label: "성적 관리", requires: ["grade.view"], ord: 90, category: "student" },
  { key: "planner", label: "학습 플래너", requires: ["planner.view"], ord: 95, category: "student" },
  { key: "counsel", label: "주간 상담일지", requires: ["counsel.view"], ord: 100, category: "student" },
  { key: "mentor", label: "멘토 배정", requires: ["mentoring.view"], ord: 110, category: "student" },
  { key: "activity", label: "활동 로그", requires: ["activity.view"], ord: 120, category: "staff" },
  // 문자 발송함. requires 가 sms.view 하나뿐이라 이 카탈로그·NavRail 필터만으로 이미 CTO 전용이 된다
  // (ADMIN_PERM_KEYS 에 sms.view 가 없어 관리자 role 은 이 권한이 없다 — bootstrap.ts). mvp:true 로
  // 처음부터 켜둔다 — 화면 자체가 이미 sms.view 로 접근을 걸러서, 모듈을 꺼둘 이유가 없다(다른 mvp
  // 모듈처럼 "화면은 있는데 branch_module 로 또 꺼져 있어 못 들어간다" 혼란을 피한다).
  { key: "sms", label: "문자 발송함", requires: ["sms.view"], ord: 72, category: "staff", mvp: true },
];
