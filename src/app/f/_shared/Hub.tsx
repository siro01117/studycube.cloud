"use client";

// 공개 폼 허브(/f/<허브슬러그>) — 링크를 연 학생이 가장 먼저 보는 "무엇을 하러 왔는지" 선택 화면.
// 흐름: [허브 열기] → 본인확인(StudentGate, 한 번만) → sessionStorage 에 신원 저장 → 항목 선택 → 해당 폼.
// 확인된 신원은 useIdentity() 로 sessionStorage 에 보관되고, 이후 각 폼(sch9m2vt/svq82fk1 등)이
// 다시 묻지 않고 그대로 읽어 쓴다. 신뢰 근거는 여전히 제출 시점의 서버 재검증(actions.ts submitForm).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import FormShell from "./FormShell";
import StudentGate, { type StudentIdentity } from "./StudentGate";
import { useIdentity, type StoredIdentity } from "./useIdentity";
import { useScrollFocusOn } from "./useScrollFocus";
import { LockPopup, GENERIC_LOCKED_LINES } from "./LockedInfo";
import { getHubItems } from "../registry";
import type { FormDef } from "../registry";
// 스케쥴 입력 항목의 "지금 열려있는지" 판정 — sch9m2vt.tsx 가 폼 진입 시 쓰는 것과 같은 서버액션을
// 허브에서도 그대로 재사용한다(로직 재발명 금지). 평소엔 닫혀 있다가 입력 가능한 상태일 때만 열리게
// 하려면 허브 단계에서부터 같은 판정이 필요하다.
import { checkScheduleWindow } from "../[slug]/forms/schedule-window-actions";
import type { EditState } from "@/lib/schedule-window";
// 학생 공지(ntc7h2qm) 안 읽은 개수 — 카드 배지용. 스케쥴 입력 판정과 같은 자리(신원 확인 직후)에서 재사용.
import { getUnreadMyNoticeCount } from "../[slug]/forms/notice-actions";

// 빌드 타임에 고정되는 값 — 프로덕션 빌드에서는 이 분기가 아예 번들에 남지 않는다.
const IS_DEV = process.env.NODE_ENV !== "production";

/** 스케쥴 입력 항목의 잠금 팝업 문구 — 학생이 읽는 짧은 말로. 기간 개념이 없어졌으므로 "다음 입력
 *  기간" 같은 안내는 하지 않는다(2026-08-22). */
function scheduleLockLines(): string[] {
  return ["이미 시간표를 제출했어요.", "고쳐야 하면 카운터에 말씀해 주세요."];
}

/** 열려 있을 때 카드에 보여줄 한 줄 — sch9m2vt.tsx Wizard 상단 배너와 같은 문구를 쓴다(허브 카드 ↔
 *  폼 상단이 다른 말을 하면 혼란스럽다). */
function scheduleBanner(state: Extract<EditState, { open: true }>): string {
  return state.reason === "first" ? "아직 제출 전이에요. 지금 낼 수 있어요." : "수정할 수 있게 열어 두었어요. 제출하면 다시 잠겨요.";
}

export default function Hub() {
  const items = getHubItems();
  // 신청/설문 항목과 "내 정보"(조회 전용) 항목을 시각적으로 구분해서 보여준다 — registry.ts 의
  // section 필드 하나만 기준. 정렬은 각 그룹 안에서만(order 는 그룹 간에 의미 없음).
  const applyItems = items.filter((item) => item.section !== "info");
  const infoItems = items.filter((item) => item.section === "info");
  const { identity, hydrated, save, clear } = useIdentity();
  const menuListRef = useRef<HTMLDivElement>(null);
  // 본인확인 성공(신원 없음 -> 있음)으로 메뉴 목록이 나타날 때만 스크롤-포커스 — hydrated 는 최초
  // 마운트 시에도 false->true 로 바뀌지만 그때는 identity 가 still null 이라 이 deps 는 안 변한다.
  useScrollFocusOn(menuListRef, [!!identity], { focus: false });

  // 스케쥴 입력 항목은 평소엔 닫혀 있다가, 그 학생이 지금 입력 가능한 상태(첫 제출 전이거나, 관리자가
  // 활성화한 경우)일 때만 열린다 — sch9m2vt.tsx 가 폼 진입 시 쓰는 checkScheduleWindow 를 허브에서도
  // 그대로 재사용한다. undefined=아직 확인 전, null=확인 실패(신원 만료 등, 어차피 폼 진입 시 다시 걸러짐).
  const scheduleItem = applyItems.find((item) => item.type === "schedule") ?? null;
  const [scheduleState, setScheduleState] = useState<EditState | null | undefined>(undefined);
  useEffect(() => {
    if (!identity || !scheduleItem) return;
    let alive = true;
    const fd = new FormData();
    fd.set("slug", scheduleItem.slug);
    fd.set("name", identity.name);
    fd.set("code", identity.code);
    if (identity._test) fd.set("test", "1");
    checkScheduleWindow(fd).then((r) => {
      if (!alive) return;
      setScheduleState(r.ok ? r.state : null);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.name, identity?.code, scheduleItem?.slug]);

  // 학생 공지 안 읽은 개수 — 있으면 "내 정보" 카드에 배지로 보여준다(스케쥴 입력 판정과 같은 이유로
  // 허브 단계에서부터 확인: 폼에 들어가지 않고도 안 읽은 공지가 있는지 알 수 있어야 한다).
  const noticeItem = infoItems.find((item) => item.type === "notice") ?? null;
  const [unreadNotices, setUnreadNotices] = useState<number | null>(null);
  useEffect(() => {
    if (!identity || !noticeItem) return;
    let alive = true;
    const fd = new FormData();
    fd.set("name", identity.name);
    fd.set("code", identity.code);
    if (identity._test) fd.set("test", "1");
    getUnreadMyNoticeCount(fd).then((r) => {
      if (!alive) return;
      setUnreadNotices(r.ok ? r.count : 0);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.name, identity?.code, noticeItem?.slug]);

  const [lockPopup, setLockPopup] = useState<{ title: string; lines: string[] } | null>(null);

  return (
    <FormShell title="무엇을 하러 오셨나요?" subtitle="원하는 항목을 선택해주세요.">
      {!hydrated ? (
        <LoadingSlot />
      ) : identity ? (
        <>
          <IdentityBanner identity={identity} onReset={clear} onToggleRepeat={identity._test ? (isRepeat) => save({ ...identity, isRepeat }) : undefined} />
          <div ref={menuListRef} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
            {applyItems.map((item) => {
              if (item.type !== "schedule") {
                return <HubCard key={item.slug} item={item} onLocked={() => setLockPopup({ title: item.title, lines: GENERIC_LOCKED_LINES })} />;
              }
              // 확인 중(undefined)에는 아직 판정이 없으니 잠긴 것처럼 보이되 클릭해도 반응하지 않는다
              // (실제 이유 없이 팝업만 뜨는 걸 막는다 — 보통 한 번의 네트워크 왕복이라 금방 정해진다).
              const loading = scheduleState === undefined;
              const resolved = scheduleState ?? null;
              const ready = !loading && !!resolved?.open;
              const banner = resolved?.open ? scheduleBanner(resolved) : null;
              return (
                <HubCard
                  key={item.slug}
                  item={item}
                  readyOverride={loading ? false : ready}
                  lockedLabel={loading ? "확인 중" : "잠김"}
                  banner={banner}
                  onLocked={
                    loading
                      ? undefined
                      : () => setLockPopup({ title: item.title, lines: resolved && !resolved.open ? scheduleLockLines() : GENERIC_LOCKED_LINES })
                  }
                />
              );
            })}
          </div>
          {infoItems.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--faint)", letterSpacing: "0.02em", marginBottom: 10, paddingLeft: 2 }}>
                내 정보
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {infoItems.map((item) => {
                  const banner =
                    item.type === "notice" && unreadNotices !== null && unreadNotices > 0
                      ? `안 읽은 공지 ${unreadNotices}건`
                      : null;
                  return (
                    <HubCard
                      key={item.slug}
                      item={item}
                      banner={banner}
                      bannerIcon="dot"
                      onLocked={() => setLockPopup({ title: item.title, lines: GENERIC_LOCKED_LINES })}
                    />
                  );
                })}
              </div>
            </div>
          )}
          {lockPopup && <LockPopup title={lockPopup.title} lines={lockPopup.lines} onClose={() => setLockPopup(null)} />}
        </>
      ) : (
        <>
          <StudentGate>{(id) => <IdentityCapture identity={id} onCapture={save} />}</StudentGate>
          {IS_DEV && (
            <DevSkip
              onSkip={() =>
                save({ name: "테스트", code: "", studentId: "test", studentName: "테스트 학생", isRepeat: false, _test: true })
              }
            />
          )}
        </>
      )}
      <div style={{ fontSize: 11.5, color: "var(--faint)", textAlign: "center", marginTop: 20, lineHeight: 1.5 }}>
        문의사항은 학원으로 연락해주세요.
      </div>
    </FormShell>
  );
}

// StudentGate 는 렌더 프롭(children(identity))으로 확인 결과를 넘긴다. 그 자리에서 바로
// Hub 의 useIdentity 상태(save)를 호출하면 "다른 컴포넌트를 렌더링하는 중 조상 컴포넌트를
// 업데이트" 경고가 뜨므로, 커밋 이후 useEffect 에서 한 번만 저장한다.
function IdentityCapture({ identity, onCapture }: { identity: StudentIdentity; onCapture: (id: StoredIdentity) => void }) {
  useEffect(() => {
    onCapture(identity);
  }, [identity, onCapture]);
  return null;
}

function LoadingSlot() {
  return (
    <div
      style={{
        padding: "14px",
        borderRadius: 12,
        border: "1px solid var(--line)",
        background: "var(--panel2)",
        fontSize: 12.5,
        color: "var(--faint)",
        textAlign: "center",
      }}
    >
      확인 중…
    </div>
  );
}

function IdentityBanner({
  identity,
  onReset,
  onToggleRepeat,
}: {
  identity: StoredIdentity;
  onReset: () => void;
  onToggleRepeat?: (isRepeat: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid var(--line)",
        background: "var(--panel2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            flex: "none",
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "var(--accent-soft)",
            color: "var(--accent)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <UserIcon />
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700 }}>
          {identity.studentName} 학생으로 확인됐어요
          {identity._test && (
            <span className="chip" style={{ marginLeft: 6, color: "var(--warn)", fontWeight: 700 }}>
              테스트
            </span>
          )}
        </span>
        <button type="button" onClick={onReset} className="chip" style={{ flex: "none", cursor: "pointer" }}>
          다른 학생으로
        </button>
      </div>
      {onToggleRepeat && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>테스트 신원 구분</span>
          <div style={{ display: "flex", gap: 6 }}>
            <RepeatToggleButton label="재학생" active={!identity.isRepeat} onClick={() => onToggleRepeat(false)} />
            <RepeatToggleButton label="N수생" active={identity.isRepeat} onClick={() => onToggleRepeat(true)} />
          </div>
        </div>
      )}
    </div>
  );
}

// 테스트 신원(개발용 우회로 만든 신원)은 is_repeat 을 DB 로 알 수 없어 화면에서 직접 고를 수 있게 하는
// 작은 토글 버튼. 실제 학생 신원(StudentGate 로 확인된)에는 노출하지 않는다(Hub 의 onToggleRepeat 참고).
function RepeatToggleButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 24,
        padding: "0 11px",
        borderRadius: 999,
        border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
        background: active ? "var(--accent-soft)" : "var(--panel2)",
        color: active ? "var(--accent)" : "var(--sub)",
        fontSize: 12,
        fontWeight: active ? 800 : 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

// 개발 전용 본인확인 우회 버튼. 운영 빌드에서는 IS_DEV 가 false 로 고정돼 아예 렌더되지 않는다.
// 이걸로 만든 신원은 실제 학원 코드가 없어 제출은 서버(actions.ts submitForm)에서 그대로 막힌다 —
// 단, 개발 환경(NODE_ENV!=production)에 한해 submitForm 이 이 신원을 받아들이고 payload 에
// _test:true 를 남기도록 별도로 열어뒀다(actions.ts 참고).
function DevSkip({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      className="chip"
      style={{
        marginTop: 10,
        width: "100%",
        height: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12.5,
        fontWeight: 700,
        color: "var(--warn)",
        border: "1px dashed var(--warn)",
        cursor: "pointer",
      }}
    >
      테스트로 건너뛰기 (개발 전용)
    </button>
  );
}

function HubCard({
  item,
  readyOverride,
  lockedLabel = "준비 중",
  banner,
  bannerIcon = "clock",
  onLocked,
}: {
  item: FormDef;
  /** registry.ts 의 정적 open 대신 동적으로 판정된 상태를 쓰고 싶을 때(예: 스케쥴 입력). 생략하면 item.open. */
  readyOverride?: boolean;
  /** 잠긴 카드에 붙는 배지 문구 — 정적으로 준비 안 된 항목은 "준비 중", 일시적으로 잠긴 항목은 "잠김". */
  lockedLabel?: string;
  /** 열려 있을 때 desc 아래에 보여줄 한 줄(예: "오늘 21:30까지 수정할 수 있어요"). */
  banner?: string | null;
  /** banner 앞에 붙는 아이콘 — 기본은 시계(기간성 안내), 안 읽은 개수처럼 시간과 무관한 안내는 "dot". */
  bannerIcon?: "clock" | "dot";
  /** 잠긴 카드를 눌렀을 때 — 없으면(예: 판정 확인 중) 클릭해도 반응하지 않는다. */
  onLocked?: () => void;
}) {
  const ready = readyOverride ?? item.open;

  const cardStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minHeight: 72,
    padding: "12px 16px",
    borderRadius: 14,
    border: "1px solid var(--line)",
    background: "var(--card)",
    opacity: ready ? 1 : 0.55,
    cursor: ready ? "pointer" : onLocked ? "pointer" : "not-allowed",
    textDecoration: "none",
    color: "var(--ink)",
  };

  const body = (
    <>
      <span
        style={{
          flex: "none",
          width: 40,
          height: 40,
          borderRadius: 10,
          background: "var(--accent-soft)",
          color: "var(--accent)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <ItemIcon type={item.type} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{item.title}</span>
        {item.desc && (
          <span style={{ display: "block", fontSize: 12.5, color: "var(--dim)", marginTop: 2 }}>{item.desc}</span>
        )}
        {ready && banner && (
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, color: "var(--warn)", marginTop: 4 }}>
            {bannerIcon === "dot" ? (
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warn)", flex: "none" }} />
            ) : (
              <ClockGlyph />
            )}
            {banner}
          </span>
        )}
      </span>
      {ready ? (
        <ArrowIcon />
      ) : (
        <span className="chip" style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 4, color: "var(--dim)" }}>
          {!ready && lockedLabel !== "확인 중" && <LockGlyphSmall />}
          {lockedLabel}
        </span>
      )}
    </>
  );

  if (!ready) {
    // 잠긴 항목 — 링크가 아니라 버튼(또는 반응 없는 div)이라 페이지 이동 없이 이유 팝업만 띄운다.
    // 항목 자체는 숨기지 않는다 — 학생이 "있는 줄 알아야" 잠겨 있어도 문의할 수 있다.
    return onLocked ? (
      <button type="button" onClick={onLocked} className="touchable" style={{ ...cardStyle, textAlign: "left", font: "inherit" }} aria-haspopup="dialog">
        {body}
      </button>
    ) : (
      <div style={cardStyle} aria-disabled="true">
        {body}
      </div>
    );
  }

  return (
    <Link href={`/f/${item.slug}`} className="touchable" style={cardStyle}>
      {body}
    </Link>
  );
}

function ClockGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

function LockGlyphSmall() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function ItemIcon({ type }: { type: string }) {
  if (type === "lunch") return <LunchIcon />;
  if (type === "schedule") return <ScheduleIcon />;
  if (type === "schedule_change") return <ScheduleChangeIcon />;
  if (type === "my_schedule") return <ScheduleIcon />;
  if (type === "my_attendance") return <AttendanceIcon />;
  if (type === "my_penalty") return <PenaltyIcon />;
  if (type === "notice") return <NoticeIcon />;
  return <DocIcon />;
}

function NoticeIcon() {
  // 종(벨): 공지 카드 전용 — 다른 조회 항목(달력·방패류)과 구분.
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

function AttendanceIcon() {
  // 달력 + 체크: 출결 기록 조회 화면 전용(정기 스케쥴 아이콘과 구분).
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
      <polyline points="8 15 11 18 16 13" />
    </svg>
  );
}

function PenaltyIcon() {
  // 방패 + 느낌표: 벌점(주의) 조회 화면 전용.
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="16.5" x2="12.01" y2="16.5" />
    </svg>
  );
}

function LunchIcon() {
  // 도시락통: 손잡이 + 칸막이
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 8V6a4 4 0 0 1 8 0v2" />
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <line x1="3" y1="14" x2="21" y2="14" />
      <line x1="12" y1="8" x2="12" y2="20" />
    </svg>
  );
}

function ScheduleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </svg>
  );
}

function ScheduleChangeIcon() {
  // 달력 + 하루짜리 변경(교체 화살표): 정기 스케쥴(ScheduleIcon)과 구분되게 순환 화살표를 얹는다.
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="14" height="16" rx="2" />
      <line x1="3" y1="10" x2="17" y2="10" />
      <line x1="7" y1="3" x2="7" y2="7" />
      <line x1="13" y1="3" x2="13" y2="7" />
      <path d="M17 14a4 4 0 0 1 4 4" />
      <path d="M21 22a4 4 0 0 1-4-4" />
      <polyline points="21 15.5 21 18 18.5 18" />
      <polyline points="17 20.5 17 18 19.5 18" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--faint)", flex: "none" }}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
