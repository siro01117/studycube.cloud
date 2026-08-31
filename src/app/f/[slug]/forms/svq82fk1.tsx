"use client";

// 새 설문 추가하는 법(5줄 이내):
// 1) ../../registry.ts 의 FORMS 에 새 FormDef 추가(슬러그는 추측 불가 영숫자 6~10자).
// 2) 이 파일처럼 forms/<슬러그>.tsx 를 새로 만든다 — requiresStudent 면 StudentGate 로 감싸고
//    그 안에서 FormShell + 질문 UI를 직접 짠다(빌더 없음, 화면은 설문마다 손으로).
// 3) 제출은 ../../actions.ts 의 submitForm(FormData) 하나로 통일 — slug/payload(JSON)/name+code 를 담아 호출.
// 4) forms/index.ts 의 FORM_COMPONENTS 에 { 슬러그: 컴포넌트 } 매핑을 추가하면 끝.
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import FormShell from "../../_shared/FormShell";
import IdentityExpired from "../../_shared/IdentityExpired";
import { useIdentity, useRedirectIfNoIdentity, type StoredIdentity } from "../../_shared/useIdentity";
import { submitForm } from "../../actions";
import { getHubSlug } from "../../registry";
import type { FormDef } from "../../registry";

const CHOICES = ["매우 만족", "만족", "보통", "불만족"];

export default function SurveySample({ def }: { def: FormDef }) {
  const { identity, hydrated, clear } = useIdentity();
  const hubSlug = getHubSlug();
  // 신원 없이(=허브를 거치지 않고) 폼 주소로 바로 들어온 경우 허브로 보낸다.
  useRedirectIfNoIdentity(hydrated, identity, hubSlug);
  // 답변 중인 내용이 있는지(SurveyBody 가 onDirtyChange 로 올려준다) — 상단 "‹ 홈" 확인 여부에 쓰인다.
  const [dirty, setDirty] = useState(false);

  return (
    <FormShell title={def.title} subtitle={def.intro} backHref={`/f/${hubSlug}`} confirmLeave={dirty}>
      {!hydrated || !identity ? null : (
        <SurveyBody def={def} identity={identity} onExpired={clear} hubSlug={hubSlug} onDirtyChange={setDirty} />
      )}
    </FormShell>
  );
}

function SurveyBody({
  def,
  identity,
  onExpired,
  hubSlug,
  onDirtyChange,
}: {
  def: FormDef;
  identity: StoredIdentity;
  onExpired: () => void;
  hubSlug: string;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [step, setStep] = useState<"form" | "done" | "expired">("form");
  const [q1, setQ1] = useState(""); // 단답
  const [q2, setQ2] = useState<string | null>(null); // 단일선택
  const [q3, setQ3] = useState(""); // 장문
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    onDirtyChange(step === "form" && (q1.trim() !== "" || q2 !== null || q3.trim() !== ""));
  }, [step, q1, q2, q3, onDirtyChange]);

  if (step === "expired") {
    return <IdentityExpired hubSlug={hubSlug} />;
  }

  if (step === "done") {
    return (
      <div style={{ textAlign: "center", padding: "12px 4px 4px" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
          <CheckIcon />
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>제출 완료</div>
        <div style={{ fontSize: 13, color: "var(--dim)", marginBottom: 20 }}>{identity.studentName} 학생, 소중한 의견 감사합니다.</div>
        <Link
          href={`/f/${hubSlug}`}
          className="btn btn-accent"
          style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, textDecoration: "none" }}
        >
          홈으로
        </Link>
      </div>
    );
  }

  const submit = () => {
    if (!q1.trim() || !q2 || !q3.trim()) {
      setErr("모든 항목을 입력해주세요.");
      return;
    }
    setErr(null);
    const fd = new FormData();
    fd.set("slug", def.slug);
    fd.set("name", identity.name);
    fd.set("code", identity.code);
    if (identity._test) fd.set("test", "1"); // DEV-ONLY: 서버가 NODE_ENV!=production 일 때만 받아준다.
    fd.set("payload", JSON.stringify({ "한줄_좋았던점": q1.trim(), "만족도": q2, "자유의견": q3.trim() }));
    start(async () => {
      const r = await submitForm(fd);
      if (r.ok) setStep("done");
      else if (r.kind === "identity") {
        onExpired();
        setStep("expired");
      } else setErr(r.error);
    });
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: "var(--sub)", marginBottom: 18, display: "flex", alignItems: "center", gap: 6 }}>
        <UserIcon />
        {identity.studentName} 학생으로 확인되었어요.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <label>
          <span className="label">1. 가장 만족스러운 점 한 줄로</span>
          <input
            className="input"
            value={q1}
            onChange={(e) => setQ1(e.target.value)}
            onBlur={(e) => setQ1(e.currentTarget.value.trim())}
            placeholder="예: 조용한 분위기"
          />
        </label>

        <div>
          <span className="label">2. 전반적인 만족도</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {CHOICES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={q2 === c}
                onClick={() => setQ2(c)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  height: 46,
                  padding: "0 14px",
                  borderRadius: 12,
                  border: `1px solid ${q2 === c ? "var(--accent)" : "var(--line)"}`,
                  background: q2 === c ? "var(--accent-soft)" : "var(--card)",
                  color: "var(--ink)",
                  fontSize: 14.5,
                  fontWeight: q2 === c ? 700 : 500,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <RadioDot on={q2 === c} />
                {c}
              </button>
            ))}
          </div>
        </div>

        <label>
          <span className="label">3. 더 나아졌으면 하는 점(자유롭게)</span>
          <textarea
            className="input"
            value={q3}
            onChange={(e) => setQ3(e.target.value)}
            onBlur={(e) => setQ3(e.currentTarget.value.trim())}
            placeholder="편하게 적어주세요"
            rows={4}
            style={{ height: "auto", minHeight: 96, padding: "12px 14px", resize: "vertical", lineHeight: 1.5 }}
          />
        </label>

        {err && <div style={{ fontSize: 12.5, color: "var(--danger)", fontWeight: 600 }}>{err}</div>}

        <button className="btn btn-accent" disabled={pending} onClick={submit} style={{ height: 50, fontSize: 15, fontWeight: 700 }}>
          {pending ? "제출 중…" : "제출하기"}
        </button>
      </div>
    </div>
  );
}

function RadioDot({ on }: { on: boolean }) {
  return (
    <span
      style={{
        width: 18, height: 18, borderRadius: "50%", flex: "none",
        border: `2px solid ${on ? "var(--accent)" : "var(--line)"}`,
        display: "grid", placeItems: "center",
      }}
    >
      {on && <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--accent)" }} />}
    </span>
  );
}
function CheckIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
