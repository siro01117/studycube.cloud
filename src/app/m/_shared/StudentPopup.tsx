"use client";

// 학생 상세 팝업(좌석 배치도·학생 관리 공용). 내부 UI + 입·퇴실 기록 조회를 모두 자급.
// 좌석 컨텍스트(자리 비우기·이동 등)는 부모가 actions 슬롯으로 주입.
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { checkIn, checkOut, undoLastEvent, getAttendanceEvents } from "@/app/m/seat/attendanceActions";

export type PopupStudent = {
  id: string; name: string; level: string | null; grade: string | null; is_repeat: boolean | null;
  school: string | null; birthdate: string | null;
  guardian_phone: string | null; student_phone: string | null; enrolled_at: string | null;
};

export function lbl(s: Pick<PopupStudent, "level" | "grade" | "is_repeat">): string {
  if (s.level === "adult") return s.is_repeat ? "성인·N수생" : "성인";
  const lv = s.level === "middle" ? "중" : s.level === "high" ? "고" : "";
  return lv && s.grade ? `${lv}${s.grade}` : lv || s.grade || "";
}

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ageFrom(bd: string | null): number | null {
  if (!bd) return null;
  const b = new Date(bd);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a;
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--faint)" }}>{k}</div>
      <div style={{ fontWeight: 600, marginTop: 1 }}>{v}</div>
    </div>
  );
}

const XIcon = () => (
  <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" }}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export default function StudentPopup({
  student, seatLabel, canManage, canAttend, onClose, actions,
}: {
  student: PopupStudent;
  seatLabel: string | null;   // 예: "1번" / null(미배정)
  canManage: boolean;
  canAttend: boolean;
  onClose: () => void;
  actions?: ReactNode;        // 좌·하단 액션 버튼(컨텍스트별)
}) {
  const [attDate, setAttDate] = useState(todayLocal());
  const [attEvents, setAttEvents] = useState<{ kind: string; auto: boolean; at: string }[]>([]);
  const [tick, setTick] = useState(0);
  const [pending, start] = useTransition();

  const call = (action: (fd: FormData) => Promise<unknown>, fields: Record<string, string>) => {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.set(k, v));
    start(async () => { await action(fd); setTick((t) => t + 1); });
  };

  useEffect(() => {
    let live = true;
    getAttendanceEvents(student.id, attDate).then((rows) => { if (live) setAttEvents(rows); }).catch(() => {});
    return () => { live = false; };
  }, [student.id, attDate, tick]);

  const isToday = attDate === todayLocal();

  return (
    <>
      {/* 헤더 */}
      <div className="flex items-center justify-between" style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 13, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 18 }}>{student.name[0]}</div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{student.name}</div>
            <div style={{ fontSize: 12.5, color: "var(--dim)" }}>{seatLabel ? `${seatLabel} 좌석` : "미배정"}{lbl(student) ? ` · ${lbl(student)}` : ""}</div>
          </div>
        </div>
        <button onClick={onClose} className="chip" style={{ height: 30, width: 30, padding: 0, justifyContent: "center", cursor: "pointer" }}><XIcon /></button>
      </div>

      {/* 본문 2단 */}
      <div style={{ padding: 20, display: "flex", gap: 20 }}>
        {/* 왼쪽: 정보 + 결제 + 액션 */}
        <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div className="label">학생 정보</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", fontSize: 13.5 }}>
              <Info k="학년" v={lbl(student) || "—"} />
              <Info k="학교" v={student.school || "—"} />
              <Info k="나이" v={ageFrom(student.birthdate) != null ? `만 ${ageFrom(student.birthdate)}세` : "—"} />
              <Info k="첫 등록" v={student.enrolled_at || "—"} />
              <Info k="학생 연락처" v={student.student_phone || "—"} />
              <Info k="보호자 연락처" v={student.guardian_phone || "—"} />
            </div>
          </div>
          <div>
            <div className="label">결제</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px 12px", fontSize: 13.5 }}>
              <Info k="요금제" v="—" />
              <Info k="다음 납부" v="—" />
              <Info k="미납" v="—" />
            </div>
            <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 6 }}>결제 모듈이 붙으면 표시됩니다.</div>
          </div>
          {actions && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 14, marginTop: "auto" }}>
              {actions}
            </div>
          )}
        </div>

        {/* 오른쪽: 입·퇴실 기록 */}
        <div style={{ flex: "0 0 232px", borderLeft: "1px solid var(--line)", paddingLeft: 18, display: "flex", flexDirection: "column", minHeight: 300 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "var(--faint)", fontWeight: 700 }}>입·퇴실 기록</span>
            {canAttend && attEvents.length > 0 && isToday && (
              <button onClick={() => call(undoLastEvent, { studentId: student.id, date: attDate })} disabled={pending} className="chip" style={{ height: 22, fontSize: 11, cursor: "pointer", color: "var(--danger)" }}>마지막 취소</button>
            )}
          </div>
          <input type="date" className="input" value={attDate} onChange={(e) => setAttDate(e.target.value)} style={{ height: 36, fontSize: 13, marginBottom: 10 }} />
          <div style={{ flex: 1, overflowY: "auto", maxHeight: 260 }}>
            {attEvents.length === 0 ? (
              <div style={{ color: "var(--faint)", fontSize: 12.5, padding: "10px 2px" }}>기록 없음</div>
            ) : (
              attEvents.map((e, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 2px", borderTop: i ? "1px solid var(--line)" : "none" }}>
                  <span style={{ width: 34, fontSize: 12.5, fontWeight: 800, color: e.kind === "in" ? "var(--ok)" : "var(--dim)" }}>{e.kind === "in" ? "입실" : "퇴실"}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{new Date(e.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
                  <span style={{ fontSize: 11, color: "var(--faint)", marginLeft: "auto" }}>{e.auto ? "자동" : "수동"}</span>
                </div>
              ))
            )}
          </div>
          {canAttend && isToday && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
              <button className="btn btn-accent" disabled={pending} onClick={() => call(checkIn, { studentId: student.id })} style={{ height: 36, fontSize: 12.5 }}>입실</button>
              <button className="btn" disabled={pending} onClick={() => call(checkOut, { studentId: student.id })} style={{ height: 36, fontSize: 12.5 }}>퇴실</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
