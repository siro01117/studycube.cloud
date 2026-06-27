// 권한·역할 상수 (순수 — 서버/클라 공용). 실제 매핑은 DB(role_permission)가 진실.
// 코드는 역할이름이 아니라 '권한 key'만 본다.

export const PERMS = {
  HQ_CROSS_BRANCH: 'hq.cross_branch',
  BRANCH_CREATE: 'branch.create',
  MODULE_ASSIGN: 'module.assign',
  BRANCH_SETTINGS: 'branch.settings',
  ACCOUNT_PROVISION: 'account.provision',
  ROLE_ASSIGN: 'role.assign',
  STUDENT_VIEW: 'student.view',
  STUDENT_EDIT: 'student.edit',
  STUDENT_ASSIGN_MENTOR: 'student.assign_mentor',
  ATTENDANCE_VIEW: 'attendance.view',
  ATTENDANCE_EDIT: 'attendance.edit',
  CLASS_MANAGE: 'class.manage',
  CONTENT_AUTHOR: 'content.author',
  MENTORING_LOG: 'mentoring.log',
  BILLING_VIEW: 'billing.view',
  BILLING_MANAGE: 'billing.manage',
  SELF_USE: 'self.use',
} as const;

export type PermKey = (typeof PERMS)[keyof typeof PERMS];

export type BranchMembership = {
  id: string;
  name: string;
  isHq: boolean;
  roles: { key: string; label: string; rank: number }[];
};

// 현재 로그인 사용자(서버에서 조립해 내려줌)
export type Me = {
  id: string;
  loginId: string;
  name: string;
  isCto: boolean;
  activeBranchId: string;
  branches: BranchMembership[];
  // 활성 지점에서 보유한 권한
  perms: string[];
};

export function can(me: Me | null, perm: string): boolean {
  if (!me) return false;
  return me.isCto || me.perms.includes(perm);
}
