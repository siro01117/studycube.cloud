// 홈 화면 = 종합 대시보드 — 최상위 화면(DESIGN.md §0 "홈" 쪽 · §1 상하좌우 중앙). page.tsx(서버)가
// 권한·쿼리를 전부 걸러 순수 값만 넘기고, 이 파일은 그리기 + 진입 애니메이션만 맡는다(애니메이션은
// 새로 발명하지 않고 기존 StaffHub.tsx 패턴 재사용). 모듈 카드 격자는 없앴다 — 좌측 메뉴(NavRail)가
// 이미 그 일을 하므로 중복이었다(집주인 지시). 대신 "지금" 카드(NowSection)가 주인공이다.
//
// 재작업(집주인 2차 지시, "조잡하고 AI틱하다"): 배경에 뜬 흐릿한 보라 블롭 두 개와 이름에 걸린
// 그라디언트 글자를 없앴다 — 둘 다 뜻 없는 장식이라 어느 AI 생성 페이지에나 붙는 물건이었다.
// "화려함"은 장식이 아니라 글자 크기의 낙차·여백·악센트 하나에서 나오게 한다(DESIGN.md §2).
// stats 밴드(도시락 발주·근무자·공지)는 맨 아래에서 위로 올려 헤더 바로 아래 뒀다 — 다만 크기는
// 작게 유지해 아래 "순찰 상태" 같은 위험 신호 카드(30px 숫자)를 이기지 않게 했다.
"use client";
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";
import NowSection from "./NowSection";
import type { NowSnapshot } from "./nowActions";

export type StatItem = { key: string; label: string; value: string; sub?: string; tone?: "warn" };

const spring = { type: "spring", stiffness: 320, damping: 26, mass: 0.7 } as const;
// 등장 효과는 y(위치)만 움직인다 — opacity를 애니메이션 대상에서 아예 뺐다. 예전엔 opacity:0에서
// 시작해 JS(스프링)가 끝까지 가야만 글씨가 보였는데, 탭이 백그라운드로 밀리는 등 어떤 이유로든
// 애니메이션이 중간값에 멈추면 화면 전체가 흐릿하게 굳어버렸다(집주인이 opacity 0.47/0.18/0으로
// 멈춘 걸 직접 재봄). "트리거가 안 와도 내용은 보여야 한다" 원칙에 따라 초기값부터 완전히
// 불투명하게 두고, 살짝 아래에서 위로 올라오는 효과만 얹는다 — 애니메이션이 통째로 실패해도
// 최악의 경우 "10px 아래에 그대로 있음"일 뿐 읽는 데는 지장이 없다.
const cardIn: Variants = { hidden: { y: 10 }, show: (i: number) => ({ y: 0, transition: { ...spring, delay: i * 0.035 } }) };
const cardInReduced: Variants = { hidden: { y: 0 }, show: { y: 0, transition: { duration: 0 } } };

const STAT_ICON: Record<string, ReactNode> = {
  staff: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>,
  lunch: <><path d="M3 2v7a2 2 0 0 0 2 2 2 2 0 0 0 2-2V2M5 2v20M21 15V2a5 5 0 0 0-3 5v6h3zM18 15v7" /></>,
  notice: <><path d="M3 11l18-5v13L3 15z" /><path d="M11.6 16.5 13 21l3-1.5-1-4.2" /></>,
};
const ic = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export default function HomeView({
  name, today, now, stats, patrolPeople, fieldHref, logoutAction,
}: {
  name: string; today: string; now: NowSnapshot; stats: StatItem[];
  patrolPeople: { name: string; n: number }[] | null; // null = patrol.view 없음
  fieldHref: string | null; logoutAction: () => void;
}) {
  const reduceMotion = useReducedMotion();

  // 상하좌우 중앙 + safe center(DESIGN.md §1) — 내용이 뷰포트보다 길면 위부터 채워 스크롤(순수
  // center 로 위가 잘리던 결함을 반복하지 않는다). stats 밴드 → "지금" 카드 순으로 헤더 바로
  // 아래라 급한 것이 스크롤 없이 첫 화면에 보인다(집주인이 지적한 예전 결함 — 모듈 격자에 밀려
  // 아래로 접혀 있었다).
  return (
    <div style={S.page}>
      <div style={S.scroller}>
        <div style={S.center}>
          <div style={S.container}>
            <Header name={name} today={today} fieldHref={fieldHref} logoutAction={logoutAction} reduceMotion={!!reduceMotion} />

            {stats.length > 0 && (
              <Section delay={1} reduceMotion={!!reduceMotion}>
                <div style={S.statBand}>
                  {stats.map((s, i) => (
                    <StatEntry key={s.key} stat={s} index={i} last={i === stats.length - 1} />
                  ))}
                </div>
              </Section>
            )}

            <Section delay={2} reduceMotion={!!reduceMotion}>
              <NowSection initial={now} patrolPeople={patrolPeople} />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ children, delay, reduceMotion }: { children: ReactNode; delay: number; reduceMotion: boolean }) {
  return (
    <motion.div variants={reduceMotion ? cardInReduced : cardIn} initial="hidden" animate="show" custom={delay} style={{ width: "100%" }}>
      {children}
    </motion.div>
  );
}

function Header({ name, today, fieldHref, logoutAction, reduceMotion }: { name: string; today: string; fieldHref: string | null; logoutAction: () => void; reduceMotion: boolean }) {
  return (
    <motion.header variants={reduceMotion ? cardInReduced : cardIn} initial="hidden" animate="show" custom={0} style={S.header}>
      <div style={S.greeting}>안녕하세요, <span style={S.greetingAccent}>{name}</span>님</div>
      <div style={{ fontSize: 13.5, color: "var(--sub)", marginTop: 6 }}>{today} 오늘의 현황입니다</div>
      <div style={S.headerActions}>
        {/* "무엇을 하러 가는지" 읽히는 이름 — 화면 전환(집주인 표현) 하나뿐인 문이라 유일한
            악센트 버튼을 여기 쓴다(DESIGN.md §2: 악센트는 하나). 좌석 배치도가 "오늘 현장"
            카테고리의 대표 화면이라 좌석 배치도로 직행한다(NavRail today 카테고리와 같은 판단). */}
        {fieldHref && (
          <Link href={fieldHref} className="btn btn-accent" style={{ textDecoration: "none" }}>
            현장 보기 →
          </Link>
        )}
        <form action={logoutAction}>
          <button type="submit" className="btn">로그아웃</button>
        </form>
      </div>
    </motion.header>
  );
}

function StatEntry({ stat, index, last }: { stat: StatItem; index: number; last: boolean }) {
  const warn = stat.tone === "warn";
  return (
    <div key={index} style={{ ...S.statEntry, ...(last ? { borderRight: "none" } : null) }}>
      <span style={{ ...S.statIcon, ...(warn ? { color: "var(--warn)" } : null) }}>
        <svg {...ic} width={16} height={16}>{STAT_ICON[stat.key] ?? STAT_ICON.notice}</svg>
      </span>
      <div style={{ ...S.statValue, color: warn ? "var(--warn)" : "var(--ink)" }}>{stat.value}</div>
      <div style={S.statLabel}>{stat.label}</div>
      {stat.sub && <div style={S.statSub}>{stat.sub}</div>}
    </div>
  );
}

const HOME_WIDTH = 960;

const S: Record<string, CSSProperties> = {
  page: { position: "relative", minHeight: "100dvh", isolation: "isolate", flex: "1 0 auto" },
  scroller: { position: "relative", zIndex: 1, minHeight: "100dvh", overflowY: "auto", display: "flex", flexDirection: "column" },
  center: { flex: 1, display: "flex", flexDirection: "column", justifyContent: "safe center", padding: "28px 16px" },
  container: { maxWidth: HOME_WIDTH, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 },

  header: { display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" },
  greeting: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.015em" },
  // 예전엔 이름에 악센트→보라 그라디언트 글자를 걸었다 — 뜻 없는 장식이라 뺐다(집주인 지적).
  // 악센트는 하나뿐이라는 원칙(DESIGN.md §2)도 지금은 단색으로 지킨다.
  greetingAccent: { fontWeight: 800, color: "var(--accent)" },
  headerActions: { display: "flex", alignItems: "center", gap: 8, marginTop: 14 },

  // stats 밴드 — 확인용 숫자(오늘 도시락 발주·근무자·공지)다, 지시를 부르는 신호가 아니다.
  // 그래서 순찰 상태 카드(30px, 위험 시 --danger-strong/--warn 색)보다 뚜렷이 작게 유지한다
  // (22px, --ink 고정) — "확실하게 보이되 아래 위험 신호를 이기지 않는" 자리(집주인 지시).
  statBand: { display: "flex", flexWrap: "wrap", background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" },
  statEntry: { flex: "1 1 130px", minWidth: 110, padding: "14px 10px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 3, borderRight: "1px solid var(--line)" },
  statIcon: { color: "var(--sub)", display: "flex", marginBottom: 2 },
  statLabel: { fontSize: 11.5, color: "var(--sub)", fontWeight: 600 },
  statValue: { fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums" },
  statSub: { fontSize: 10.5, color: "var(--faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" },
};
