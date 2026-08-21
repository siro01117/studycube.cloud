// requiresStudent 폼 공용 — 제출 시 서버 재검증(submitForm)이 실패했을 때 보여주는 화면.
// 세션에 저장해둔 신원은 이미 지운 상태로 이 화면을 띄운다(호출부에서 useIdentity().clear() 먼저).
import Link from "next/link";

export default function IdentityExpired({ hubSlug }: { hubSlug: string }) {
  return (
    <div style={{ textAlign: "center", padding: "24px 4px 4px" }}>
      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>본인 확인이 만료됐어요</div>
      <div style={{ fontSize: 13, color: "var(--dim)", lineHeight: 1.6, marginBottom: 20 }}>
        허브에서 다시 확인한 뒤 이어서 진행해주세요.
      </div>
      <Link
        href={`/f/${hubSlug}`}
        className="btn btn-accent"
        style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, textDecoration: "none" }}
      >
        허브로 돌아가기
      </Link>
    </div>
  );
}
