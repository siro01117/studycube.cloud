import { redirect } from "next/navigation";
import { getMe, can } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { weekStartKey, addDays, weekStartLabel, todayKey, timeLabel, isValidDateKey } from "@/lib/date";
import Link from "next/link";
import PageHeader from "../_shared/PageHeader";
import StaffHub, { type HubItem } from "./StaffHub";
import RosterView, { type RosterPerson } from "./RosterView";
import StaffScheduleView, { type StaffRow, type SpaceRow, type ScheduleRow } from "./StaffScheduleView";
import AttendanceView, { type PersonSummary, type AttEvent } from "./AttendanceView";
import { listAssignableRoles, listRosterInvites, listPendingRequests } from "./rosterActions";
import { judgeDay, minOf } from "@/lib/staff-attendance";
import { clockLabel } from "@/lib/staff-schedule";

export const runtime = "nodejs";

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
// 진입 화면 폭 — 720(옛 2열 균등 카드) → 900(벤또). StaffHub.tsx 는 "use client" 라 여기(서버
// 컴포넌트)에서 그 값을 곧바로 import 할 수 없어(클라 모듈의 비-컴포넌트 export 는 서버에서 참조
// 불가) 리터럴을 양쪽에 따로 든다 — 근거는 StaffHub.tsx 하단 주석 참고, 값을 바꿀 땐 두 곳 다.
const HUB_WIDTH = 900;

export default async function StaffSchedulePage({ searchParams }: { searchParams: Promise<{ week?: string; section?: string; date?: string }> }) {
  const me = await getMe();
  if (!me) redirect("/login");
  await ready();
  const canManage = can(me, "staff_schedule.manage");
  const canProvision = can(me, "account.provision");
  const canRequest = can(me, "account.request");
  const canAct = canProvision || canRequest;
  const canPayroll = can(me, "payroll.view");
  const canViewAttendance = can(me, "staff_attendance.view");
  const canManageAttendance = can(me, "staff_attendance.manage");
  const branch = me.activeBranchId;

  const sp = await searchParams;
  const section = sp.section === "roster" || sp.section === "schedule" || sp.section === "attendance" ? sp.section : "hub";
  // 화면마다 자기 권한으로 열려야 한다(집주인 지시) — 예전엔 전체를 staff_schedule.view 하나로
  // 걸어서 staff_attendance.view 만 가진 사람이 근태 화면도 못 보고 /home 으로 튕겼다. hub·근태는
  // "본인 것만"은 누구나 볼 수 있어야 하므로(위 attendance 카드 desc 주석 참고) 권한 게이트를 안
  // 건다 — attendance 섹션 안에서 canViewAttendance 로 전체/본인만 다시 갈린다. roster·schedule 은
  // 각자 필요한 권한이 없으면 hub 로 돌려보낸다(엉뚱한 권한으로 잠그지 않되, 없는 권한으로 상세
  // 화면까지 들어가진 못하게).
  if (section === "roster" && !canAct) redirect("/m/staff");
  if (section === "schedule" && !can(me, "staff_schedule.view")) redirect("/m/staff");

  // ── 진입 화면(hub) — 무엇을 할지 고르는 자리. 여기서 쓸 만큼만 가볍게 조회한다(대기 신청 배지는
  // 권한 있는 사람에게만 의미가 있다). 근태·급여는 아직 화면이 없다 — src/lib/modules.ts 의 관례대로
  // "자리는 보이되 준비중"으로 표시한다(급여는 payroll.view 없는 사람에겐 아예 안 보인다 — 그 권한은
  // 관리자를 완전 차단하도록 설계돼 있어, 카드 자리조차 노출하지 않는 게 그 취지에 맞다).
  if (section === "hub") {
    const pendingRequests = canAct ? await listPendingRequests() : [];
    const candidates: (HubItem | false)[] = [
      canAct && {
        key: "roster", label: "근무자", href: "/m/staff?section=roster", icon: "list",
        desc: "직원 정보를 확인·수정하고 계정을 발급·신청합니다.",
        badge: pendingRequests.length,
      },
      {
        key: "schedule", label: "근무표", href: "/m/staff?section=schedule", icon: "calendar",
        desc: canManage ? "주간 근무·수업표를 확인하고 편집합니다." : "이번 주 근무·수업표를 확인합니다.",
      },
      {
        key: "attendance", label: "출근부", href: "/m/staff?section=attendance", icon: "clock",
        // 본인은 항상 자기 근태를 볼 수 있으므로 이 카드는 언제나 연결(href not null) — 조회 권한이
        // 없어도 "준비중"으로 감춰서는 안 된다(집주인 지시: 자기 기록은 항상 볼 수 있어야 한다).
        desc: canManageAttendance ? "QR 로 출근·퇴근을 기록하고 출근부를 관리합니다." : canViewAttendance ? "전 직원 출근부를 확인합니다." : "내 출근·퇴근 기록을 확인합니다.",
      },
      canPayroll && { key: "payroll", label: "급여", href: null, icon: "coin", desc: "시급을 계산하고 급여를 정산합니다." },
    ];
    const items = candidates.filter((v): v is HubItem => v !== false);

    return (
      <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <PageHeader backHref="/home" backLabel="대시보드" title="직원 관리" maxWidth={HUB_WIDTH} flexNone />
        <StaffHub items={items} />
      </main>
    );
  }

  if (section === "roster") {
    const [rosterRows, roles, invites, pendingRequests] = await Promise.all([
      db.query<{
        id: string; name: string; phone: string | null; title: string | null;
        hired_at: string | null; left_at: string | null; active: boolean;
        role_label: string | null; role_id: string | null;
      }>(
        `select p.id, p.name, p.phone, p.title, p.hired_at::text as hired_at, p.left_at::text as left_at, p.active,
                (select r.label from person_role pr join role r on r.id=pr.role_id
                  where pr.person_id=p.id and pr.branch_id=$1 order by pr.created_at limit 1) as role_label,
                (select pr.role_id from person_role pr
                  where pr.person_id=p.id and pr.branch_id=$1 order by pr.created_at limit 1) as role_id
           from person p
          where p.is_cto = true
             or exists (select 1 from person_role pr2 where pr2.person_id=p.id and pr2.branch_id=$1)
             -- 역할 없이(선택 안 함) 초대를 수락한 사람은 person_role 이 없어 위 조건에 안 걸린다 —
             -- person 은 지점 컬럼이 없고 person_role 로만 지점 소속이 정해지는 구조라, 이 지점 초대로
             -- 들어온 사람인지는 staff_invite.used_by_person_id 로 대신 판별한다(그래야 명단에서 안 사라진다).
             or exists (select 1 from staff_invite si where si.used_by_person_id=p.id and si.branch_id=$1)
          order by p.name`,
        [branch],
      ),
      canAct ? listAssignableRoles() : Promise.resolve([]),
      canAct ? listRosterInvites() : Promise.resolve([]),
      canAct ? listPendingRequests() : Promise.resolve([]),
    ]);
    const persons: RosterPerson[] = rosterRows.rows.map((r) => ({
      id: r.id, name: r.name, phone: r.phone, title: r.title, hiredAt: r.hired_at, leftAt: r.left_at,
      active: r.active, roleLabel: r.role_label, roleId: r.role_id,
    }));

    return (
      <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <PageHeader backHref="/m/staff" backLabel="직원 관리" title="근무자" flexNone />
        <RosterView
          persons={persons} invites={invites} pendingRequests={pendingRequests} roles={roles}
          canProvision={canProvision} canRequest={canRequest}
        />
      </main>
    );
  }

  if (section === "attendance") {
    const today = todayKey();
    const requestedDate = sp.date && isValidDateKey(sp.date) ? sp.date : today;
    const date = requestedDate > today ? today : requestedDate; // 미래 날짜는 오늘로 클램프(근무표 주 이동과 같은 규칙)
    const prevDate = addDays(date, -1);
    const nextDate = addDays(date, 1);

    const [staffRows, schedRows, attRows] = await Promise.all([
      db.query<{ id: string; name: string }>(
        `select id, name from person
          where active = true
            and (is_cto = true or id in (select person_id from person_role where branch_id=$1))
          order by name`,
        [branch],
      ),
      db.query<{ person_id: string; start_min: number; end_min: number }>(
        `select person_id, start_min, end_min from staff_schedule where branch_id=$1 and date=$2`,
        [branch, date],
      ),
      db.query<{
        id: string; person_id: string; kind: string; at: string; source: string;
        note: string | null; corrected_by_name: string | null;
      }>(
        // sa.ip 는 화면 어디에도 안 쓴다(IP 는 "나중에 제한 근거로만" 남기는 기록용 — src/lib/staff-attendance.ts
        // clientIp 주석) — 클라이언트 컴포넌트로 안 쓰는 개인 접속 정보를 흘려보내지 않는다.
        `select sa.id, sa.person_id, sa.kind, sa.at::text as at, sa.source, sa.note, cb.name as corrected_by_name
           from staff_attendance sa
           left join person cb on cb.id = sa.corrected_by
          where sa.branch_id=$1 and sa.date=$2
          order by sa.at`,
        [branch, date],
      ),
    ]);

    const peopleAll = staffRows.rows;
    const people = canViewAttendance ? peopleAll : peopleAll.filter((p) => p.id === me.id);
    const scheduleByPerson = new Map<string, number[]>(); // personId -> [start_min, end_min, ...] (여러 건이면 이후 min/max)
    for (const r of schedRows.rows) {
      const arr = scheduleByPerson.get(r.person_id) ?? [];
      arr.push(r.start_min, r.end_min);
      scheduleByPerson.set(r.person_id, arr);
    }
    const eventsByPerson = new Map<string, typeof attRows.rows>();
    for (const r of attRows.rows) {
      const arr = eventsByPerson.get(r.person_id) ?? [];
      arr.push(r);
      eventsByPerson.set(r.person_id, arr);
    }

    const nowMin = minOf(new Date().toISOString());
    const summaries: PersonSummary[] = people.map((p) => {
      const evRows = eventsByPerson.get(p.id) ?? [];
      const events: AttEvent[] = evRows.map((r) => ({
        id: r.id, personId: r.person_id, kind: r.kind as "in" | "out", at: r.at, timeLabel: timeLabel(r.at),
        source: r.source as "qr" | "manual", note: r.note, correctedByName: r.corrected_by_name,
      }));
      const sched = scheduleByPerson.get(p.id);
      // 그날 여러 일정(카운터·수업·상담)이 섞여도 "언제부터 언제까지 매여 있었는지"만 관심사라
      // 가장 이른 시작·가장 늦은 종료로 하루 전체 범위를 잡는다(src/lib/staff-attendance.ts judgeDay 주석 참고).
      const schedStart = sched && sched.length ? Math.min(...sched.filter((_, i) => i % 2 === 0)) : null;
      const schedEnd = sched && sched.length ? Math.max(...sched.filter((_, i) => i % 2 === 1)) : null;
      const firstIn = events.find((e) => e.kind === "in") ?? null;
      const lastOut = [...events].reverse().find((e) => e.kind === "out") ?? null;
      // 오늘 날짜면 아직 근무 시작 전(또는 근무 중)일 수 있어 "결근"이 아니라 "미기록"으로 물러선다
      // — 근무 종료 시각을 지났을 때만 그날이 끝났다고 본다(judgeDay 주석 참고). 과거 날짜는 항상 끝난 날.
      const dayEnded = date < today || (schedEnd != null && nowMin >= schedEnd);
      const judgement = judgeDay(schedStart, schedEnd, firstIn ? minOf(firstIn.at) : null, lastOut ? minOf(lastOut.at) : null, dayEnded);
      return {
        personId: p.id, personName: p.name, events,
        scheduleLabel: schedStart != null && schedEnd != null ? `${clockLabel(schedStart)}~${clockLabel(schedEnd)}` : null,
        judgement,
      };
    });

    return (
      <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <PageHeader backHref="/m/staff" backLabel="직원 관리" title="출근부" flexNone />
        <AttendanceView
          date={date} today={today} prevDate={prevDate} nextDate={nextDate}
          canManage={canManageAttendance} canViewAll={canViewAttendance}
          people={(canViewAttendance ? peopleAll : peopleAll.filter((p) => p.id === me.id)).map((p) => ({ id: p.id, name: p.name }))}
          summaries={summaries} meId={me.id}
        />
      </main>
    );
  }

  // section === "schedule"
  // 주 이동 — /m/penalty 와 같은 패턴(월요일로 정규화, 미래 주는 이번 주로 클램프).
  const currentWeek = weekStartKey();
  const requested = sp.week && WEEK_RE.test(sp.week) ? weekStartKey(new Date(`${sp.week}T00:00:00Z`)) : currentWeek;
  const ws = requested > currentWeek ? currentWeek : requested;
  const isCurrentWeek = ws === currentWeek;
  const weekEnd = addDays(ws, 7);
  const wsLabel = weekStartLabel(ws);
  const prevWeek = addDays(ws, -7);
  const nextWeek = addDays(ws, 7);

  const [staffRows, roomRows, schedRows] = await Promise.all([
    db.query<{ id: string; name: string }>(
      `select id, name from person
        where active = true
          and (is_cto = true or id in (select person_id from person_role where branch_id=$1))
        order by name`,
      [branch],
    ),
    db.query<{ id: string; name: string; floor: number; capacity: number | null }>(
      `select id, name, floor, capacity from room where branch_id=$1 order by floor, name`,
      [branch],
    ),
    db.query<{
      id: string; person_id: string; person_name: string; date: string; start_min: number; end_min: number;
      kind: string; room_id: string | null; room_name: string | null; note: string | null;
    }>(
      `select ss.id, ss.person_id, p.name as person_name, ss.date::text as date, ss.start_min, ss.end_min,
              ss.kind, ss.room_id, r.name as room_name, ss.note
         from staff_schedule ss
         join person p on p.id = ss.person_id
         left join room r on r.id = ss.room_id
        where ss.branch_id = $1 and ss.date >= $2 and ss.date < $3
        order by ss.date, ss.start_min`,
      [branch, ws, weekEnd],
    ),
  ]);
  const staff: StaffRow[] = staffRows.rows;
  const spaces: SpaceRow[] = roomRows.rows.map((r) => ({ id: r.id, name: r.name, floor: r.floor, capacity: r.capacity }));
  const schedule: ScheduleRow[] = schedRows.rows.map((r) => ({
    id: r.id,
    personId: r.person_id,
    personName: r.person_name,
    date: r.date,
    start: r.start_min,
    end: r.end_min,
    kind: r.kind,
    roomId: r.room_id,
    roomName: r.room_name,
    note: r.note,
  }));

  return (
    <main style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <PageHeader backHref="/m/staff" backLabel="직원 관리" title="근무표" flexNone />
      <div style={{ flex: "none", display: "flex", justifyContent: "center", padding: "10px 16px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href={`/m/staff?section=schedule&week=${prevWeek}`} className="chip" aria-label="이전 주" title="이전 주">‹</Link>
          <span style={{ fontSize: 13, fontWeight: isCurrentWeek ? 700 : 800, color: isCurrentWeek ? "var(--ink)" : "var(--accent)", whiteSpace: "nowrap" }}>
            {isCurrentWeek ? `이번 주 ${wsLabel} ~` : `${wsLabel} ~ (다른 주 보는 중)`}
          </span>
          {!isCurrentWeek && <Link href="/m/staff?section=schedule" className="chip" style={{ fontWeight: 700 }}>오늘로</Link>}
          {isCurrentWeek ? (
            <span className="chip" aria-disabled style={{ opacity: 0.35, pointerEvents: "none" }}>›</span>
          ) : (
            <Link href={`/m/staff?section=schedule&week=${nextWeek}`} className="chip" aria-label="다음 주" title="다음 주">›</Link>
          )}
        </div>
      </div>
      <StaffScheduleView
        weekStart={ws} staff={staff} spaces={spaces} schedule={schedule}
        canManage={canManage} today={todayKey()}
      />
    </main>
  );
}
