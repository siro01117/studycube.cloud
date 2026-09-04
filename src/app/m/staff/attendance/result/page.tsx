import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { ready } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { todayKey, timeLabel } from "@/lib/date";
import { judgeDay, minOf, JUDGEMENT_LABEL } from "@/lib/staff-attendance";

export const runtime = "nodejs";

// QR 스캔·로그인 후 이어붙이기(route.ts 두 곳)가 마지막에 redirect 로 여기로 온다. "오류"로 끝내지
// 말라는 지시대로, 실패 사유마다 사람이 이해할 수 있는 다음 행동을 안내한다.
const ERROR_COPY: Record<string, { title: string; body: string }> = {
  invalid: { title: "유효하지 않은 QR입니다", body: "화면을 촬영한 사진이거나 잘못된 링크일 수 있습니다. 카운터 화면의 QR을 다시 찍어주세요." },
  expired: { title: "QR이 만료됐습니다", body: `QR은 발급 후 ${20}초만 유효합니다. 카운터 화면은 자동으로 새 QR을 계속 보여주니, 지금 떠 있는 QR을 다시 찍어주세요.` },
  used: { title: "이미 사용된 QR입니다", body: "방금 찍은 QR은 이미 한 번 처리됐습니다(본인 또는 다른 사람). 카운터 화면의 최신 QR을 다시 찍어주세요." },
  branch_mismatch: { title: "다른 지점의 QR입니다", body: "본인이 소속된 지점의 카운터 화면에 뜬 QR을 찍어주세요." },
  not_recorded: { title: "기록을 찾을 수 없습니다", body: "출퇴근 처리가 완료되지 않은 것 같습니다. 카운터 화면의 QR을 다시 찍거나 관리자에게 문의해주세요." },
};

export default async function AttendanceResultPage({ searchParams }: { searchParams: Promise<{ error?: string; kind?: string }> }) {
  const sp = await searchParams;

  if (sp.error) {
    const copy = ERROR_COPY[sp.error] ?? ERROR_COPY.invalid;
    return (
      <Shell>
        <Card tone="danger">
          <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>{copy.title}</h1>
          <p style={{ fontSize: 13.5, color: "var(--sub)", marginTop: 8, lineHeight: 1.6 }}>{copy.body}</p>
        </Card>
      </Shell>
    );
  }

  const kind = sp.kind === "in" || sp.kind === "out" ? sp.kind : null;
  if (!kind) redirect("/m/staff?section=attendance");

  const me = await getMe();
  if (!me) redirect("/login");
  await ready();
  const branch = me.activeBranchId!;
  const date = todayKey();

  const [attRows, schedRows] = await Promise.all([
    db.query<{ kind: string; at: string }>(
      `select kind, at::text as at from staff_attendance where branch_id=$1 and person_id=$2 and date=$3 order by at`,
      [branch, me.id, date],
    ),
    db.query<{ start_min: number; end_min: number }>(
      `select start_min, end_min from staff_schedule where branch_id=$1 and person_id=$2 and date=$3`,
      [branch, me.id, date],
    ),
  ]);
  const ins = attRows.rows.filter((r) => r.kind === "in");
  const outs = attRows.rows.filter((r) => r.kind === "out");
  const firstIn = ins[0] ?? null;
  const lastOut = outs[outs.length - 1] ?? null;
  const schedStart = schedRows.rows.length ? Math.min(...schedRows.rows.map((r) => r.start_min)) : null;
  const schedEnd = schedRows.rows.length ? Math.max(...schedRows.rows.map((r) => r.end_min)) : null;
  // 이 화면은 방금 펀치 하나가 실제로 남았을 때만 그려진다(아래 justNow 확인) — firstIn/lastOut 중
  // 하나는 항상 존재하므로 judgeDay 의 "기록 전혀 없음" 분기(absent/notYet)에는 들어가지 않는다.
  // dayEnded 값은 그 분기에서만 쓰이므로 여기선 아무 값이나 안전하다 — true 로 둔다.
  const judgement = judgeDay(schedStart, schedEnd, firstIn ? minOf(firstIn.at) : null, lastOut ? minOf(lastOut.at) : null, true);

  // ?kind=in 은 route.ts 두 곳이 recordPunch 성공 직후 redirect 로 붙인 값이지만, 쿼리스트링 자체는
  // URL을 손으로 바꾸거나 새로고침해도 그대로 남는다 — "찍었다"는 화면 문구는 그 값만 믿지 말고
  // 실제로 같은 종류(kind)의 기록이 오늘 남아 있는지로 확인한다(집주인 지시: 실제 기록을 근거로).
  const justNow = kind ? [...attRows.rows].reverse().find((r) => r.kind === kind) ?? null : null;
  if (!justNow) {
    return (
      <Shell>
        <Card tone="danger">
          <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>{ERROR_COPY.not_recorded.title}</h1>
          <p style={{ fontSize: 13.5, color: "var(--sub)", marginTop: 8, lineHeight: 1.6 }}>{ERROR_COPY.not_recorded.body}</p>
        </Card>
      </Shell>
    );
  }
  const badgeTone = judgement === "onTime" || judgement === "noSchedule" ? "ok" : "warn";

  return (
    <Shell>
      <Card tone="ok">
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--sub)" }}>{me.name}님</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: "6px 0 0" }}>{kind === "in" ? "출근 처리됐습니다" : "퇴근 처리됐습니다"}</h1>
        <p style={{ fontSize: 15, color: "var(--ink)", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{timeLabel(justNow.at)}</p>
        <div style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: badgeTone === "ok" ? "var(--ok-soft)" : "var(--warn-soft)", color: badgeTone === "ok" ? "var(--ok)" : "var(--warn)" }}>
          {JUDGEMENT_LABEL[judgement]}
        </div>
        <a href="/m/staff?section=attendance" className="chip" style={{ display: "inline-block", marginTop: 20, textDecoration: "none" }}>내 출근부 보기</a>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 20 }}>{children}</main>;
}
function Card({ children, tone }: { children: React.ReactNode; tone: "ok" | "danger" }) {
  return (
    <div
      style={{
        width: "100%", maxWidth: 380, textAlign: "center", background: "var(--card)",
        border: `1px solid ${tone === "danger" ? "var(--danger-strong)" : "var(--line)"}`,
        borderRadius: 16, padding: "34px 28px", boxShadow: "0 6px 24px rgba(20,22,30,.06)",
      }}
    >
      {children}
    </div>
  );
}
