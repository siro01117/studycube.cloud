export default function Loading() {
  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{ background: "var(--sc-bg)" }}
    >
      {/* 큐브 로고 애니메이션 — 테마별 로고 파일 전환 */}
      <div style={{ animation: "sc-pulse 1.6s ease-in-out infinite" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/dark_logo.png"
          alt="StudyCUBE"
          width={72}
          height={72}
          className="sc-logo-dark"
          style={{ width: 72, height: 72, objectFit: "contain" }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/lite_logo.png"
          alt="StudyCUBE"
          width={72}
          height={72}
          className="sc-logo-lite"
          style={{ width: 72, height: 72, objectFit: "contain" }}
        />
      </div>

      {/* 로고 텍스트 */}
      <p
        className="mt-5 font-black tracking-widest"
        style={{ color: "var(--sc-dim)", letterSpacing: "0.2em", fontSize: 18 }}
      >
        Study<span style={{ color: "var(--sc-green)" }}>CUBE</span>
      </p>

      {/* 로딩 바 */}
      <div
        className="mt-7 rounded-full overflow-hidden"
        style={{ width: 100, height: 2.5, background: "var(--sc-border)" }}
      >
        <div
          style={{
            height: "100%",
            background: "var(--sc-green)",
            borderRadius: 9999,
            animation: "sc-bar 1.6s ease-in-out infinite",
          }}
        />
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        html.dark .sc-logo-dark { display: block; }
        html.dark .sc-logo-lite { display: none; }
        html:not(.dark) .sc-logo-dark { display: none; }
        html:not(.dark) .sc-logo-lite { display: block; }
        @keyframes sc-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.6; transform: scale(0.92); }
        }
        @keyframes sc-bar {
          0%   { width: 0%;   margin-left: 0%; }
          50%  { width: 60%;  margin-left: 20%; }
          100% { width: 0%;   margin-left: 100%; }
        }
      ` }} />
    </div>
  );
}
