// 최근 12개월 수입·지출·순이익 추이 — 라이브러리 없이 인라인 SVG. 서버 컴포넌트에서도 그대로 쓸 수
// 있게(상호작용 없음) "use client" 를 붙이지 않는다. 위: 월별 수입/지출 막대(같은 스케일).
// 아래: 순이익 선(0 기준 위아래로 갈 수 있어 막대와 스케일을 분리 — 흑자/적자 월이 섞이면 막대
// 스케일(항상 0 이상)로는 표현이 안 된다).
import { won, monthLabelShort } from "@/lib/finance";

export type TrendPoint = { year: number; month: number; income: number; expense: number; net: number };

const W = 900, BAR_H = 130, LINE_H = 60, PAD_X = 8, GAP_TOP = 22, GAP_MID = 28;
const TOTAL_H = GAP_TOP + BAR_H + GAP_MID + LINE_H + 22;

export default function Trend({ points }: { points: TrendPoint[] }) {
  const n = points.length || 1;
  const colW = (W - PAD_X * 2) / n;
  const barW = Math.min(16, colW * 0.32);
  const maxBar = Math.max(1, ...points.map((p) => Math.max(p.income, p.expense)));
  const maxNet = Math.max(1, ...points.map((p) => Math.abs(p.net)));

  const barBaseY = GAP_TOP + BAR_H;
  const lineTopY = barBaseY + GAP_MID;
  const lineMidY = lineTopY + LINE_H / 2;

  const netPoints = points.map((p, i) => {
    const cx = PAD_X + colW * i + colW / 2;
    const cy = lineMidY - (p.net / maxNet) * (LINE_H / 2 - 4);
    return { cx, cy, p };
  });
  const polyline = netPoints.map((pt) => `${pt.cx},${pt.cy}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${TOTAL_H}`} width="100%" style={{ display: "block", overflow: "visible" }} role="img" aria-label="최근 12개월 수입·지출·순이익 추이">
      {/* 막대: 월별 수입(초록) / 지출(빨강) */}
      {points.map((p, i) => {
        const cx = PAD_X + colW * i + colW / 2;
        const incH = (p.income / maxBar) * BAR_H;
        const expH = (p.expense / maxBar) * BAR_H;
        return (
          <g key={`${p.year}-${p.month}`}>
            <rect x={cx - barW - 1} y={barBaseY - incH} width={barW} height={Math.max(0, incH)} rx={2} fill="var(--ok)" />
            <rect x={cx + 1} y={barBaseY - expH} width={barW} height={Math.max(0, expH)} rx={2} fill="var(--danger-strong)" />
            <text x={cx} y={barBaseY + 16} textAnchor="middle" fontSize={10.5} fill="var(--faint)">{monthLabelShort(p.month)}</text>
            <title>{`${p.year}년 ${p.month}월 · 수입 ${won(p.income)} · 지출 ${won(p.expense)} · 순이익 ${won(p.net)}`}</title>
          </g>
        );
      })}
      <line x1={PAD_X} y1={barBaseY} x2={W - PAD_X} y2={barBaseY} stroke="var(--line)" strokeWidth={1} />

      {/* 순이익 선 — 0 기준선 위/아래로. 별도 스케일(막대와 다름). */}
      <line x1={PAD_X} y1={lineMidY} x2={W - PAD_X} y2={lineMidY} stroke="var(--line)" strokeWidth={1} strokeDasharray="3 3" />
      <polyline points={polyline} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {netPoints.map((pt, i) => (
        <circle key={i} cx={pt.cx} cy={pt.cy} r={2.6} fill={pt.p.net >= 0 ? "var(--ok)" : "var(--danger-strong)"}>
          <title>{`${pt.p.year}년 ${pt.p.month}월 순이익 ${won(pt.p.net)}`}</title>
        </circle>
      ))}
      <text x={PAD_X} y={lineTopY - 6} fontSize={10.5} fill="var(--faint)">순이익</text>
    </svg>
  );
}

export function TrendLegend() {
  const item = (color: string, label: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--sub)" }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: "inline-block" }} />{label}
    </span>
  );
  return (
    <div style={{ display: "flex", gap: 14 }}>
      {item("var(--ok)", "수입")}
      {item("var(--danger-strong)", "지출")}
      {item("var(--accent)", "순이익")}
    </div>
  );
}
