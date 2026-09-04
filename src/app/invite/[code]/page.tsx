import { ready } from "@/lib/bootstrap";
import { getInviteByCode } from "@/lib/staff-invite";
import InviteForm from "./InviteForm";

export const runtime = "nodejs";

const REASON_LABEL: Record<string, string> = {
  notfound: "존재하지 않는 초대 코드입니다.",
  used: "이미 사용된 초대 코드입니다.",
  revoked: "취소된 초대 코드입니다.",
  expired: "만료된 초대 코드입니다. 관리자에게 재발급을 요청하세요.",
};

export default async function InviteCodePage({ params }: { params: Promise<{ code: string }> }) {
  await ready();
  const { code } = await params;
  const norm = code.trim().toUpperCase();
  const lookup = await getInviteByCode(norm);

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 20 }}>
      <div
        style={{
          width: "100%", maxWidth: 380, background: "var(--card)", border: "1px solid var(--line)",
          borderRadius: 16, padding: "30px 28px", boxShadow: "0 6px 24px rgba(20,22,30,.06)",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--accent)" }}>StudyCube</div>
        {lookup.ok ? (
          <>
            <h1 style={{ fontSize: 21, fontWeight: 800, marginTop: 8 }}>{lookup.name}님, 환영합니다</h1>
            <p style={{ fontSize: 13.5, color: "var(--sub)", marginTop: 4, marginBottom: 18 }}>
              {lookup.branchName}{lookup.title ? ` · ${lookup.title}` : ""} · 아이디와 비밀번호를 직접 정해 계정을 만드세요.
            </p>
            <InviteForm code={norm} />
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 21, fontWeight: 800, marginTop: 8 }}>초대 코드를 확인해주세요</h1>
            <p style={{ fontSize: 13.5, color: "var(--danger-strong)", marginTop: 4, marginBottom: 6 }}>
              {REASON_LABEL[lookup.reason]}
            </p>
            <p style={{ fontSize: 12.5, color: "var(--sub)" }}>코드를 발급한 관리자에게 문의하세요.</p>
          </>
        )}
      </div>
    </main>
  );
}
