"use client";

// 조회 전용 공개 폼(내 출결/내 벌점/내 시간표) 공용 셸 — 신원 가드, 서버액션 1회 호출, loading/expired/
// error/testBypass 4갈래 렌더 스위치를 여기 한 곳에 모은다. myat4wkd.tsx/mypt9rxb.tsx/myts7fq2.tsx 가
// 거의 글자 그대로 복붙하던 부분(-140줄 목표, 3중복→1) — 각 폼은 서버액션 + "데이터 있을 때 렌더" 함수 +
// "테스트 신원" 안내 문구만 넘긴다. Section/EmptySection/InfoIcon 도 3파일 완전 동일이라 여기로 옮겼다.
import { useEffect, useState } from "react";
import FormShell from "./FormShell";
import IdentityExpired from "./IdentityExpired";
import { useIdentity, useRedirectIfNoIdentity } from "./useIdentity";
import { getHubSlug } from "../registry";
import type { FormDef } from "../registry";

/** 3개 조회 폼의 서버액션 결과가 공통으로 따르는 모양: 성공 시 testBypass(테스트 신원=데이터 없음)
 * 플래그를 포함한 Ok, 실패 시 error(+ kind:"identity" 면 신원 만료로 처리). T는 각 폼의
 * XxxOverviewResult 타입을 그대로 넘기면 된다(예: Extract<AttendanceOverviewResult, {ok:true}>). */
export default function ReadOnlyInfoShell<Ok extends { ok: true; testBypass: boolean }>({
  def,
  fetchResult,
  noDataText,
  children,
}: {
  def: FormDef;
  fetchResult: (fd: FormData) => Promise<Ok | { ok: false; error: string; kind?: "identity" }>;
  noDataText: string;
  children: (result: Ok) => React.ReactNode;
}) {
  const { identity, hydrated, clear } = useIdentity();
  const hubSlug = getHubSlug();
  useRedirectIfNoIdentity(hydrated, identity, hubSlug);

  const [result, setResult] = useState<Ok | { ok: false; error: string; kind?: "identity" } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!hydrated || !identity) return;
    let alive = true;
    setLoading(true);
    const fd = new FormData();
    fd.set("slug", def.slug);
    fd.set("name", identity.name);
    fd.set("code", identity.code);
    if (identity._test) fd.set("test", "1");
    fetchResult(fd).then((r) => {
      if (!alive) return;
      if (!r.ok && r.kind === "identity") {
        clear();
        setExpired(true);
      } else {
        setResult(r);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, identity?.name, identity?.code, def.slug]);

  return (
    <FormShell title={def.title} subtitle={def.desc} maxWidth={480} backHref={`/f/${hubSlug}`}>
      {!hydrated || !identity ? null : expired ? (
        <IdentityExpired hubSlug={hubSlug} />
      ) : loading || !result ? (
        <div style={{ fontSize: 15, color: "var(--dim)", textAlign: "center", padding: "24px 4px" }}>불러오는 중…</div>
      ) : !result.ok ? (
        <div style={{ fontSize: 15, color: "var(--danger)", fontWeight: 600, textAlign: "center", padding: "24px 4px" }}>{result.error}</div>
      ) : result.testBypass ? (
        <NoDataNotice text={noDataText} />
      ) : (
        children(result)
      )}
    </FormShell>
  );
}

function NoDataNotice({ text }: { text: string }) {
  return (
    <div style={{ textAlign: "center", padding: "28px 4px 8px" }}>
      <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--panel2)", color: "var(--dim)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
        <InfoIcon />
      </div>
      <div style={{ fontSize: 15.5, fontWeight: 800, marginBottom: 8 }}>테스트 신원에는 데이터가 없어요</div>
      <div style={{ fontSize: 15, color: "var(--dim)", lineHeight: 1.6 }}>{text}</div>
    </div>
  );
}

export function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 15.5, fontWeight: 800, marginBottom: desc ? 2 : 10 }}>{title}</div>
      {desc && <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 10 }}>{desc}</div>}
      {children}
    </div>
  );
}

export function EmptySection({ text }: { text: string }) {
  return <div style={{ fontSize: 15, color: "var(--faint)", padding: "12px 4px" }}>{text}</div>;
}

export function InfoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
