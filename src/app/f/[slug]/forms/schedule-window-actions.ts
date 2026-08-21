"use server";

// 스케쥴 폼(sch9m2vt.tsx) 전용 — 진입 시 "지금 열려있는지" 서버에 묻는다. 화면을 열림/잠김으로
// 분기하는 판정만 담당하고, 실제 저장은 여전히 f/actions.ts 의 submitForm(그 안에서도 다시 재판정).
// 본인확인은 submitForm 과 동일한 원칙 — 세션에 저장된 studentId 를 신뢰하지 않고 이름+코드로 다시 찾는다.
import { db } from "@/lib/db";
import { ready } from "@/lib/bootstrap";
import { findStudent, publicAuthError } from "@/lib/public-auth";
import { resolveEditState } from "@/lib/schedule-window-server";
import type { EditState } from "@/lib/schedule-window";

const s = (v: FormDataEntryValue | null): string => String(v ?? "").trim();

async function branchId(): Promise<string | null> {
  const r = await db.query<{ id: string }>(`select id from branch where code='HQ' limit 1`);
  return r.rows[0]?.id ?? null;
}

// f/actions.ts validateSchedulePayload 가 검증하는 payload 와 같은 모양(순수 표시용 — 여기서 재검증하지 않는다).
export type SchedulePayloadShape = {
  hours?: { day: number; arrive: number; leave: number }[];
  restDays?: number[];
  academies?: { name: string; days: number[]; start: number; end: number }[];
};

export type ScheduleWindowCheck =
  | { ok: false; error: string; kind?: "identity" }
  | {
      ok: true;
      state: EditState;
      studentName: string;
      isRepeat: boolean;
      lastPayload: SchedulePayloadShape | null;
      /** 마지막 제출의 처리 상태 — 관리자가 검토했는지(반영/반려) 학생이 알 수 있게. 제출한 적 없으면 null. */
      lastStatus: "pending" | "done" | "rejected" | null;
      /** 반려 사유(반려됐을 때만 값이 있을 수 있음). */
      lastNote: string | null;
    };

/** FormData 필드: slug, name, code, (개발전용) test="1". */
export async function checkScheduleWindow(formData: FormData): Promise<ScheduleWindowCheck> {
  await ready();
  const name = s(formData.get("name"));
  const code = s(formData.get("code"));
  const slug = s(formData.get("slug")) || "sch9m2vt";

  // ===== DEV-ONLY: 허브 "테스트로 건너뛰기" 신원 — f/actions.ts submitForm 의 testBypass 와 동일 원칙.
  // NODE_ENV!=production 일 때만, 실제 학생 DB 행 없이 항상 열림으로 취급(빌드 타임 상수라 프로덕션에선
  // 이 분기 자체가 실행되지 않는다). =====
  if (process.env.NODE_ENV !== "production" && s(formData.get("test")) === "1") {
    return { ok: true, state: { open: true, reason: "first" }, studentName: name || "테스트", isRepeat: false, lastPayload: null, lastStatus: null, lastNote: null };
  }

  const match = await findStudent(name, code);
  if (!match.ok) return { ok: false, error: publicAuthError(match.reason), kind: "identity" };

  const branch = await branchId();
  if (!branch) return { ok: false, error: "처리할 수 없습니다. 잠시 후 다시 시도해주세요." };

  const { state, lastPayload, lastStatus, lastNote } = await resolveEditState(branch, match.id, "schedule", slug);
  return {
    ok: true,
    state,
    studentName: match.name,
    isRepeat: match.isRepeat,
    lastPayload: (lastPayload as SchedulePayloadShape | null) ?? null,
    lastStatus,
    lastNote,
  };
}
