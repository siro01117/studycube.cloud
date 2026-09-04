// 직원 관리 진입 화면 — "무엇을 하러 왔는지" 먼저 고르게 한다. 명단·일정 두 화면은 그대로,
// 이 화면은 그 둘(과 앞으로 붙을 근태·급여)로 가는 갈림길일 뿐이다. 항목마다 한 줄 설명을 붙여
// 이름만 나열하지 않는다 — 집주인 지적: "무엇을 쓸지 선택할 수 있게".
// 카드 자리(item) 자체는 서버에서 권한으로 걸러 넘겨준다(HubItem[]) — 이 컴포넌트는 그리기만 한다.
//
// 벤또 그리드 — 집주인 지적: "메뉴 선택 화면이 너무 단조롭다. 도시락처럼 애니메이션·피드백도 있었으면
// 좋겠고, 메뉴 그리드도 벤또 느낌으로 크기를 다르게 다이나믹하게." 두 곳에서 그대로 가져왔다(새 패턴
// 발명 금지):
//   - 모션(spring·hover lift·tap scale·진입 스태거): src/app/m/meal/_demo/components/Motion.tsx,
//     src/app/m/meal/_demo/pages/Dashboard.tsx
//   - 12열 벤또 grid-column span 방식: src/app/m/student/[id]/StudentDetail.tsx (.sd-bento)
// 자리 배정 규칙은 href 유무로 자동 결정한다(ready=자주 쓰는 것=크게, 준비중=작게) — 권한에 따라
// 후보가 빠져도(예: canAct 없으면 명단 카드 자체가 안 옴) 남은 카드들이 스스로 큰/작은 그룹 안에서
// span 을 다시 나눠 가지므로 항상 빈 칸 없이 채워진다.
"use client";
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";

export type HubItem = {
  key: string;
  label: string;
  desc: string;
  href: string | null; // null = 준비중(자리만 보여주고 못 들어감) → 벤또에서 작은 칸
  icon: "list" | "calendar" | "clock" | "coin";
  badge?: number; // 대기 중 신청 등, 카드 우상단 점 배지
};

const spring = { type: "spring", stiffness: 320, damping: 26, mass: 0.7 } as const;

const ic = { width: 20, height: 20, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const ICONS: Record<HubItem["icon"], ReactNode> = {
  list: <svg {...ic}><path d="M5 4h8M5 8h8M5 12h8M2.3 4h.01M2.3 8h.01M2.3 12h.01" /></svg>,
  calendar: <svg {...ic}><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></svg>,
  clock: <svg {...ic}><circle cx="8" cy="8.5" r="5.7" /><path d="M8 5.3V8.5l3 1.7" /></svg>,
  coin: <svg {...ic}><circle cx="8" cy="8" r="5.7" /><path d="M8 4.8v6.4M5.9 6.2c0-1 .9-1.5 2.1-1.5s2.1.5 2.1 1.3-.8 1.1-2.1 1.4-2.1.6-2.1 1.4.9 1.3 2.1 1.3 2.1-.5 2.1-1.5" /></svg>,
};

// 12열 그리드에서 큰 칸(자주 쓰는 것)/작은 칸(준비중)이 몇 칸을 먹을지 — 같은 그룹 안 개수에 따라
// 스스로 다시 나눈다(1개면 꽉 채우고, 2개면 7:5 로 비대칭, 그 이상이면 고르게 6칸씩).
// 홀수 개의 마지막 칸은 한 줄을 통째로 쓴다 — 반쪽만 차고 옆이 비면 축이 어긋나 보인다
// (홈에서 같은 문제를 .now-grid 규칙으로 이미 고쳤다).
function spanFor(large: boolean, idx: number, count: number): number {
  if (count <= 1) return 12;
  if (idx === count - 1 && count % 2 === 1) return 12;
  if (large) return idx % 2 === 0 ? 7 : 5;
  return 6;
}

// 투명도를 애니메이션 대상으로 삼지 않는다 — 위치만 움직인다. 이 애니메이션이 끝난다는 보장이
// 없어서(탭이 뒤로 밀리거나 스프링이 중간에 멎으면) opacity 가 중간값에 굳으면 글자를 읽을 수
// 없게 된다. 홈 화면이 실제로 그렇게 반투명한 채 멈춘 이력이 있다. 최악이라도 "십 픽셀 아래에
// 그대로" 일 뿐 언제나 또렷하게 보이는 쪽을 택한다.
const cardIn: Variants = {
  hidden: { y: 10 },
  show: (i: number) => ({ y: 0, transition: { ...spring, delay: i * 0.03 } }),
};
const cardInReduced: Variants = {
  hidden: { y: 0 },
  show: { y: 0, transition: { duration: 0 } },
};

export default function StaffHub({ items }: { items: HubItem[] }) {
  const reduceMotion = useReducedMotion();
  const largeCount = items.filter((it) => it.href !== null).length;
  const smallCount = items.length - largeCount;
  let largeSeen = 0;
  let smallSeen = 0;

  // 카드가 넷뿐이라 위로 몰리면 화면 아래가 통째로 빈다 — 남는 세로를 위아래로 나눠 갖게 가운데에
  // 놓는다. 카드가 늘어 화면을 넘기면 자연스럽게 위에서부터 흐르고 스크롤된다 — "safe center"
  // 가 그 스위치다: 안 넘칠 땐 보통 center 처럼 굴지만, 넘치면 start 로 물러나 위가 잘리지 않고
  // overflowY:auto 스크롤이 실제로 먹는다(순수 center 는 overflow 시 위아래 양쪽으로 넘쳐 위쪽이
  // 스크롤 불가 영역으로 잘린다 — 이 파일이 고쳐야 했던 바로 그 결함).

  return (
    // 위 여백을 아래보다 훨씬 적게 둬 "safe center" 가 만드는 중심을 기하학적 중앙보다 위로
    // 끌어올린다(집주인 지적: 완전 정중앙이면 아래가 허전하다). safe center 자체는 그대로 —
    // 카드가 늘어 넘치면 여전히 위에서부터 흐르고 스크롤이 먹는다(그 이유는 아래 주석 참고).
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 16px 96px", display: "flex", flexDirection: "column", justifyContent: "safe center" }}>
      <div style={{ maxWidth: HUB_WIDTH, width: "100%", margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14, flex: "none" }}>
        {items.map((it, i) => {
          const ready = it.href !== null;
          const large = ready;
          const span = spanFor(large, large ? largeSeen : smallSeen, large ? largeCount : smallCount);
          if (large) largeSeen++; else smallSeen++;

          // 아이콘·제목·설명을 한 줄씩 세로로 쌓고, 아이콘은 제목과 한 행에서 같이 가운데맞춤한다
          // — 예전엔 아이콘(큰 정사각형, 자체 중앙정렬)과 제목(줄 맨 위에서 시작)이 서로 다른
          // 기준으로 놓여 축이 어긋나 보였다(집주인 지적: "질서가 없어 보인다"). 이제 정렬 축은
          // 하나 — 아이콘·제목이 공유하는 가로줄의 중앙 — 이고, 설명은 그 아래 전체 폭으로 흐른다.
          const body = (
            <>
              {!!it.badge && it.badge > 0 && (
                <motion.span
                  initial={reduceMotion ? false : { scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ ...spring, delay: i * 0.03 + 0.12 }}
                  style={{
                    position: "absolute", top: -8, right: -8,
                    display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 24, height: 24, padding: "0 6px",
                    borderRadius: 999, background: "var(--warn)", color: "#fff", fontSize: 12, fontWeight: 800,
                    border: "2px solid var(--card)", boxShadow: "var(--shadow-lg)",
                  }}
                >{it.badge}</motion.span>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: large ? 12 : 9 }}>
                <span style={{
                  width: large ? 44 : 34, height: large ? 44 : 34, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
                  background: ready ? "var(--accent-soft)" : "var(--panel2)", color: ready ? "var(--accent)" : "var(--faint)", flex: "none",
                }}>
                  {ICONS[it.icon]}
                </span>
                <span style={{ fontSize: large ? 17 : 14, fontWeight: 800, color: ready ? "var(--ink)" : "var(--faint)" }}>{it.label}</span>
                {!ready && <span className="chip" style={{ height: 20, padding: "0 8px", fontSize: 10.5, fontWeight: 700, color: "var(--sub)" }}>준비중</span>}
              </div>
              <div style={{ fontSize: large ? 13 : 12, color: "var(--sub)", lineHeight: 1.45 }}>{it.desc}</div>
            </>
          );
          const cardStyle: CSSProperties = {
            position: "relative", display: "flex", flexDirection: "column", gap: large ? 10 : 8,
            padding: large ? 20 : 16, minHeight: large ? 132 : 92,
            // 준비중 카드는 바탕도 한 단 낮춰(panel2) 눈에 덜 띄게 한다 — 예전엔 투명도만 낮춰 흰
            // 카드끼리 배경이 같았다("바탕으로 위계를 주라"는 지적에 대한 조치, 장식이 아니라
            // 기존 ready/href 상태를 그대로 반영하는 값이라 자의적 우선순위를 새로 만들지 않는다).
            background: ready ? "var(--card)" : "var(--panel2)",
            textDecoration: "none", color: "inherit", gridColumn: `span ${span}`,
          };
          const motionProps = reduceMotion
            ? { variants: cardInReduced, initial: "hidden" as const, animate: "show" as const }
            : {
                variants: cardIn, initial: "hidden" as const, animate: "show" as const, custom: i,
                whileHover: ready ? { y: -3 } : undefined,
                whileTap: ready ? { scale: 0.98 } : undefined,
                transition: spring,
              };

          return ready ? (
            <motion.div key={it.key} className="card" style={cardStyle} {...motionProps}>
              <Link href={it.href!} style={{ position: "absolute", inset: 0, borderRadius: "inherit" }} aria-label={it.label} />
              {body}
            </motion.div>
          ) : (
            <motion.div key={it.key} className="card" style={{ ...cardStyle, opacity: 0.7, cursor: "default" }} title={`${it.label} · 준비중`} {...motionProps}>
              {body}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// 진입 화면 폭 — 720(옛 2열 균등 카드) → 900(벤또). 큰 칸(7/12, 5/12)에 아이콘 44px+제목 17px+
// 설명 한 줄이 여유 있게 들어가야 해서 넓혀야 했다. 근무 일정 화면(StaffScheduleView)이 이미 980,
// 좌석 편집기가 940을 쓰고 있어 그 사이인 900으로 잡아 형제 화면들과 폭 단차를 크게 만들지 않았다 —
// 명단·표를 채우는 화면(1080)만큼 넓힐 필요는 없다(카드 4장뿐이라 헐렁해짐). page.tsx 의 헤더도
// 같은 값을 리터럴로 든다(이 파일이 "use client" 라 export 해도 서버 컴포넌트에서 못 읽는다) —
// 값을 바꿀 땐 두 곳 다 고칠 것.
const HUB_WIDTH = 900;
