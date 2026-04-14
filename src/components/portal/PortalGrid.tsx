"use client";

import Link from "next/link";
import { useRef, useCallback } from "react";

// ── 아이콘 ────────────────────────────────────────────────────────
const ip = {
  width: 20, height: 20, viewBox: "0 0 24 24",
  fill: "none", stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const Icons = {
  Calendar:     () => <svg {...ip}><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><rect x="7" y="13" width="3" height="3" rx="0.5"/></svg>,
  Clipboard:    () => <svg {...ip}><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M5 4h-1a2 2 0 00-2 2v13a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-1"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>,
  LunchBox:     () => <svg {...ip}><rect x="3" y="9" width="18" height="11" rx="2"/><path d="M3 9a3 3 0 016 0M9 9a3 3 0 006 0M15 9a3 3 0 016 0"/><line x1="3" y1="13" x2="21" y2="13"/></svg>,
  BookOpen:     () => <svg {...ip}><path d="M2 4a2 2 0 012-2h7v18H4a2 2 0 01-2-2V4z"/><path d="M22 4a2 2 0 00-2-2h-7v18h7a2 2 0 002-2V4z"/></svg>,
  Building:     () => <svg {...ip}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/><line x1="15" y1="9" x2="15" y2="21"/></svg>,
  CheckSquare:  () => <svg {...ip}><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>,
  Tray:         () => <svg {...ip}><path d="M22 12h-6l-2 3H10l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>,
  List:         () => <svg {...ip}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/></svg>,
  UserPlus:     () => <svg {...ip}><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>,
  UserCalendar: () => <svg {...ip}><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><rect x="15" y="13" width="7" height="7" rx="1.5"/><line x1="15" y1="16" x2="22" y2="16"/><line x1="18" y1="13" x2="18" y2="11"/></svg>,
  UserClipboard:() => <svg {...ip}><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><rect x="14" y="11" width="8" height="9" rx="1.5"/><line x1="16" y1="15" x2="20" y2="15"/><line x1="16" y1="18" x2="19" y2="18"/></svg>,
  Settings:     () => <svg {...ip}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
};

// ── 카테고리 / 모듈 정의 ──────────────────────────────────────────
export interface Module   { key: string; name: string; sub: string; Icon: () => JSX.Element; href: string; }
export interface Category { id: string; label: string; en: string; modules: Module[]; }

export const ALL_CATEGORIES: Category[] = [
  {
    id: "admin", label: "관리자", en: "Admin",
    modules: [
      { key: "users",            name: "유저 관리",   sub: "User Settings",    Icon: Icons.Settings,     href: "/admin/users"            },
      { key: "full-schedule",    name: "전체 시간표", sub: "Full Schedule",    Icon: Icons.UserCalendar, href: "/admin/full-schedule"    },
    ],
  },
  {
    id: "manager", label: "운영 관리", en: "Management",
    modules: [
      { key: "classroom-schedule", name: "교실 시간표", sub: "Classroom Schedule", Icon: Icons.Building,    href: "/manage/classroom-schedule" },
      { key: "attendance",         name: "출결 관리",   sub: "Attendance",         Icon: Icons.CheckSquare, href: "/manage/attendance"          },
      { key: "lunch",              name: "도시락 관리", sub: "Lunch Management",   Icon: Icons.Tray,        href: "/manage/lunch"               },
      { key: "courses",            name: "수업 관리",   sub: "Course Management",  Icon: Icons.List,        href: "/manage/courses"             },
    ],
  },
  {
    id: "student-manage", label: "학생 관리", en: "Student Management",
    modules: [
      { key: "students-register",    name: "학생 등록",   sub: "Register Student",    Icon: Icons.UserPlus,      href: "/manage/students/register"    },
      { key: "students-schedule",    name: "학생 시간표", sub: "Student Schedule",    Icon: Icons.UserCalendar,  href: "/schedule/students"           },
      { key: "students-assignments", name: "학생 과제",   sub: "Student Assignments", Icon: Icons.UserClipboard, href: "/manage/students/assignments" },
    ],
  },
  {
    id: "schedule", label: "일정 관리", en: "Schedule",
    modules: [
      { key: "my-schedule",  name: "내 시간표", sub: "My Schedule", Icon: Icons.Calendar,  href: "/schedule/me"        },
      { key: "assignments",  name: "내 과제표", sub: "Assignments",  Icon: Icons.Clipboard, href: "/student/assignments"},
    ],
  },
  {
    id: "apply", label: "신청", en: "Apply",
    modules: [
      { key: "student-lunch",  name: "도시락 신청", sub: "Lunch Order",  Icon: Icons.LunchBox, href: "/student/lunch"  },
      { key: "student-enroll", name: "수강 신청",   sub: "Enrollment",   Icon: Icons.BookOpen, href: "/student/enroll" },
    ],
  },
];

// ── props 타입 ────────────────────────────────────────────────────
export interface PortalGridProps {
  /** { categoryId: moduleKey[] } */
  permissions:    Record<string, string[]>;
  /** 카테고리 표시 순서 */
  category_order: string[];
}

// ── 카드 컴포넌트 ─────────────────────────────────────────────────
function ModuleCard({ mod, delay }: { mod: Module; delay: string }) {
  const cardRef = useRef<HTMLAnchorElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  }, []);

  const handleMouseLeave = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty("--mx", "50%");
    el.style.setProperty("--my", "50%");
  }, []);

  return (
    <Link
      ref={cardRef}
      href={mod.href}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`module-card rounded-2xl p-5 flex flex-col gap-5 animate-fade-up opacity-0 ${delay} group`}
      style={{ animationFillMode: "forwards" }}
    >
      <div className="flex items-start justify-between">
        <div style={{ color: "var(--sc-dim)", transition: "color 0.3s" }}
             className="group-hover:!text-[color:var(--sc-green)]">
          <mod.Icon />
        </div>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          className="opacity-0 group-hover:opacity-100 transition-all duration-300 -translate-x-1 group-hover:translate-x-0"
          style={{ color: "var(--sc-green)" }}>
          <path d="M2 10L10 2M10 2H4M10 2v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <div>
        <p className="font-bold text-[13px] leading-snug" style={{ color: "var(--sc-white)" }}>{mod.name}</p>
        <p className="text-[11px] mt-0.5 font-medium tracking-wide" style={{ color: "var(--sc-dim)" }}>{mod.sub}</p>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[1.5px] scale-x-0 origin-left group-hover:scale-x-100 rounded-full"
           style={{ background: "var(--sc-green)", transition: "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)" }} />
    </Link>
  );
}

const DELAYS = ["delay-50","delay-100","delay-150","delay-200","delay-250","delay-300","delay-350","delay-400"];

export default function PortalGrid({ permissions, category_order }: PortalGridProps) {
  // category_order 에 따라 카테고리 필터링 + 모듈 권한 적용
  const categories = category_order
    .map((id) => ALL_CATEGORIES.find((c) => c.id === id))
    .filter(Boolean) as Category[];

  // 해당 카테고리가 없거나 비어 있으면 permissions 기준으로 fallback
  const effectiveCats = categories.length > 0
    ? categories
    : ALL_CATEGORIES.filter((c) => (permissions[c.id]?.length ?? 0) > 0);

  let delayIdx = 0;

  return (
    <div className="space-y-10">
      {effectiveCats.map((cat) => {
        const allowedKeys = permissions[cat.id];
        // 권한 있는 모듈만 필터
        const visibleModules = allowedKeys
          ? cat.modules.filter((m) => allowedKeys.includes(m.key))
          : cat.modules;
        if (visibleModules.length === 0) return null;

        return (
          <section key={cat.id}>
            <div className="section-label mb-4 animate-fade-in" style={{ animationFillMode: "forwards" }}>
              {cat.label}
              <span style={{ color:"var(--sc-dim)", fontWeight:400, textTransform:"none", letterSpacing:0, fontSize:11 }}>
                {cat.en}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {visibleModules.map((mod) => {
                const delay = DELAYS[delayIdx % DELAYS.length];
                delayIdx++;
                return <ModuleCard key={mod.href} mod={mod} delay={delay} />;
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
