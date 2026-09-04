// 권한(capability) 카탈로그 — 고정 키 목록. 어떤 역할이 뭘 갖는지는 앱에서 데이터로 정함.
export type Perm = { key: string; label: string; category: string };

export const PERMISSIONS: Perm[] = [
  // 계정·조직
  { key: "hq.cross_branch", label: "전 지점 열람", category: "계정·조직" },
  { key: "branch.create", label: "지점 생성", category: "계정·조직" },
  { key: "module.assign", label: "모듈 할당", category: "계정·조직" },
  { key: "branch.settings", label: "지점 설정·통계", category: "계정·조직" },
  { key: "account.provision", label: "계정 발급", category: "계정·조직" },
  // 관리자(원내 공통)는 계정 생성·삭제를 "신청"만 할 수 있고 승인(account.provision)은 CTO 전용
  // — account_request 테이블 + account-request.ts 참고. CTO 는 두 권한 다 is_cto bypass 로 자동 보유.
  { key: "account.request", label: "계정 생성·삭제 신청", category: "계정·조직" },
  { key: "role.assign", label: "역할 부여", category: "계정·조직" },
  // 학생·운영
  { key: "student.view", label: "학생 조회", category: "학생·운영" },
  { key: "student.edit", label: "학생 수정", category: "학생·운영" },
  { key: "student.assign_mentor", label: "멘토 배정", category: "학생·운영" },
  { key: "seat.view", label: "좌석 조회", category: "학생·운영" },
  { key: "seat.manage", label: "좌석 관리", category: "학생·운영" },
  { key: "attendance.view", label: "출결 조회", category: "학생·운영" },
  { key: "attendance.edit", label: "출결 관리", category: "학생·운영" },
  // 생활
  { key: "penalty.view", label: "벌점 조회", category: "생활" },
  { key: "penalty.manage", label: "벌점 관리", category: "생활" },
  { key: "patrol.view", label: "순찰 조회", category: "생활" },
  { key: "patrol.manage", label: "순찰 관리", category: "생활" },
  // 공지 (직원 모듈 1번째)
  { key: "notice.view", label: "공지 조회", category: "공지" },
  { key: "notice.manage", label: "공지 관리", category: "공지" },
  // 직원 근무·수업 일정 (직원 모듈 2번째)
  { key: "staff_schedule.view", label: "직원 일정 조회", category: "직원 일정" },
  { key: "staff_schedule.manage", label: "직원 일정 관리", category: "직원 일정" },
  // 직원 근태(QR 출퇴근, 직원 모듈 3번째). 본인 기록 열람은 이 권한과 무관하게 항상 허용(로그인만
  // 하면 자기 기록은 볼 수 있다) — 여기 view 는 "전 직원 근태 목록"을 보는 관리자용 권한이다.
  // manage 는 QR 키오스크 화면을 띄우는 것과 손으로 정정하는 것 둘 다를 아우른다(staff_schedule과
  // 같은 축: 관리자는 조회만, 편집은 CTO 전용 기본값).
  { key: "staff_attendance.view", label: "근태 조회(전체)", category: "직원 근태" },
  { key: "staff_attendance.manage", label: "근태 관리(QR·정정)", category: "직원 근태" },
  // 결제
  { key: "billing.view", label: "결제 조회", category: "결제" },
  { key: "billing.manage", label: "결제 관리", category: "결제" },
  // 급여 (시급·단가 등 직원 재무 — 화면은 다음 단계, 권한 키만 먼저 만든다). 관리자는 완전 차단,
  // CTO만 is_cto bypass 로 접근. billing.*(학생 결제)과는 별개 축이라 키를 분리했다.
  { key: "payroll.view", label: "급여 조회", category: "급여" },
  { key: "payroll.manage", label: "급여 관리", category: "급여" },
  // 문자 발송(알리고). 건당 실비가 나가고 학부모에게 직접 닿는다 — billing.*/payroll.* 와 같은 축으로
  // 관리자는 완전 차단하고 CTO만 접근한다(bootstrap.ts ADMIN_PERM_KEYS 에서 의도적으로 뺐다). 아직
  // 실제 발송 지점이 없어(이번 작업은 큐·발송기 기반만) 지금은 발송함 조회·큐 적재·재시도에만 쓰인다.
  { key: "sms.view", label: "문자 발송함 조회", category: "문자" },
  { key: "sms.manage", label: "문자 발송 관리(큐 적재·재시도)", category: "문자" },
  // 입구 태블릿(출입 키패드) 기기 발급·재발급. 발급되는 토큰이 곧 "누구나 코드를 눌러 출결을 조작할
  // 수 있는" 물리적 접근점을 여는 열쇠라 sms.*와 같은 축으로 CTO 전용(ADMIN_PERM_KEYS 의도적 제외).
  { key: "entrance.manage", label: "입구 기기 발급·관리", category: "입구 기기" },
  // 일정·부가
  { key: "schedule.view", label: "스케쥴 조회", category: "일정·부가" },
  { key: "schedule.manage", label: "스케쥴 관리", category: "일정·부가" },
  { key: "lunch.view", label: "도시락 조회", category: "일정·부가" },
  { key: "lunch.manage", label: "도시락 관리", category: "일정·부가" },
  { key: "activity.view", label: "활동로그 조회", category: "일정·부가" },
  { key: "activity.view.all", label: "전체 활동로그", category: "일정·부가" },
  // 상담·멘토·학습
  { key: "counsel.view", label: "상담 조회", category: "상담·학습" },
  { key: "mentoring.view", label: "멘토링 조회", category: "상담·학습" },
  { key: "mentoring.manage", label: "멘토링 관리", category: "상담·학습" },
  { key: "mentoring.log", label: "멘토링 기록", category: "상담·학습" },
  { key: "grade.view", label: "성적 조회", category: "상담·학습" },
  { key: "grade.manage", label: "성적 관리", category: "상담·학습" },
  { key: "planner.view", label: "플래너 조회", category: "상담·학습" },
  { key: "planner.manage", label: "플래너 관리", category: "상담·학습" },
  // 수업
  { key: "class.manage", label: "수업 관리", category: "수업" },
  { key: "content.author", label: "콘텐츠 작성", category: "수업" },
  // 본인
  { key: "self.use", label: "본인 이용", category: "본인" },
];
