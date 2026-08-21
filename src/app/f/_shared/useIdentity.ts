"use client";

// 공개 폼(/f/**) 공용 신원 훅 — 허브에서 StudentGate 로 한 번 확인한 학생 신원을
// sessionStorage 에 보관하고, 이후 폼들이 다시 묻지 않고 읽어서 쓴다.
// sessionStorage 는 탭을 닫으면 사라지는 "이번 방문 동안만" 캐시일 뿐 신뢰 근거가 아니다 —
// 실제 검증은 여전히 제출 시점에 서버(actions.ts 의 submitForm)가 이름+코드로 다시 한다.
// 렌더 중 sessionStorage 접근 금지(서버/클라 첫 렌더 불일치 방지) — 반드시 useEffect 에서
// 읽고 상태로 반영한다. hydrated 가 true 가 되기 전에는 identity 를 항상 null 로 취급할 것.
import { useCallback, useEffect, useState } from "react";
import type { StudentIdentity } from "./StudentGate";

const STORAGE_KEY = "f:identity";

export type StoredIdentity = StudentIdentity & {
  _test?: boolean; // true = 개발 전용 "테스트로 건너뛰기" 로 만든 임시 신원(실제 학생 아님)
};

function readStorage(): StoredIdentity | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p.name !== "string" || typeof p.code !== "string" || typeof p.studentId !== "string" || typeof p.studentName !== "string") {
      return null;
    }
    // isRepeat 없는 옛 세션 신원(필드 추가 전에 저장된 값)은 재학생 기본값(false)으로 간주.
    return { name: p.name, code: p.code, studentId: p.studentId, studentName: p.studentName, isRepeat: p.isRepeat === true, _test: p._test === true };
  } catch {
    return null;
  }
}

export function useIdentity() {
  const [identity, setIdentityState] = useState<StoredIdentity | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setIdentityState(readStorage());
    setHydrated(true);
  }, []);

  const save = useCallback((next: StoredIdentity) => {
    setIdentityState(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 저장 실패(프라이빗 모드 등)해도 메모리 상태는 유지 — 최소한 이번 화면 전환까지는 쓸 수 있다.
    }
  }, []);

  const clear = useCallback(() => {
    setIdentityState(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // no-op
    }
  }, []);

  return { identity, hydrated, save, clear };
}
