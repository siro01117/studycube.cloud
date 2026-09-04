"use client";

// 학생 목록 + 즉시 검색. 재원/휴원 탭. 행 전체 클릭(또는 Enter) → 상세 화면(/m/student/[id]) 이동,
// 우클릭·꾹누르기 → 컨텍스트 메뉴(빠른 정보 팝업·휴원/복귀). 추가 = 팝업 폼.
// 재원 탭 + 검색어 없음일 때만 교실(room)별로 묶어 접고 펼 수 있다 — 검색·휴원 탭처럼 이미 걸러진
// 목록에 접힌 묶음까지 씌우면 오히려 찾기 방해라 그때는 평평한 목록으로 되돌린다.
import { useEffect, useMemo, useState, useTransition } from "react";
import { addStudent, setStudentStatus, deleteStudent, issueAccessCodes } from "./actions";
import { getAccessCodeSmsCandidates, sendAccessCodeSms, type SmsCandidate, type SmsTemplateInfo } from "./smsActions";
import { releaseSeat } from "../seat/actions";
import { levelLabel, STU_STATUS, type Student } from "./util";
import StudentPopup, { ReleaseSeatIcon } from "../_shared/StudentPopup";
import ContextMenu, { type MenuItem } from "../_shared/ContextMenu";
import { useLongPress } from "../_shared/useLongPress";
import { useSort, SortPicker, type SortColumn } from "../_shared/sort";
import Modal from "../_shared/Modal";
import SmsBatchSendModal from "../sms/SmsBatchSendModal";
import Link from "next/link";

// 정렬 가능한 속성: 좌석번호 / 이름 / 구분(학년·N수) / 상태(재원·휴원) / 등록일 / 코드 발급 여부.
const SORT_COLUMNS: SortColumn<Student>[] = [
  { key: "seat", label: "좌석", sortValue: (s) => s.seat_number, type: "number" },
  { key: "name", label: "이름", sortValue: (s) => s.name },
  { key: "level", label: "구분", sortValue: (s) => levelLabel(s) },
  { key: "status", label: "상태", sortValue: (s) => STU_STATUS[s.status] ?? s.status },
  { key: "enrolled", label: "등록일", sortValue: (s) => s.enrolled_at },
  { key: "code", label: "코드 발급 여부", sortValue: (s) => (s.access_code ? "발급" : "미발급") },
];

// 행 끝 '상세 보기' 화살표 — 이제 행 전체가 링크라 장식용(누를 수 있다는 신호만, 클릭 대상 아님).
const RowChevron = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" style={{ width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", flex: "none" }}>
    <path d="M6 3.5l5 4.5-5 4.5" />
  </svg>
);

// 교실 묶음 접힘/펼침 화살표 — 펼쳐지면 아래(세로), 접히면 오른쪽(가로)을 가리킨다.
const RoomChevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" style={{ width: 13, height: 13, fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", flex: "none", transition: "transform .12s ease", transform: open ? "rotate(90deg)" : "none" }}>
    <path d="M6 3.5l5 4.5-5 4.5" />
  </svg>
);

export default function StudentList({
  students, canEdit, canAttend, canManageSeat, canSms,
}: {
  students: Student[];
  canEdit: boolean;
  canAttend: boolean;
  canManageSeat: boolean;
  canSms: boolean;
}) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"enrolled" | "leave">("enrolled");
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; s: Student } | null>(null);
  const [codeMsg, setCodeMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // 링크·로그인 코드 안내 문자 — 열 때 후보(코드 발급된 재원생)+템플릿을 불러온다(모달이 직접, 여기선
  // 열림 상태와 불러온 데이터만 들고 있는다).
  const [smsModalOpen, setSmsModalOpen] = useState(false);
  const [smsData, setSmsData] = useState<{ candidates: SmsCandidate[]; tmpl: SmsTemplateInfo; branchName: string; loginUrl: string } | null>(null);
  const openSmsModal = () => {
    setSmsModalOpen(true);
    setSmsData(null);
    getAccessCodeSmsCandidates().then(setSmsData).catch(() => setSmsData({ candidates: [], tmpl: { title: "", body: "", enabled: false }, branchName: "", loginUrl: "" }));
  };

  const openStudent = (id: string | null) => { setConfirmDel(false); setOpenId(id); };
  // 터치 꾹누르기 = 행 컨텍스트 메뉴(우클릭 대체)
  const rowLP = useLongPress<Student>((s, x, y) => { if (canEdit) setRowMenu({ x, y, s }); });
  // '휴원'이 아닌 상태는 전부 재원 탭으로(레거시 withdrawn 방어)
  const inTab = (s: Student) => (tab === "leave" ? s.status === "leave" : s.status !== "leave");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return students
      .filter(inTab)
      .filter((s) => {
        if (!needle) return true;
        return (
          s.name.toLowerCase().includes(needle) ||
          (s.school ?? "").toLowerCase().includes(needle) ||
          levelLabel(s).toLowerCase().includes(needle) ||
          (s.guardian_phone ?? "").includes(needle) ||
          (s.student_phone ?? "").includes(needle) ||
          String(s.seat_number ?? "").includes(needle) ||
          (s.room_name ?? "").toLowerCase().includes(needle)
        );
      });
  }, [students, q, tab]);

  // 정렬 상태는 화면(student-list)별로 localStorage 에 유지 — 기본값은 기존 쿼리 순서(이름 오름차순, page.tsx `order by s.name`)와 동일하게 둔다.
  const { sorted: list, sortKey, sortDir, requestSort } = useSort(filtered, SORT_COLUMNS, "name", "student-list");

  // 교실별 묶음은 재원 탭 + 검색어 없을 때만. 검색이나 휴원 탭은 이미 좁혀진 목록이라 묶음이 오히려 방해.
  const groupable = tab === "enrolled" && q.trim() === "";
  const groups = useMemo(() => {
    if (!groupable) return null;
    const byRoom = new Map<string, { key: string; label: string; floor: number | null; students: Student[] }>();
    for (const s of list) {
      const key = s.room_id ?? "__unassigned__";
      let g = byRoom.get(key);
      if (!g) {
        g = { key, label: s.room_id ? (s.room_name ?? "이름 없는 교실") : "좌석 미배정", floor: s.room_floor, students: [] };
        byRoom.set(key, g);
      }
      g.students.push(s);
    }
    return Array.from(byRoom.values()).sort((a, b) => {
      if (a.key === "__unassigned__") return 1; // 미배정은 항상 맨 아래
      if (b.key === "__unassigned__") return -1;
      if ((a.floor ?? 0) !== (b.floor ?? 0)) return (a.floor ?? 0) - (b.floor ?? 0);
      return a.label.localeCompare(b.label, "ko");
    });
  }, [groupable, list]);

  // 펼침 상태 — 화면(student-rooms)별로 localStorage 에 유지(정렬 상태와 같은 관례, sort.tsx 참고).
  // 기본값은 "전부 접힘"(집주인 지시: 처음 들어오면 교실 목록만 보이는 게 근무자에게 빠르다) —
  // 그래서 이 Set 은 "펼친 적 있는 교실" 키만 담는다(과거엔 반대로 "접은 교실"을 담아 기본 펼침
  // 이었다). 저장 키(sc-collapse:student-rooms)는 그대로 두고 의미만 뒤집었다 — 한 번이라도 편
  // 교실은 이 Set 에 남아 다음에도 펴져 있고, 건드린 적 없는 교실은 기본값(접힘)으로 보인다.
  // 마운트 이후에만 읽는다(SSR/hydration 안전 — sort.tsx 와 동일 이유. 초기 렌더는 서버·클라 모두
  // 빈 Set = 전부 접힘으로 일치해야 hydration 이 깨지지 않는다).
  const [opened, setOpened] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("sc-collapse:student-rooms");
      if (raw) setOpened(new Set(JSON.parse(raw) as string[]));
    } catch {
      // 저장값이 깨졌으면 전부 접힌 기본값 그대로.
    }
  }, []);
  const toggleRoom = (key: string) => {
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try {
        window.localStorage.setItem("sc-collapse:student-rooms", JSON.stringify(Array.from(next)));
      } catch {
        // 저장 실패(프라이빗 모드 등)는 무시 — 이번 세션 동안만 펼침이 유지된다.
      }
      return next;
    });
  };

  const enrolledCount = students.filter((s) => s.status !== "leave").length;
  const leaveCount = students.filter((s) => s.status === "leave").length;
  const open = students.find((s) => s.id === openId) ?? null;

  const changeStatus = (id: string, status: string) => {
    const fd = new FormData();
    fd.set("id", id); fd.set("status", status);
    start(async () => { await setStudentStatus(fd); });
  };
  const doRelease = (seatId: string) => {
    const fd = new FormData();
    fd.set("seatId", seatId);
    start(async () => { await releaseSeat(fd); openStudent(null); });
  };
  const doDelete = (id: string) => {
    const fd = new FormData();
    fd.set("id", id);
    start(async () => { await deleteStudent(fd); openStudent(null); });
  };

  // 학생 한 명 = 목록의 한 행. 행 전체가 상세 화면(/m/student/[id])으로 가는 링크다 — 근무자가
  // 카운터에서 급히 찾을 때 좁은 화살표 한 개보다 줄 전체를 누르는 편이 훨씬 크고 직관적이라 판단
  // (근거는 파일 상단 주석 및 보고 참고). 빠른 정보 팝업(재원/휴원 전환·좌석 비우기 등)은 우클릭·
  // 꾹누르기 컨텍스트 메뉴로 남겨 링크 클릭과 겹치지 않게 분리했다.
  const renderRow = (s: Student) => {
    const lv = levelLabel(s);
    return (
      <Link
        key={s.id}
        href={`/m/student/${s.id}`}
        className="touchable student-row"
        {...rowLP.bind(s)}
        onClick={(e) => { if (rowLP.consumed()) e.preventDefault(); }}
        onContextMenu={canEdit ? (e) => { e.preventDefault(); setRowMenu({ x: e.clientX, y: e.clientY, s }); } : undefined}
        title={`${s.name} 상세 보기`}
        style={{
          display: "grid",
          gridTemplateColumns: "56px 1fr 20px",
          alignItems: "center",
          gap: 10,
          padding: "12px 8px",
          borderTop: "1px solid var(--line)",
          cursor: "pointer",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        {/* 좌석 번호 */}
        <span style={{ fontSize: 13, fontWeight: 800, color: s.seat_number != null ? "var(--accent)" : "var(--sub)", fontVariantNumeric: "tabular-nums" }}>
          {s.seat_number != null ? s.seat_number : "—"}
        </span>

        {/* 이름 · 학년 · 학교 — 같은 행 동작(상세 보기)과 붙어 있으니 여기서 눈이 더 움직일 일이 없다 */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {s.name}
            {lv && <span style={{ fontSize: 12, color: "var(--sub)", fontWeight: 500, marginLeft: 6 }}>{lv}</span>}
            {s.school && <span style={{ fontSize: 12, color: "var(--sub)", marginLeft: 6 }}>{s.school}</span>}
          </div>
          {(s.guardian_phone || s.student_phone) && (
            <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 2 }}>
              {s.student_phone && `학생 ${s.student_phone}`}
              {s.student_phone && s.guardian_phone && " · "}
              {s.guardian_phone && `보호자 ${s.guardian_phone}`}
            </div>
          )}
        </div>

        {/* 누를 수 있다는 신호 — 장식용(행 전체가 링크라 이 화살표 자체는 클릭 대상 아님) */}
        <span className="student-row-chevron" style={{ display: "grid", placeItems: "center", color: "var(--faint)" }}>
          <RowChevron />
        </span>
      </Link>
    );
  };

  return (
    <div className="card" style={{ padding: 14 }}>
      {/* 상단: 검색 + 추가 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름 · 좌석 · 학교 · 학년 · 연락처 검색"
          aria-label="학생 검색"
          style={{ height: 40, fontSize: 14 }}
        />
        {canEdit && (() => {
          const noCode = students.filter((s) => s.status === "enrolled" && !s.access_code).length;
          return (
            <>
              <button
                className="btn"
                disabled={pending || noCode === 0}
                onClick={() => start(async () => { const r = await issueAccessCodes(); setCodeMsg(`${r.issued}명 코드 발급`); })}
                title="공개 폼(도시락 등) 로그인용 코드를 미발급 재원생에게 부여"
                style={{ height: 40, padding: "0 14px", whiteSpace: "nowrap", flexShrink: 0, fontSize: 13 }}
              >
                {noCode > 0 ? `코드 발급 (${noCode})` : "코드 발급됨"}
              </button>
              {canSms && (
                <button
                  className="btn"
                  onClick={openSmsModal}
                  title="코드가 발급된 재원생에게 링크·로그인 코드 문자를 보냅니다"
                  style={{ height: 40, padding: "0 14px", whiteSpace: "nowrap", flexShrink: 0, fontSize: 13 }}
                >
                  코드 문자 보내기
                </button>
              )}
              <button className="btn btn-accent" onClick={() => setAddOpen(true)} style={{ height: 40, padding: "0 16px", whiteSpace: "nowrap", flexShrink: 0 }}>학생 추가</button>
            </>
          );
        })()}
      </div>
      {codeMsg && <div style={{ fontSize: 12, color: "var(--accent)", marginBottom: 8 }}>{codeMsg}</div>}

      {/* 재원 / 휴원 탭 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        {([["enrolled", "재원", enrolledCount], ["leave", "휴원", leaveCount]] as const).map(([key, label, cnt]) => {
          const on = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                height: 34, padding: "0 14px", borderRadius: 9,
                border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
                background: on ? "var(--accent-soft)" : "transparent",
                color: on ? "var(--accent)" : "var(--sub)",
                fontWeight: on ? 800 : 500, fontSize: 13, cursor: "pointer",
              }}
            >
              {label} <span style={{ fontSize: 12, opacity: 0.8 }}>{cnt}</span>
            </button>
          );
        })}
        <SortPicker columns={SORT_COLUMNS} activeKey={sortKey} dir={sortDir} onSort={requestSort} ariaLabel="학생 목록 정렬 기준" />
        <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--sub)" }}>
          {q ? `검색 ${list.length}명` : `${list.length}명`}
        </span>
      </div>

      {/* 컬럼 헤더 */}
      <div style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: 10, padding: "0 6px 6px", fontSize: 11.5, color: "var(--sub)", fontWeight: 700 }}>
        <span>좌석</span>
        <span>이름 · 학년</span>
      </div>

      {list.length === 0 ? (
        <div style={{ color: "var(--sub)", fontSize: 13, padding: 16, textAlign: "center" }}>
          {q
            ? "검색 결과가 없습니다."
            : tab === "leave"
              ? "휴원 중인 학생이 없습니다."
              : students.length === 0
                ? "등록된 학생이 없습니다. ‘학생 추가’로 등록하세요."
                : "재원 중인 학생이 없습니다."}
        </div>
      ) : groups ? (
        // 교실별 묶음 — 방마다 접힘 헤더 + (접히지 않았으면) 그 방 학생 행들. 좌석 미배정은 항상 맨 아래 묶음.
        <div style={{ display: "flex", flexDirection: "column" }}>
          {groups.map((g, i) => {
            const isOpen = opened.has(g.key);
            // 층이 바뀌는 자리는 제목이 아니라 여백으로 표시한다(DESIGN.md §5) — 같은 층 교실끼리는
            // 붙어 보이고, 층이 바뀌면 위 여백이 커져 그 자리가 경계라는 게 눈에 들어온다.
            const floorBoundary = i > 0 && g.floor !== groups[i - 1].floor;
            return (
              <div key={g.key}>
                <button
                  type="button"
                  className="touchable student-room-header"
                  onClick={() => toggleRoom(g.key)}
                  aria-expanded={isOpen}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    padding: "10px 8px", marginTop: floorBoundary ? 18 : 4,
                    borderTop: "1px solid var(--line)",
                    background: "transparent", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <RoomChevron open={isOpen} />
                  {g.floor != null && (
                    <span style={{ fontSize: 11.5, color: "var(--sub)", fontWeight: 700, fontVariantNumeric: "tabular-nums", flex: "none" }}>{g.floor}층</span>
                  )}
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{g.label}</span>
                  <span style={{ fontSize: 12, color: "var(--sub)", fontVariantNumeric: "tabular-nums" }}>{g.students.length}명</span>
                </button>
                {isOpen && g.students.map((s) => renderRow(s))}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {list.map((s) => renderRow(s))}
        </div>
      )}

      {/* 행 우클릭 컨텍스트 메뉴 */}
      {rowMenu && (
        <ContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          header={rowMenu.s.name}
          items={((): MenuItem[] => {
            const s = rowMenu.s;
            const items: MenuItem[] = [];
            if (s.status === "leave") items.push({ label: "재원 복귀", onClick: () => changeStatus(s.id, "enrolled") });
            else items.push({ label: "휴원 처리", onClick: () => changeStatus(s.id, "leave") });
            items.push({ separator: true });
            items.push({ label: "학생 정보", onClick: () => openStudent(s.id) });
            return items;
          })()}
          onClose={() => setRowMenu(null)}
        />
      )}

      {/* 학생 상세 팝업 (좌석 배치도와 동일) */}
      {open && (
        <Modal
          onClose={() => openStudent(null)}
          backdropBackground="rgba(20,22,30,.45)"
          backdropZIndex={55}
          panelZIndex={56}
          panelStyle={{
            width: 720, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100dvh - 60px)", overflowY: "auto",
            background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "0 24px 70px rgba(20,22,30,.35)",
          }}
        >
            <StudentPopup
              student={open}
              seatLabel={open.seat_number != null ? `${open.seat_number}번` : null}
              accessCode={open.access_code}
              canManage={canManageSeat}
              canAttend={canAttend}
              onClose={() => openStudent(null)}
              actions={<>
                {canManageSeat && open.seat_id && <button className="btn" onClick={() => doRelease(open.seat_id!)} style={{ height: 40, fontSize: 13, gap: 6 }}><ReleaseSeatIcon /> 자리 비우기</button>}
                <a href="/m/seat" className="btn" style={{ height: 40, fontSize: 13, display: "grid", placeItems: "center", textDecoration: "none", gridColumn: canManageSeat && open.seat_id ? "auto" : "1 / -1" }}>
                  {open.seat_number != null ? "좌석 배치도" : "좌석 배치도에서 배정"}
                </a>
                {/* 재원 ↔ 휴원 전환 (우클릭 메뉴 없이도 여기서 바로) */}
                {canEdit && (
                  open.status === "leave" ? (
                    <button
                      className="btn btn-accent"
                      onClick={() => changeStatus(open.id, "enrolled")}
                      style={{ height: 40, fontSize: 13, gridColumn: "1 / -1" }}
                    >
                      재원으로 복귀
                    </button>
                  ) : (
                    <button
                      className="btn"
                      onClick={() => changeStatus(open.id, "leave")}
                      style={{ height: 40, fontSize: 13, gridColumn: "1 / -1" }}
                    >
                      휴원 처리 {open.seat_number != null && <span style={{ color: "var(--sub)", fontWeight: 500 }}>· 좌석 비움</span>}
                    </button>
                  )
                )}
                {canEdit && (
                  confirmDel ? (
                    <>
                      <button className="btn" onClick={() => setConfirmDel(false)} style={{ height: 38, fontSize: 12.5 }}>취소</button>
                      <button className="btn" onClick={() => doDelete(open.id)} style={{ height: 38, fontSize: 12.5, background: "var(--danger)", borderColor: "var(--danger)", color: "#fff" }}>정말 삭제</button>
                    </>
                  ) : (
                    <button className="btn" onClick={() => setConfirmDel(true)} style={{ height: 38, fontSize: 12.5, color: "var(--danger)", gridColumn: "1 / -1" }}>학생 삭제</button>
                  )
                )}
              </>}
            />
        </Modal>
      )}

      {/* 학생 추가 팝업 */}
      {addOpen && canEdit && (
        <Modal
          onClose={() => setAddOpen(false)}
          backdropBackground="rgba(20,22,30,.45)"
          backdropZIndex={60}
          panelZIndex={61}
          panelStyle={{
            width: 440, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100dvh - 60px)", overflowY: "auto",
            background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "0 24px 70px rgba(20,22,30,.35)",
          }}
        >
            <div className="flex items-center justify-between" style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>학생 추가</div>
              <button onClick={() => setAddOpen(false)} className="chip" style={{ height: 30, width: 30, padding: 0, justifyContent: "center", cursor: "pointer" }}>✕</button>
            </div>
            <form action={addStudent} onSubmit={() => setAddOpen(false)} style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label className="label" htmlFor="add-student-name">이름 *</label>
                <input id="add-student-name" className="input" name="name" required aria-required="true" placeholder="홍길동" style={{ height: 42 }} autoFocus />
              </div>
              <div className="flex gap-2">
                <div style={{ flex: 1 }}>
                  <label className="label" htmlFor="add-student-level">구분</label>
                  <select id="add-student-level" className="input" name="level" defaultValue="high" style={{ height: 42 }}>
                    <option value="middle">중학생</option>
                    <option value="high">고등학생</option>
                    <option value="adult">성인</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label" htmlFor="add-student-grade">학년</label>
                  <select id="add-student-grade" className="input" name="grade" defaultValue="" style={{ height: 42 }}>
                    <option value="">–</option>
                    <option value="1">1학년</option>
                    <option value="2">2학년</option>
                    <option value="3">3학년</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <div style={{ flex: 1 }}>
                  <label className="label" htmlFor="add-student-gender">성별</label>
                  <select id="add-student-gender" className="input" name="gender" defaultValue="" style={{ height: 42 }}>
                    <option value="">–</option>
                    <option value="male">남</option>
                    <option value="female">여</option>
                  </select>
                </div>
                <label style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 8, fontSize: 13, color: "var(--sub)", paddingBottom: 10 }}>
                  <input type="checkbox" name="is_repeat" /> 성인·N수생
                </label>
              </div>
              <div>
                <label className="label" htmlFor="add-student-school">학교</label>
                <input id="add-student-school" className="input" name="school" placeholder="○○고등학교" style={{ height: 42 }} />
              </div>
              <div>
                <label className="label" htmlFor="add-student-birthdate">생년월일</label>
                <input id="add-student-birthdate" className="input" name="birthdate" type="date" style={{ height: 42 }} />
              </div>
              <div className="flex gap-2">
                <div style={{ flex: 1 }}>
                  <label className="label" htmlFor="add-student-phone">학생 연락처</label>
                  <input id="add-student-phone" className="input" name="student_phone" placeholder="010-0000-0000" style={{ height: 42 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label" htmlFor="add-student-guardian-phone">보호자 연락처</label>
                  <input id="add-student-guardian-phone" className="input" name="guardian_phone" placeholder="010-0000-0000" style={{ height: 42 }} />
                </div>
              </div>
              <button className="btn btn-accent" style={{ height: 44, marginTop: 4 }}>추가</button>
            </form>
        </Modal>
      )}

      {/* 링크·로그인 코드 안내 문자 — 데이터 로딩 중엔 최소 스켈레톤만(모달 자체는 바로 뜬다) */}
      {smsModalOpen && (
        smsData ? (
          <SmsBatchSendModal
            title="링크·로그인 코드 안내 보내기"
            situationLabel="링크·로그인 코드 안내"
            candidates={smsData.candidates}
            template={smsData.tmpl}
            vars={(c) => ({ 학생이름: c.name, 코드: c.code ?? "", 링크: smsData.loginUrl, 학원이름: smsData.branchName })}
            onClose={() => setSmsModalOpen(false)}
            onSend={sendAccessCodeSms}
          />
        ) : (
          <Modal
            onClose={() => setSmsModalOpen(false)}
            backdropBackground="rgba(20,22,30,.45)"
            backdropZIndex={70}
            panelZIndex={71}
            panelStyle={{ width: 320, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "var(--shadow-lg)" }}
          >
            <div style={{ padding: 40, textAlign: "center", color: "var(--sub)", fontSize: 13 }}>불러오는 중…</div>
          </Modal>
        )
      )}
    </div>
  );
}
