"use client";

// 학생 스케쥴 입력 폼 — 3단계 위저드(등·하원 시간 → 학원·외부 일정 → 확인/제출).
// 등·하원은 "요일 그룹" 방식: 아직 정하지 않은 요일을 골라 시간을 넣고 추가하면 그룹 카드가 생긴다
// (쉬는 요일은 시간 없이 휴무 그룹으로 추가). 7개 요일이 모두 배정돼야 다음 단계로 넘어간다.
// 숫자 입력 원칙(11→01 버그 재발 방지): onChange 는 숫자 필터+slice(-2) 만, 정규화(0패딩)는
// blur 에서 e.currentTarget.value 를 읽어서, 포커스 시 select(), 자동 포커스 이동은
// 커밋(리렌더) 이후인 useEffect 에서(src/app/m/schedule/ScheduleDemo.tsx 의 Inp 패턴과 동일).
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import FormShell from "../../_shared/FormShell";
import IdentityExpired from "../../_shared/IdentityExpired";
import { useIdentity, useRedirectIfNoIdentity, type StoredIdentity } from "../../_shared/useIdentity";
import { useScrollFocusOn } from "../../_shared/useScrollFocus";
import { submitForm } from "../../actions";
import { getHubSlug } from "../../registry";
import type { FormDef } from "../../registry";
import { blockStyleOf } from "@/lib/schedule";
import { SCHEDULE_MAX_MIN } from "@/lib/schedule-import";
import { checkScheduleWindow, type ScheduleWindowCheck, type SchedulePayloadShape } from "./schedule-window-actions";
import type { EditState } from "@/lib/schedule-window";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
type HM = { h: string; m: string };
const emptyHM = (): HM => ({ h: "", m: "" });

type Academy = { id: string; name: string; days: number[]; start: HM; end: HM };
/** 요일 그룹 — 같은 등·하원 시각(또는 휴무)을 쓰는 요일 묶음. rest=true 면 arrive/leave 는 쓰지 않는다. */
type DayGroup = { id: string; days: number[]; rest: boolean; arrive: HM; leave: HM };

// 학생 구분에 따른 등·하원 기본값. N수생(is_repeat)은 08:00~23:00, 그 외(재학생)는 17:00~23:00 —
// 등·하원 그룹을 새로 만들 때(빌더 초기값·리셋) 이 값으로 미리 채워둔다.
function defaultArrive(isRepeat: boolean): HM {
  return isRepeat ? { h: "08", m: "00" } : { h: "17", m: "00" };
}
function defaultLeave(): HM {
  return { h: "23", m: "00" };
}

const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** h/m 문자열 쌍 → 분(0~1439). 둘 중 하나라도 비어있으면 미완성으로 보고 null. */
function parseHM(v: HM): number | null {
  if (v.h === "" || v.m === "") return null;
  const h = clampInt(parseInt(v.h, 10) || 0, 0, 23);
  const m = clampInt(parseInt(v.m, 10) || 0, 0, 59);
  return h * 60 + m;
}
/** 자정 넘김 하원/종료를 +1440 으로 편 값(overnight 이 아니면 그대로). 서버(actions.ts
 *  validateSchedulePayload, schedule-import.ts validAcademies/validHours)의 SCHEDULE_MAX_MIN 상한과
 *  반드시 같은 기준으로 계산해야 한다 — 다르면 여기선 통과된 입력이 제출에서만 막힌다(과거 버그:
 *  위저드에 이 상한 체크가 아예 없어서, 학생이 3단계 검토까지 문제없이 진행한 뒤 제출에서만
 *  "하원 시간이 올바르지 않습니다"로 막혔다). */
function adjustedLeave(a: number, lRaw: number): number {
  return lRaw <= a ? lRaw + 1440 : lRaw;
}
/** true 면 자정 넘김 하원/종료가 서버 상한(다음날 새벽 2시)을 넘는다. */
function overCap(a: number | null, lRaw: number | null): boolean {
  if (a == null || lRaw == null) return false;
  return adjustedLeave(a, lRaw) > SCHEDULE_MAX_MIN;
}
const pad2 = (n: number) => String(n).padStart(2, "0");
function fmtMin(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}
/** 자정 넘김(>=1440)이면 "다음날 HH:MM", 아니면 "HH:MM". */
function fmtLeave(min: number): string {
  return min >= 1440 ? `다음날 ${fmtMin(min)}` : fmtMin(min);
}
let seq = 0;
const uid = () => "id" + Date.now().toString(36) + ++seq;

/** 열려 있을 때 위저드 상단에 보여줄 한 줄. 기간 개념이 없어졌으므로(2026-08-22) 남은 시간 안내 대신
 *  "왜 지금 열려 있는지"만 알려준다. Hub.tsx 의 같은 이름 로직과 문구를 맞춘다(허브 카드 배너 ↔ 폼
 *  상단 배너가 다른 말을 하면 혼란스럽다). */
function scheduleBannerText(state: Extract<EditState, { open: true }>): string {
  return state.reason === "first" ? "아직 제출 전이에요. 지금 낼 수 있어요." : "수정할 수 있게 열어 두었어요. 제출하면 다시 잠겨요.";
}

export default function ScheduleForm({ def }: { def: FormDef }) {
  const { identity, hydrated, clear } = useIdentity();
  const hubSlug = getHubSlug();
  // 신원 없이(=허브를 거치지 않고) 폼 주소로 바로 들어온 경우 허브로 보낸다.
  useRedirectIfNoIdentity(hydrated, identity, hubSlug);
  // 위저드가 입력 중인 내용을 갖고 있는지(Wizard 가 onDirtyChange 로 올려준다) — 상단 "‹ 홈" 을
  // 누를 때 확인을 띄울지 결정한다. 완료·잠김·확인 중 화면에서는 false 로 남아 바로 이동한다.
  const [dirty, setDirty] = useState(false);

  // 입력 기간(열림/잠김) 판정 — 화면 진입 시 한 번만 서버에 묻는다(submitForm 은 제출 시 다시 재판정하므로
  // 여기서 매 렌더마다 다시 물을 필요는 없다). 실패(본인확인 만료)면 세션 신원을 지우고 안내 화면으로.
  const [check, setCheck] = useState<ScheduleWindowCheck | null>(null);
  const [checking, setChecking] = useState(true);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!hydrated || !identity) return;
    let alive = true;
    setChecking(true);
    const fd = new FormData();
    fd.set("slug", def.slug);
    fd.set("name", identity.name);
    fd.set("code", identity.code);
    if (identity._test) fd.set("test", "1"); // DEV-ONLY: 서버가 NODE_ENV!=production 일 때만 받아준다.
    checkScheduleWindow(fd).then((r) => {
      if (!alive) return;
      if (!r.ok && r.kind === "identity") {
        clear();
        setExpired(true);
      } else {
        setCheck(r);
      }
      setChecking(false);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, identity?.name, identity?.code, def.slug]);

  return (
    <FormShell title={def.title} subtitle={def.intro} maxWidth={480} backHref={`/f/${hubSlug}`} confirmLeave={dirty}>
      {!hydrated || !identity ? null : expired ? (
        <IdentityExpired hubSlug={hubSlug} />
      ) : checking || !check ? (
        <div style={{ fontSize: 13.5, color: "var(--dim)", textAlign: "center", padding: "24px 4px" }}>확인하고 있어요…</div>
      ) : !check.ok ? (
        <div style={{ fontSize: 13.5, color: "var(--danger)", fontWeight: 600, textAlign: "center", padding: "24px 4px" }}>{check.error}</div>
      ) : !check.state.open ? (
        <LockedScreen
          state={check.state}
          studentName={check.studentName}
          lastPayload={check.lastPayload}
          lastStatus={check.lastStatus}
          lastNote={check.lastNote}
        />
      ) : (
        <Wizard def={def} identity={identity} onExpired={clear} hubSlug={hubSlug} banner={scheduleBannerText(check.state)} onDirtyChange={setDirty} />
      )}
    </FormShell>
  );
}

// ---------------- 잠김 화면 ----------------
// 제출 처리 상태(반영됨/검토 대기/반려됨) — 학생이 자기 제출이 어떻게 됐는지 알 수 있게.
// 색은 다른 폼 화면과 같은 CSS 변수 체계(--warn/--ok/--danger)를 그대로 쓴다.
function SubmissionStatusBadge({ status, note }: { status: "pending" | "done" | "rejected"; note: string | null }) {
  const cfg =
    status === "done"
      ? { label: "반영됨", fg: "var(--accent)", bg: "var(--accent-soft)", icon: <CheckSmallIcon /> }
      : status === "rejected"
        ? { label: "반려됨", fg: "var(--danger)", bg: "color-mix(in srgb, var(--danger) 12%, transparent)", icon: <WarnIcon /> }
        : { label: "검토 대기", fg: "var(--warn)", bg: "var(--warn-soft)", icon: <ClockBadgeIcon /> };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", marginBottom: 14 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, color: cfg.fg, background: cfg.bg }}>
        {cfg.icon}{cfg.label}
      </span>
      {status === "rejected" && note && (
        <span style={{ fontSize: 12, color: "var(--dim)", textAlign: "center" }}>사유: {note}</span>
      )}
    </div>
  );
}

function LockedScreen({
  state,
  studentName,
  lastPayload,
  lastStatus,
  lastNote,
}: {
  state: Extract<EditState, { open: false }>;
  studentName: string;
  lastPayload: SchedulePayloadShape | null;
  lastStatus: "pending" | "done" | "rejected" | null;
  lastNote: string | null;
}) {
  const hasSchedule = !!(lastPayload && ((lastPayload.hours?.length ?? 0) > 0 || (lastPayload.restDays?.length ?? 0) > 0));
  return (
    <div>
      <div style={{ textAlign: "center", padding: "8px 4px 4px" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--panel2)", color: "var(--dim)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
          <LockIcon />
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>이미 시간표를 제출했어요</div>
        <div style={{ fontSize: 13.5, color: "var(--dim)", lineHeight: 1.6, marginBottom: 14 }}>고쳐야 하면 카운터에 말씀해 주세요.</div>
        {lastStatus && <SubmissionStatusBadge status={lastStatus} note={lastNote} />}
      </div>

      {hasSchedule && lastPayload && (
        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--sub)", marginBottom: 10 }}>{studentName} 학생의 현재 시간표</div>
          <ReadOnlySummary payload={lastPayload} />
        </div>
      )}
    </div>
  );
}

// 마지막 제출 payload(원시 minute 값)를 읽기 전용으로 요약 — StepReview 의 요약/미니 타임테이블과
// 같은 렌더 로직을 쓰되, 입력값(HM 문자열) 대신 이미 확정된 분 값을 바로 쓰므로 더 단순하다.
function ReadOnlySummary({ payload }: { payload: SchedulePayloadShape }) {
  const hoursByDay = new Map<number, { arrive: number; leave: number }>();
  for (const h of payload.hours ?? []) hoursByDay.set(h.day, { arrive: h.arrive, leave: h.leave });
  const restDaySet = new Set<number>(payload.restDays ?? []);
  const academies: Academy[] = (payload.academies ?? []).map((a, i) => ({
    id: `ro${i}`,
    name: a.name,
    days: a.days,
    start: hmOf(a.start),
    end: hmOf(a.end),
  }));

  const hmGroups = new Map<string, { hm: { arrive: number; leave: number }; ds: number[] }>();
  for (const [d, hm] of hoursByDay) {
    const key = `${hm.arrive}-${hm.leave}`;
    const g = hmGroups.get(key);
    if (g) g.ds.push(d);
    else hmGroups.set(key, { hm, ds: [d] });
  }
  const summaryLines = [...hmGroups.values()]
    .sort((a, b) => a.ds[0] - b.ds[0])
    .map((g) => `${g.ds.sort((x, y) => x - y).map((d) => DAY_LABELS[d - 1]).join("·")} ${fmtMin(g.hm.arrive)}–${fmtLeave(g.hm.leave)}`);
  const restLine =
    restDaySet.size > 0 ? `${[...restDaySet].sort((a, b) => a - b).map((d) => DAY_LABELS[d - 1]).join("·")} · 안 가요` : null;
  const academyLines = (payload.academies ?? []).map(
    (a) => `${a.name} ${a.days.map((d) => DAY_LABELS[d - 1]).join("·")} ${fmtMin(a.start)}–${fmtLeave(a.end)}`,
  );

  return (
    <div>
      <MiniTimetable hoursByDay={hoursByDay} restDaySet={restDaySet} academies={academies} />
      <div style={{ marginTop: 16, padding: "14px", border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel2)", display: "flex", flexDirection: "column", gap: 6 }}>
        {summaryLines.map((line) => (
          <div key={line} style={{ fontSize: 13.5, fontWeight: 700 }}>
            {line}
          </div>
        ))}
        {restLine && <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--sub)" }}>{restLine}</div>}
        {academyLines.map((line) => (
          <div key={line} style={{ fontSize: 13.5, color: "var(--sub)" }}>
            {line}
          </div>
        ))}
        {academyLines.length === 0 && <div style={{ fontSize: 13.5, color: "var(--faint)" }}>학원·외부 일정 없음</div>}
      </div>
    </div>
  );
}

function hmOf(min: number): HM {
  const m = ((min % 1440) + 1440) % 1440;
  return { h: pad2(Math.floor(m / 60)), m: pad2(m % 60) };
}

function Wizard({
  def,
  identity,
  onExpired,
  hubSlug,
  banner,
  onDirtyChange,
}: {
  def: FormDef;
  identity: StoredIdentity;
  onExpired: () => void;
  hubSlug: string;
  /** 지금 열려 있는 이유 한 줄(첫 제출 전 / 활성화됨) — Wizard 상단 배너. */
  banner?: string | null;
  /** 입력 중인 내용이 있는지 상위(ScheduleForm)로 올린다 — 상단 "‹ 홈" 확인 여부에 쓰인다. */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [phase, setPhase] = useState<"form" | "done" | "expired">("form");
  const [step, setStep] = useState(1);

  // 1단계 — 등·하원 요일 그룹. 시간 기본값은 학생 구분(N수생/재학생)에 따라 미리 채워둔다.
  const [groups, setGroups] = useState<DayGroup[]>([]);
  const [builderDays, setBuilderDays] = useState<number[]>([]);
  const [builderArrive, setBuilderArrive] = useState<HM>(() => defaultArrive(identity.isRepeat));
  const [builderLeave, setBuilderLeave] = useState<HM>(() => defaultLeave());

  const toggleBuilderDay = (d: number) =>
    setBuilderDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]).sort((a, b) => a - b));

  const resetBuilder = () => {
    setBuilderDays([]);
    setBuilderArrive(defaultArrive(identity.isRepeat));
    setBuilderLeave(defaultLeave());
  };
  const addAttendGroup = () => {
    if (builderDays.length === 0 || parseHM(builderArrive) == null || parseHM(builderLeave) == null) return;
    setGroups((prev) => [...prev, { id: uid(), days: builderDays, rest: false, arrive: builderArrive, leave: builderLeave }]);
    resetBuilder();
  };
  const addRestGroup = () => {
    if (builderDays.length === 0) return;
    setGroups((prev) => [...prev, { id: uid(), days: builderDays, rest: true, arrive: emptyHM(), leave: emptyHM() }]);
    resetBuilder();
  };
  const removeGroup = (id: string) => setGroups((prev) => prev.filter((g) => g.id !== id));
  const editGroup = (id: string) => {
    const g = groups.find((x) => x.id === id);
    if (!g) return;
    setGroups((prev) => prev.filter((x) => x.id !== id));
    setBuilderDays(g.days);
    setBuilderArrive(g.rest ? defaultArrive(identity.isRepeat) : g.arrive);
    setBuilderLeave(g.rest ? defaultLeave() : g.leave);
  };

  const assignedDays = groups.flatMap((g) => g.days);
  const unassignedDays = ALL_DAYS.filter((d) => !assignedDays.includes(d));
  const attendDays = groups.filter((g) => !g.rest).flatMap((g) => g.days).sort((a, b) => a - b);

  // 2단계 — 학원·외부 일정.
  const [academies, setAcademies] = useState<Academy[]>([]);
  const addAcademy = () => setAcademies((prev) => [...prev, { id: uid(), name: "", days: [], start: emptyHM(), end: emptyHM() }]);
  const updateAcademy = (id: string, next: Academy) => setAcademies((prev) => prev.map((a) => (a.id === id ? next : a)));
  const removeAcademy = (id: string) => setAcademies((prev) => prev.filter((a) => a.id !== id));

  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // 작성 중인 내용이 있는지(요일 그룹을 추가했거나, 빌더에서 요일을 고르는 중이거나, 학원 일정을
  // 추가한 경우) — "제출됨/신원만료" 단계에서는 잃을 게 없으니 false.
  useEffect(() => {
    onDirtyChange(phase === "form" && (groups.length > 0 || academies.length > 0 || builderDays.length > 0));
  }, [phase, groups.length, academies.length, builderDays.length, onDirtyChange]);

  // 단계 이동 시 새 단계 상단으로, 제출 완료 시 완료 화면 상단으로 스크롤-포커스한다.
  const stepAreaRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  useScrollFocusOn(stepAreaRef, [step]);
  useScrollFocusOn(doneRef, [phase]);

  if (phase === "expired") {
    return <IdentityExpired hubSlug={hubSlug} />;
  }

  if (phase === "done") {
    return (
      <div ref={doneRef} style={{ textAlign: "center", padding: "12px 4px 4px" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
          <CheckIcon />
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>제출됐습니다</div>
        <div style={{ fontSize: 14, color: "var(--dim)", lineHeight: 1.6, marginBottom: 20 }}>
          학원에서 확인 후 반영합니다.
          <br />
          시간표가 바뀌면 이 페이지에서 다시 제출해주세요 — 새로 제출하면 이전 내용을 덮어씁니다.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Link
            href={`/f/${hubSlug}`}
            className="btn btn-accent"
            style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, textDecoration: "none" }}
          >
            홈으로
          </Link>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setPhase("form");
              setStep(1);
            }}
            style={{ height: 48, fontSize: 14.5, fontWeight: 700, width: "100%" }}
          >
            다시 작성하기
          </button>
        </div>
      </div>
    );
  }

  const canNextStep1 = unassignedDays.length === 0;

  const buildPayload = () => {
    const hours = groups
      .filter((g) => !g.rest)
      .flatMap((g) => {
        const a = parseHM(g.arrive);
        const lRaw = parseHM(g.leave);
        if (a == null || lRaw == null) return [];
        const l = lRaw <= a ? lRaw + 1440 : lRaw;
        return g.days.map((d) => ({ day: d, arrive: a, leave: l }));
      });
    const restDays = groups.filter((g) => g.rest).flatMap((g) => g.days);
    const hoursDays = hours.map((h) => h.day);

    const academiesPayload = academies
      .map((a) => ({ ...a, days: a.days.filter((d) => hoursDays.includes(d)) }))
      .filter((a) => a.name.trim() && a.days.length && parseHM(a.start) != null && parseHM(a.end) != null)
      // 등·하원 그룹(HoursRow)은 상한 초과 시 "추가" 버튼 자체를 막아 애초에 groups 에 들어올 수 없지만,
      // 학원 카드는 시간을 바로 편집하는 방식이라 같은 게이트가 없다 — 여기서 걸러 서버가 이 이유로
      // 통째로 거부하는 대신, 카드에 뜨는 경고(AcademyCard overCap)와 일치하게 조용히 빠진다.
      .filter((a) => !overCap(parseHM(a.start), parseHM(a.end)))
      .map((a) => {
        const s = parseHM(a.start)!;
        const eRaw = parseHM(a.end)!;
        const e = eRaw <= s ? eRaw + 1440 : eRaw;
        return { name: a.name.trim().slice(0, 40), days: a.days, start: s, end: e };
      });

    return { hours, restDays, academies: academiesPayload, note: "" };
  };

  const submit = () => {
    const payload = buildPayload();
    if (payload.hours.length + payload.restDays.length !== 7) {
      setErr("모든 요일의 등·하원 또는 쉬는 날을 정해주세요.");
      setStep(1);
      return;
    }
    // 방어적 재확인 — "추가" 버튼이 이미 상한(overCap) 을 막지만, groups 상태가 어떤 경로로든
    // 상한을 넘는 값을 담고 있으면 여기서 걸러 서버가 이유 없이 거부하는 상황을 막는다.
    if (payload.hours.some((h) => h.leave > SCHEDULE_MAX_MIN)) {
      setErr("하원 시간이 다음날 새벽 2시를 넘는 요일이 있어요. 시간을 다시 확인해주세요.");
      setStep(1);
      return;
    }
    setErr(null);
    const fd = new FormData();
    fd.set("slug", def.slug);
    fd.set("name", identity.name);
    fd.set("code", identity.code);
    if (identity._test) fd.set("test", "1"); // DEV-ONLY: 서버가 NODE_ENV!=production 일 때만 받아준다.
    fd.set("payload", JSON.stringify(payload));
    start(async () => {
      const r = await submitForm(fd);
      if (r.ok) setPhase("done");
      else if (r.kind === "identity") {
        onExpired();
        setPhase("expired");
      } else setErr(r.error);
    });
  };

  const goNext = () => {
    if (step === 1 && !canNextStep1) return;
    if (step < 3) {
      setStep((s) => s + 1);
      return;
    }
    submit();
  };
  const goPrev = () => setStep((s) => Math.max(1, s - 1));

  const canNext = step === 1 ? canNextStep1 : true;

  return (
    <div>
      <div style={{ fontSize: 13, color: "var(--sub)", marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
        <UserIcon />
        {identity.studentName} 학생으로 확인되었어요.
      </div>

      {banner && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "var(--warn)",
            background: "var(--warn-soft)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", marginBottom: 16,
          }}
        >
          <ClockBadgeIcon />
          {banner}
        </div>
      )}

      <Progress step={step} />

      <div ref={stepAreaRef}>
        {step === 1 && (
          <StepHours
            isRepeat={identity.isRepeat}
            groups={groups}
            builderDays={builderDays}
            builderArrive={builderArrive}
            builderLeave={builderLeave}
            onToggleBuilderDay={toggleBuilderDay}
            onBuilderArrive={setBuilderArrive}
            onBuilderLeave={setBuilderLeave}
            onAddAttend={addAttendGroup}
            onAddRest={addRestGroup}
            onEditGroup={editGroup}
            onRemoveGroup={removeGroup}
          />
        )}
        {step === 2 && (
          <StepAcademies days={attendDays} academies={academies} onAdd={addAcademy} onUpdate={updateAcademy} onRemove={removeAcademy} />
        )}
        {step === 3 && <StepReview groups={groups} academies={academies} onEdit={() => setStep(1)} />}
      </div>

      {err && <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600, marginTop: 14 }}>{err}</div>}

      <div
        style={{
          display: "flex",
          gap: 10,
          marginTop: 22,
          paddingTop: 14,
          borderTop: "1px solid var(--line)",
          position: "sticky",
          bottom: 0,
          background: "var(--card)",
        }}
      >
        {step > 1 && (
          <button type="button" className="btn" onClick={goPrev} style={{ flex: 1, height: 50, fontSize: 15, fontWeight: 700 }}>
            이전
          </button>
        )}
        <button
          type="button"
          className="btn btn-accent"
          disabled={!canNext || pending}
          onClick={goNext}
          style={{ flex: 1, height: 50, fontSize: 15, fontWeight: 700 }}
        >
          {pending ? "제출 중…" : step === 3 ? "제출" : "다음"}
        </button>
      </div>
    </div>
  );
}

// ---------------- 진행 표시 ----------------
function Progress({ step }: { step: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--panel2)", overflow: "hidden" }}>
        <div style={{ width: `${(step / 3) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: 999, transition: "width .2s ease" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--dim)", flex: "none" }}>{step} / 3</span>
    </div>
  );
}

// ---------------- 1단계 — 등·하원 요일 그룹 ----------------
function StepHours({
  isRepeat, groups, builderDays, builderArrive, builderLeave,
  onToggleBuilderDay, onBuilderArrive, onBuilderLeave, onAddAttend, onAddRest, onEditGroup, onRemoveGroup,
}: {
  isRepeat: boolean;
  groups: DayGroup[];
  builderDays: number[];
  builderArrive: HM;
  builderLeave: HM;
  onToggleBuilderDay: (d: number) => void;
  onBuilderArrive: (v: HM) => void;
  onBuilderLeave: (v: HM) => void;
  onAddAttend: () => void;
  onAddRest: () => void;
  onEditGroup: (id: string) => void;
  onRemoveGroup: (id: string) => void;
}) {
  const assignedDays = groups.flatMap((g) => g.days);
  const unassigned = ALL_DAYS.filter((d) => !assignedDays.includes(d));
  const canAddAttend =
    builderDays.length > 0 &&
    parseHM(builderArrive) != null &&
    parseHM(builderLeave) != null &&
    !overCap(parseHM(builderArrive), parseHM(builderLeave));
  const canAddRest = builderDays.length > 0;

  // 그룹을 추가하면(요일 묶음 확정) 새로 생긴 카드로 먼저, 이어서 남은 요일 선택 영역으로 스크롤-포커스한다
  // — 두 호출 모두 groups.length 변화에 걸리므로 같은 커밋에서 실행되고, 최종적으로는 계속 입력을
  // 이어갈 수 있게 선택 영역(builderRef, 포커스 있음)이 화면에 남는다.
  const lastGroupCardRef = useRef<HTMLDivElement>(null);
  const builderRef = useRef<HTMLDivElement>(null);
  useScrollFocusOn(lastGroupCardRef, [groups.length], { focus: false });
  useScrollFocusOn(builderRef, [groups.length]);

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>등원·하원 시간을 알려주세요</div>
      <div style={{ fontSize: 13.5, color: "var(--dim)", marginBottom: 16 }}>요일을 묶어서 한 번에 등·하원 시간을 정해요. 쉬는 요일은 시간 없이 추가해요.</div>

      {groups.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
          {groups.map((g, i) => (
            <div key={g.id} ref={i === groups.length - 1 ? lastGroupCardRef : undefined}>
              <GroupCard group={g} onEdit={() => onEditGroup(g.id)} onRemove={() => onRemoveGroup(g.id)} />
            </div>
          ))}
        </div>
      )}

      {unassigned.length === 0 ? (
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--accent)", padding: "12px 14px", border: "1px solid var(--line)", borderRadius: 12, background: "var(--accent-soft)" }}>
          모든 요일을 정했어요.
        </div>
      ) : (
        <div ref={builderRef} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: "14px 14px 16px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--warn)", marginBottom: 10 }}>
            아직 정하지 않은 요일: {unassigned.map((d) => DAY_LABELS[d - 1]).join("·")}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 16 }}>
            {DAY_LABELS.map((label, i) => {
              const d = i + 1;
              if (!unassigned.includes(d)) {
                return (
                  <div
                    key={d}
                    style={{
                      height: 44, borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel2)",
                      color: "var(--faint)", fontSize: 13, fontWeight: 600, display: "grid", placeItems: "center",
                    }}
                  >
                    {label}
                  </div>
                );
              }
              const on = builderDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggleBuilderDay(d)}
                  style={{
                    height: 44, borderRadius: 10, border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
                    background: on ? "var(--accent-soft)" : "var(--card)", color: on ? "var(--accent)" : "var(--ink)",
                    fontSize: 13, fontWeight: on ? 800 : 600, cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 8 }}>
            {isRepeat ? "N수생" : "재학생"} 기준 기본값이에요. 다르면 고쳐주세요.
          </div>
          <HoursRow arrive={builderArrive} leave={builderLeave} onArrive={onBuilderArrive} onLeave={onBuilderLeave} />

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button type="button" className="btn btn-accent" disabled={!canAddAttend} onClick={onAddAttend} style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>
              추가
            </button>
            <button type="button" className="btn" disabled={!canAddRest} onClick={onAddRest} style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>
              이 날은 쉴게요
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupCard({ group, onEdit, onRemove }: { group: DayGroup; onEdit: () => void; onRemove: () => void }) {
  const label = group.days.map((d) => DAY_LABELS[d - 1]).join("·");
  let timeLabel = "안 가요";
  if (!group.rest) {
    const a = parseHM(group.arrive);
    const lRaw = parseHM(group.leave);
    if (a != null && lRaw != null) {
      const l = lRaw <= a ? lRaw + 1440 : lRaw;
      timeLabel = `${fmtMin(a)}–${fmtLeave(l)}`;
    }
  }
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 14px",
        border: "1px solid var(--line)", borderRadius: 12, background: group.rest ? "var(--panel2)" : "var(--card)",
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{label}</div>
        <div style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 2 }}>{timeLabel}</div>
      </div>
      <div style={{ display: "flex", gap: 6, flex: "none" }}>
        <button
          type="button"
          onClick={onEdit}
          style={{
            height: 34, padding: "0 12px", borderRadius: 9, border: "1px solid var(--line)",
            background: "var(--card)", color: "var(--sub)", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
          }}
        >
          수정
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="그룹 삭제"
          style={{
            width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center",
            border: "1px solid var(--line)", background: "var(--card)", color: "var(--dim)", cursor: "pointer",
          }}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

function HoursRow({ arrive, leave, onArrive, onLeave }: { arrive: HM; leave: HM; onArrive: (v: HM) => void; onLeave: (v: HM) => void }) {
  const a = parseHM(arrive);
  const lRaw = parseHM(leave);
  const overnight = a != null && lRaw != null && lRaw <= a;
  const capped = overCap(a, lRaw);
  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <TimeField label="등원" value={arrive} onChange={onArrive} />
        <TimeField label="하원" value={leave} onChange={onLeave} />
      </div>
      {overnight && lRaw != null && !capped && (
        <div style={{ fontSize: 12.5, color: "var(--warn)", fontWeight: 700, marginTop: 10 }}>
          자정을 넘겨요 — {fmtLeave(lRaw + 1440)} 로 저장돼요.
        </div>
      )}
      {capped && (
        <div style={{ fontSize: 12.5, color: "var(--danger)", fontWeight: 700, marginTop: 10 }}>
          하원 시간은 다음날 새벽 2시를 넘을 수 없어요.
        </div>
      )}
    </div>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: HM; onChange: (v: HM) => void }) {
  return (
    <div style={{ flex: "1 1 160px", minWidth: 150 }}>
      <span className="label">{label}</span>
      <ClockInput value={value} onChange={onChange} />
    </div>
  );
}

/** 시/분 두 칸. onChange=필터+slice(-2)만, blur=e.currentTarget.value 읽어 정규화, focus=select(),
 * 시 2자리 채우면 분 칸으로 자동 이동(커밋 후 useEffect), 분 칸 비어있을 때 Backspace 면 시 칸 복귀. */
function ClockInput({ value, onChange }: { value: HM; onChange: (v: HM) => void }) {
  const hRef = useRef<HTMLInputElement>(null);
  const mRef = useRef<HTMLInputElement>(null);
  const [jump, setJump] = useState(false);

  useEffect(() => {
    if (jump) {
      mRef.current?.focus();
      setJump(false);
    }
  }, [jump]);

  const boxStyle: React.CSSProperties = {
    width: 56, height: 50, borderRadius: 10, border: "1px solid var(--line)", background: "#fff",
    textAlign: "center", fontSize: 20, fontWeight: 700, color: "var(--ink)", fontVariantNumeric: "tabular-nums", outline: "none",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        ref={hRef}
        value={value.h}
        inputMode="numeric"
        maxLength={2}
        placeholder="00"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(-2);
          onChange({ ...value, h: v });
          if (v.length === 2) setJump(true);
        }}
        onBlur={(e) => {
          const raw = e.currentTarget.value;
          if (raw === "") return;
          const h = clampInt(parseInt(raw, 10) || 0, 0, 23);
          onChange({ ...value, h: pad2(h) });
        }}
        style={boxStyle}
      />
      <span style={{ fontSize: 18, color: "var(--sub)", fontWeight: 700 }}>:</span>
      <input
        ref={mRef}
        value={value.m}
        inputMode="numeric"
        maxLength={2}
        placeholder="00"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(-2);
          onChange({ ...value, m: v });
        }}
        onBlur={(e) => {
          const raw = e.currentTarget.value;
          if (raw === "") return;
          const m = clampInt(parseInt(raw, 10) || 0, 0, 59);
          onChange({ ...value, m: pad2(m) });
        }}
        onKeyDown={(e) => {
          if (e.key === "Backspace" && value.m === "") {
            e.preventDefault();
            hRef.current?.focus();
          }
        }}
        style={boxStyle}
      />
    </div>
  );
}

// ---------------- 2단계 — 학원·외부 일정 ----------------
function StepAcademies({
  days, academies, onAdd, onUpdate, onRemove,
}: { days: number[]; academies: Academy[]; onAdd: () => void; onUpdate: (id: string, a: Academy) => void; onRemove: (id: string) => void }) {
  const overlap = computeOverlap(academies);
  // "일정 추가" 클릭으로 새 카드가 생기면 그 카드로 스크롤-포커스한다.
  const lastAcademyRef = useRef<HTMLDivElement>(null);
  useScrollFocusOn(lastAcademyRef, [academies.length]);
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>학원·외부 일정이 있나요</div>
      <div style={{ fontSize: 13.5, color: "var(--dim)", marginBottom: 16 }}>없으면 그냥 다음으로 넘어가도 돼요.</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 14 }}>
        {academies.map((a, i) => (
          <div key={a.id} ref={i === academies.length - 1 ? lastAcademyRef : undefined}>
            <AcademyCard item={a} days={days} onChange={(next) => onUpdate(a.id, next)} onRemove={() => onRemove(a.id)} />
          </div>
        ))}
      </div>

      {overlap && (
        <div style={{ fontSize: 12.5, color: "var(--warn)", fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <WarnIcon />
          겹치는 시간이 있어요 — 학원에서 확인 후 조정할게요.
        </div>
      )}

      <button
        type="button"
        onClick={onAdd}
        style={{
          width: "100%", height: 50, borderRadius: 12, border: "1px dashed var(--accent)", background: "var(--accent-soft)",
          color: "var(--accent)", fontSize: 14.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}
      >
        <PlusIcon />
        일정 추가
      </button>
    </div>
  );
}

function AcademyCard({ item, days, onChange, onRemove }: { item: Academy; days: number[]; onChange: (a: Academy) => void; onRemove: () => void }) {
  const s = parseHM(item.start);
  const eRaw = parseHM(item.end);
  const overnight = s != null && eRaw != null && eRaw <= s;
  const capped = overCap(s, eRaw);
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: "16px 14px 14px", position: "relative", display: "flex", flexDirection: "column", gap: 14 }}>
      <button
        type="button"
        onClick={onRemove}
        aria-label="일정 삭제"
        style={{
          position: "absolute", top: 10, right: 10, width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center",
          border: "1px solid var(--line)", background: "var(--card)", color: "var(--dim)", cursor: "pointer",
        }}
      >
        <TrashIcon />
      </button>

      <label style={{ paddingRight: 40 }}>
        <span className="label">이름</span>
        <input
          className="input"
          defaultValue={item.name}
          placeholder="예: 수학학원"
          onChange={(e) => onChange({ ...item, name: e.target.value })}
          onBlur={(e) => onChange({ ...item, name: e.currentTarget.value.trim().slice(0, 40) })}
        />
      </label>

      <div>
        <span className="label">요일</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {days.map((d) => {
            const on = item.days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...item, days: on ? item.days.filter((x) => x !== d) : [...item.days, d].sort((a, b) => a - b) })}
                style={{
                  width: 40, height: 40, borderRadius: 10, border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
                  background: on ? "var(--accent-soft)" : "var(--card)", color: on ? "var(--accent)" : "var(--ink)",
                  fontSize: 13.5, fontWeight: on ? 800 : 600, cursor: "pointer",
                }}
              >
                {DAY_LABELS[d - 1]}
              </button>
            );
          })}
          {days.length === 0 && <span style={{ fontSize: 12.5, color: "var(--faint)" }}>등·하원 요일이 없어요</span>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 140px", minWidth: 130 }}>
          <span className="label">시작</span>
          <ClockInput value={item.start} onChange={(v) => onChange({ ...item, start: v })} />
        </div>
        <div style={{ flex: "1 1 140px", minWidth: 130 }}>
          <span className="label">종료</span>
          <ClockInput value={item.end} onChange={(v) => onChange({ ...item, end: v })} />
        </div>
      </div>
      {overnight && eRaw != null && !capped && (
        <div style={{ fontSize: 12.5, color: "var(--warn)", fontWeight: 700 }}>자정을 넘겨요 — {fmtLeave(eRaw + 1440)} 로 저장돼요.</div>
      )}
      {capped && (
        <div style={{ fontSize: 12.5, color: "var(--danger)", fontWeight: 700 }}>
          종료 시간이 다음날 새벽 2시를 넘어서 이 일정은 제출에 포함되지 않아요. 시간을 조정해주세요.
        </div>
      )}
    </div>
  );
}

function computeOverlap(academies: Academy[]): boolean {
  const entries: { day: number; start: number; end: number }[] = [];
  for (const a of academies) {
    const s = parseHM(a.start);
    const eRaw = parseHM(a.end);
    if (s == null || eRaw == null) continue;
    const e = eRaw <= s ? eRaw + 1440 : eRaw;
    for (const d of a.days) entries.push({ day: d, start: s, end: e });
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i].day === entries[j].day && entries[i].start < entries[j].end && entries[j].start < entries[i].end) return true;
    }
  }
  return false;
}

// ---------------- 3단계 — 확인 ----------------
function StepReview({ groups, academies, onEdit }: { groups: DayGroup[]; academies: Academy[]; onEdit: () => void }) {
  const hoursByDay = new Map<number, { arrive: number; leave: number }>();
  for (const g of groups) {
    if (g.rest) continue;
    const a = parseHM(g.arrive);
    const lRaw = parseHM(g.leave);
    if (a == null || lRaw == null) continue;
    const l = lRaw <= a ? lRaw + 1440 : lRaw;
    for (const d of g.days) hoursByDay.set(d, { arrive: a, leave: l });
  }
  const restDaySet = new Set<number>(groups.filter((g) => g.rest).flatMap((g) => g.days));
  const attendDays = [...hoursByDay.keys()];

  const cleanAcademies = academies
    .map((a) => ({ ...a, days: a.days.filter((d) => attendDays.includes(d)) }))
    .filter((a) => a.name.trim() && a.days.length && parseHM(a.start) != null && parseHM(a.end) != null);

  // 요일별 요약 줄 — 같은 등하원 시각을 쓰는 요일끼리 묶는다.
  const hmGroups = new Map<string, { hm: { arrive: number; leave: number }; ds: number[] }>();
  for (const [d, hm] of hoursByDay) {
    const key = `${hm.arrive}-${hm.leave}`;
    const g = hmGroups.get(key);
    if (g) g.ds.push(d);
    else hmGroups.set(key, { hm, ds: [d] });
  }
  const summaryLines = [...hmGroups.values()]
    .sort((a, b) => a.ds[0] - b.ds[0])
    .map((g) => `${g.ds.sort((x, y) => x - y).map((d) => DAY_LABELS[d - 1]).join("·")} ${fmtMin(g.hm.arrive)}–${fmtLeave(g.hm.leave)}`);

  const restLine =
    restDaySet.size > 0 ? `${[...restDaySet].sort((a, b) => a - b).map((d) => DAY_LABELS[d - 1]).join("·")} · 안 가요` : null;

  const academyLines = cleanAcademies.map((a) => {
    const s = parseHM(a.start)!;
    const eRaw = parseHM(a.end)!;
    const e = eRaw <= s ? eRaw + 1440 : eRaw;
    return `${a.name} ${a.days.map((d) => DAY_LABELS[d - 1]).join("·")} ${fmtMin(s)}–${fmtLeave(e)}`;
  });

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>이대로 제출할까요</div>
      <div style={{ fontSize: 13.5, color: "var(--dim)", marginBottom: 16 }}>내용을 확인해주세요.</div>

      <MiniTimetable hoursByDay={hoursByDay} restDaySet={restDaySet} academies={cleanAcademies} />

      <div style={{ marginTop: 16, padding: "14px", border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel2)", display: "flex", flexDirection: "column", gap: 6 }}>
        {summaryLines.map((line) => (
          <div key={line} style={{ fontSize: 13.5, fontWeight: 700 }}>
            {line}
          </div>
        ))}
        {restLine && (
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--sub)" }}>{restLine}</div>
        )}
        {academyLines.map((line) => (
          <div key={line} style={{ fontSize: 13.5, color: "var(--sub)" }}>
            {line}
          </div>
        ))}
        {academyLines.length === 0 && <div style={{ fontSize: 13.5, color: "var(--faint)" }}>학원·외부 일정 없음</div>}
      </div>

      <button
        type="button"
        onClick={onEdit}
        style={{ marginTop: 14, width: "100%", height: 44, borderRadius: 10, border: "1px solid var(--line)", background: "var(--card)", color: "var(--sub)", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
      >
        수정할 게 있어요
      </button>
    </div>
  );
}

// 주간 미니 타임테이블(읽기 전용). 07:00~다음날 01:00 구간, 요일 머리글 고정 + 07·12·18·23 눈금선만.
// 등·하원은 그 위치에 선으로, 재실 구간 바깥은 옅게 덮는다. 휴무 요일은 열 전체를 옅게.
const TT_START = 7 * 60;
const TT_END = 25 * 60;
const TT_SPAN = TT_END - TT_START;
const TT_HEIGHT = 250;
const TT_GUTTER = 28;
const TT_AXIS = [7, 12, 18, 23].map((h) => h * 60);
const AXIS_LINE = "color-mix(in srgb, var(--line) 55%, transparent)";
const MUTE_OVERLAY = "color-mix(in srgb, var(--panel2) 80%, transparent)";
const REST_OVERLAY = "color-mix(in srgb, var(--panel2) 88%, transparent)";

function MiniTimetable({
  hoursByDay, restDaySet, academies,
}: { hoursByDay: Map<number, { arrive: number; leave: number }>; restDaySet: Set<number>; academies: Academy[] }) {
  const yOf = (min: number) => clampInt(Math.round(((min - TT_START) / TT_SPAN) * TT_HEIGHT), 0, TT_HEIGHT);
  const academyStyle = blockStyleOf("외부 학원");

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", background: "var(--card)" }}>
      <div style={{ display: "flex" }}>
        <div style={{ width: TT_GUTTER, flex: "none" }} />
        {DAY_LABELS.map((label, i) => {
          const d = i + 1;
          const rest = restDaySet.has(d);
          return (
            <div
              key={d}
              style={{
                flex: 1, textAlign: "center", fontSize: 11, fontWeight: 700, padding: "6px 0",
                color: rest ? "var(--faint)" : "var(--sub)", borderBottom: "1px solid var(--line)",
              }}
            >
              {label}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", height: TT_HEIGHT }}>
        <div style={{ width: TT_GUTTER, flex: "none", position: "relative" }}>
          {TT_AXIS.map((min) => (
            <span
              key={min}
              style={{ position: "absolute", right: 4, top: yOf(min) - 6, fontSize: 9.5, color: "var(--faint)", fontVariantNumeric: "tabular-nums" }}
            >
              {pad2(min / 60)}
            </span>
          ))}
        </div>
        {DAY_LABELS.map((_, i) => {
          const d = i + 1;
          const rest = restDaySet.has(d);
          const hm = hoursByDay.get(d);
          const items = academies.filter((a) => a.days.includes(d));
          return (
            <div key={d} style={{ flex: 1, position: "relative", borderLeft: "1px solid var(--line)" }}>
              {TT_AXIS.map((min) => (
                <div key={min} style={{ position: "absolute", left: 0, right: 0, top: yOf(min), height: 1, background: AXIS_LINE }} />
              ))}
              {rest && <div style={{ position: "absolute", inset: 0, background: REST_OVERLAY }} />}
              {!rest && hm && (
                <>
                  <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: yOf(hm.arrive), background: MUTE_OVERLAY }} />
                  <div style={{ position: "absolute", left: 0, right: 0, top: yOf(hm.leave), bottom: 0, background: MUTE_OVERLAY }} />
                  <div style={{ position: "absolute", left: 0, right: 0, top: yOf(hm.arrive) - 0.75, height: 1.5, background: "var(--sub)" }} />
                  <div style={{ position: "absolute", left: 0, right: 0, top: yOf(hm.leave) - 0.75, height: 1.5, background: "var(--sub)" }} />
                </>
              )}
              {!rest && items.map((a) => {
                const s = parseHM(a.start);
                const eRaw = parseHM(a.end);
                if (s == null || eRaw == null) return null;
                const e = eRaw <= s ? eRaw + 1440 : eRaw;
                const top = yOf(s);
                const height = Math.max(3, yOf(e) - top);
                const showLabel = height >= 20;
                return (
                  <div
                    key={a.id}
                    title={`${a.name} ${fmtMin(s)}–${fmtLeave(e)}`}
                    style={{
                      position: "absolute", left: 2, right: 2, top, height,
                      background: academyStyle.bg, border: `1px solid ${academyStyle.bd}`, borderRadius: 3,
                      color: academyStyle.fg, fontSize: 9.5, fontWeight: 700, overflow: "hidden",
                      whiteSpace: "nowrap", textOverflow: "ellipsis", padding: showLabel ? "1px 3px" : "0",
                    }}
                  >
                    {showLabel ? a.name : ""}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- 아이콘 ----------------
function CheckIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function CheckSmallIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function ClockBadgeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}
function WarnIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
