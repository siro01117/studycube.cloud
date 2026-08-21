"use server";

// StudentGate.tsx(클라이언트 컴포넌트)가 findStudent 를 서버 액션(RPC)으로 직접 호출하기 위한 래퍼.
// dev 저장소에서는 apply/actions.ts 가 이미 "use server" 모듈이라 그 findStudent 를 클라에서 바로
// import 할 수 있었지만, apply/** 는 배포 클론에 이관하지 않으므로 이 파일이 그 역할을 대신한다.
// 실제 로직은 여전히 src/lib/public-auth.ts(server-only) 하나에만 있다 — 여기서는 얇은 async 래퍼만
// 둔다("use server" 파일은 async 함수만 export 할 수 있어 단순 재-export 는 불가).
import { findStudent as findStudentImpl } from "./public-auth";

export async function findStudent(
  name: string,
  code: string,
): ReturnType<typeof findStudentImpl> {
  return findStudentImpl(name, code);
}
