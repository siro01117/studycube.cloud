"use client";

// 마운트됐다 = 클라이언트 번들이 살아서 하이드레이션이 실제로 끝났다는 뜻.
// f/layout.tsx 의 복구 스크립트가 window.__scHydrated 를 보고 새로고침 여부를 판단한다.
import { useEffect } from "react";

declare global {
  interface Window {
    __scHydrated?: boolean;
  }
}

export default function HydrationMarker() {
  useEffect(() => {
    window.__scHydrated = true;
  }, []);

  return null;
}
