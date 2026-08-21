import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getForm, getHubSlug } from "../registry";
import { ready } from "@/lib/bootstrap";
import FormShell from "../_shared/FormShell";
import Hub from "../_shared/Hub";
import { FORM_COMPONENTS } from "./forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const def = getForm(slug);
  return {
    title: def ? `${def.title} · 스터디큐브` : "설문 · 스터디큐브",
    // 학생 개인 데이터가 걸린 공개 폼 — 검색 노출 차단(robots.ts 의 /f/ disallow 와 별개로 페이지 단위 명시).
    robots: { index: false, follow: false },
  };
}

export default async function FormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const def = getForm(slug);
  if (!def) notFound();
  await ready();

  // 허브(설문 선택 화면) — 폼 레지스트리 매핑을 거치지 않고 별도 화면을 렌더.
  if (def.type === "hub") return <Hub />;

  if (!def.open) {
    const hubSlug = getHubSlug();
    return (
      <FormShell title={def.title} backHref={`/f/${hubSlug}`}>
        <div style={{ textAlign: "center", padding: "28px 4px 8px" }}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>접수가 마감되었습니다</div>
          <div style={{ fontSize: 13, color: "var(--dim)", lineHeight: 1.6, marginBottom: 20 }}>문의사항은 학원으로 연락해주세요.</div>
          <Link
            href={`/f/${hubSlug}`}
            className="btn btn-accent"
            style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, textDecoration: "none" }}
          >
            홈으로
          </Link>
        </div>
      </FormShell>
    );
  }

  // 정적 매핑(동적 import 문자열 조합 금지) — 등록됐지만 화면이 아직 없으면 404.
  const Comp = FORM_COMPONENTS[def.slug];
  if (!Comp) notFound();
  return <Comp def={def} />;
}
