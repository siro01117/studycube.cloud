"use client";

// 공개 폼 허브(/f/<허브슬러그>) — 링크를 연 학생이 가장 먼저 보는 "무엇을 하러 왔는지" 선택 화면.
// 흐름: [허브 열기] → 본인확인(StudentGate, 한 번만) → sessionStorage 에 신원 저장 → 항목 선택 → 해당 폼.
// 확인된 신원은 useIdentity() 로 sessionStorage 에 보관되고, 이후 각 폼(sch9m2vt/svq82fk1 등)이
// 다시 묻지 않고 그대로 읽어 쓴다. 신뢰 근거는 여전히 제출 시점의 서버 재검증(actions.ts submitForm).
import Link from "next/link";
import { useEffect, useRef } from "react";
import FormShell from "./FormShell";
import StudentGate, { type StudentIdentity } from "./StudentGate";
import { useIdentity, type StoredIdentity } from "./useIdentity";
import { useScrollFocusOn } from "./useScrollFocus";
import { getHubItems } from "../registry";
import type { FormDef } from "../registry";

// 빌드 타임에 고정되는 값 — 프로덕션 빌드에서는 이 분기가 아예 번들에 남지 않는다.
const IS_DEV = process.env.NODE_ENV !== "production";

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

  return (
    <FormShell title="무엇을 하러 오셨나요?" subtitle="원하는 항목을 선택해주세요.">
      {!hydrated ? (
        <LoadingSlot />
      ) : identity ? (
        <>
          <IdentityBanner identity={identity} onReset={clear} onToggleRepeat={identity._test ? (isRepeat) => save({ ...identity, isRepeat }) : undefined} />
          <div ref={menuListRef} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
            {applyItems.map((item) => (
              <HubCard key={item.slug} item={item} />
            ))}
          </div>
          {infoItems.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--faint)", letterSpacing: "0.02em", marginBottom: 10, paddingLeft: 2 }}>
                내 정보
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {infoItems.map((item) => (
                  <HubCard key={item.slug} item={item} />
                ))}
              </div>
            </div>
          )}
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

function HubCard({ item }: { item: FormDef }) {
  const ready = item.open;

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
    cursor: ready ? "pointer" : "not-allowed",
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
      </span>
      {ready ? (
        <ArrowIcon />
      ) : (
        <span className="chip" style={{ flex: "none", color: "var(--dim)" }}>
          준비 중
        </span>
      )}
    </>
  );

  if (!ready) {
    // 준비 중 항목 — 링크가 아닌 일반 div 라 클릭해도 아무 동작이 없다.
    return (
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

function ItemIcon({ type }: { type: string }) {
  if (type === "lunch") return <LunchIcon />;
  if (type === "schedule") return <ScheduleIcon />;
  if (type === "schedule_change") return <ScheduleChangeIcon />;
  if (type === "my_schedule") return <ScheduleIcon />;
  if (type === "my_attendance") return <AttendanceIcon />;
  if (type === "my_penalty") return <PenaltyIcon />;
  return <DocIcon />;
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
