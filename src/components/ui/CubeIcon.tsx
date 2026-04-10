"use client";

import { useState, useEffect } from "react";

function useDarkMode(): boolean {
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains("dark"));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

/**
 * StudyCUBE 로고 아이콘 — 테마별 로고 파일 사용 (필터 없음)
 * 다크: dark_logo.png (형광 그린)
 * 라이트: lite_logo.png (매트 그린)
 */
export default function CubeIcon({ size = 24 }: { size?: number }) {
  const isDark = useDarkMode();

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={isDark ? "/dark_logo.png" : "/lite_logo.png"}
      alt="StudyCUBE"
      width={size}
      height={size}
      style={{
        width:      size,
        height:     size,
        objectFit:  "contain",
        transition: "opacity 0.3s ease",
      }}
    />
  );
}
