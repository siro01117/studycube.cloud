export default function Loading() {
  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{ background: "var(--sc-bg)" }}
    >
      {/* 큐브 아이콘 애니메이션 */}
      <div style={{ animation: "sc-pulse 1.6s ease-in-out infinite" }}>
        <svg width="48" height="48" viewBox="0 0 28 28" fill="none">
          <polygon
            points="14,3 25,9 25,21 14,27 3,21 3,9"
            stroke="#00FF85"
            strokeWidth="1.6"
            fill="none"
            strokeLinejoin="round"
            style={{ animation: "sc-draw 1.6s ease-in-out infinite" }}
          />
          <polyline
            points="3,9 14,15 25,9"
            stroke="#00FF85"
            strokeWidth="1.6"
            fill="none"
            strokeLinejoin="round"
          />
          <line
            x1="14" y1="15" x2="14" y2="27"
            stroke="#00FF85"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* 로고 텍스트 */}
      <p
        className="mt-4 text-sm font-black tracking-widest"
        style={{ color: "var(--sc-dim)", letterSpacing: "0.2em" }}
      >
        Study<span style={{ color: "var(--sc-green)" }}>CUBE</span>
      </p>

      {/* 로딩 바 */}
      <div
        className="mt-6 rounded-full overflow-hidden"
        style={{ width: 80, height: 2, background: "var(--sc-border)" }}
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

      <style>{`
        @keyframes sc-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.6; transform: scale(0.92); }
        }
        @keyframes sc-bar {
          0%   { width: 0%;   margin-left: 0%; }
          50%  { width: 60%;  margin-left: 20%; }
          100% { width: 0%;   margin-left: 100%; }
        }
      `}</style>
    </div>
  );
}
