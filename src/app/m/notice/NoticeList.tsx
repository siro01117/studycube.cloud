"use client";

// 직원 공지 관리 화면 — 최신순 목록 + 작성/수정/삭제 + 읽음 현황("N명 중 M명 읽음", 펼치면 명단).
// 읽음 현황은 서버(page.tsx)가 이미 N+1 없이(공지 3쿼리) 계산해 내려준 값을 그대로 펼쳐 보여줄 뿐이다.
import { useRef, useState, useTransition, type FormEvent } from "react";
import Modal from "../_shared/Modal";
import { useUndoToast } from "../_shared/UndoToast";
import {
  createNotice, updateNotice, deleteNotice, restoreNotice,
  getNoticeBroadcastCandidates, sendNoticeBroadcastSms,
} from "./actions";
import NoticeGallery, { type NoticeImageRef } from "./NoticeGallery";
import { resizeImageForUpload } from "./resizeImage";
import { NOTICE_IMAGE_MAX_COUNT } from "@/lib/notice-image";
import SmsBatchSendModal from "../sms/SmsBatchSendModal";
import type { SmsCandidate, SmsTemplateInfo } from "@/app/m/student/smsActions";

export type NoticeRow = {
  id: string;
  authorId: string | null;
  authorName: string;
  title: string;
  body: string;
  important: boolean;
  audience: "staff" | "student";
  createdAt: string; // timestamptz 원본 문자열 — 실행취소 재기록용
  updatedAt: string;
  createdLabel: string; // 서버가 KST 로 포맷한 표시용 라벨
  updatedLabel: string;
  edited: boolean;
  readCount: number;
  total: number; // 분모 — audience='staff'면 전 직원 수, 'student'면 재원생 수
  // 학생 공지는 명단을 안 내려준다(학생 수가 많아 나열 부담) — readers/unreadNames 는 항상 빈 배열이고
  // "N명 중 M명" 요약만 쓴다. 직원 공지만 펼치면 실제 명단이 보인다.
  readers: { name: string; label: string }[];
  unreadNames: string[];
  images: NoticeImageRef[]; // id만(바이너리는 /api/notice-image/[id]가 따로 서빙)
};

const ImportantIcon = () => (
  <svg viewBox="0 0 20 20" style={{ width: 15, height: 15, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
    <path d="M10 2 3 16h14L10 2z" /><path d="M10 8v4M10 14h.01" />
  </svg>
);
const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 16 16" style={{ width: 13, height: 13, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", transform: open ? "rotate(90deg)" : "none" }}>
    <path d="M6 3.5l5 4.5-5 4.5" />
  </svg>
);
const EditIcon = () => (
  <svg viewBox="0 0 20 20" style={{ width: 15, height: 15, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
    <path d="M13.5 3.5a1.8 1.8 0 0 1 2.5 2.5L6 16l-3.5 1L3.5 13.5 13.5 3.5z" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 20 20" style={{ width: 15, height: 15, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
    <path d="M4 6h12M8 6V4h4v2M6 6l.7 10a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6" />
  </svg>
);

export default function NoticeList({ notices, canManage, canSms }: { notices: NoticeRow[]; canManage: boolean; canSms: boolean }) {
  const [addOpen, setAddOpen] = useState(false);
  const [edit, setEdit] = useState<NoticeRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useUndoToast();

  // 공지 저장 직후 "문자로도 보내기"를 골랐으면 여기서 미리보기·확정을 이어간다(집주인 지시 — 저장과
  // 발송을 한 클릭에 묶지 않는다. NoticeForm 은 저장만 끝내고 이 상태를 채우기만 한다).
  const [broadcast, setBroadcast] = useState<{ title: string; data: { candidates: SmsCandidate[]; tmpl: SmsTemplateInfo; branchName: string } | null } | null>(null);
  const requestBroadcast = (title: string) => {
    setBroadcast({ title, data: null });
    getNoticeBroadcastCandidates()
      .then((data) => setBroadcast({ title, data }))
      .catch(() => setBroadcast({ title, data: { candidates: [], tmpl: { title: "", body: "", enabled: false }, branchName: "" } }));
  };

  const doDelete = (n: NoticeRow) => {
    setConfirmDel(null);
    const fd = new FormData();
    fd.set("id", n.id);
    start(async () => {
      await deleteNotice(fd);
      toast.notify(`"${n.title}" 삭제됨`, () => {
        const rfd = new FormData();
        rfd.set("id", n.id);
        if (n.authorId) rfd.set("authorId", n.authorId);
        rfd.set("title", n.title);
        rfd.set("body", n.body);
        rfd.set("important", n.important ? "true" : "false");
        rfd.set("audience", n.audience);
        rfd.set("createdAt", n.createdAt);
        rfd.set("updatedAt", n.updatedAt);
        start(async () => { await restoreNotice(rfd); });
      });
    });
  };

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: "var(--sub)" }}>최신 공지가 위로 옵니다.</div>
        {canManage && (
          <button className="btn btn-accent" onClick={() => setAddOpen(true)} style={{ marginLeft: "auto", height: 40, padding: "0 16px" }}>
            공지 작성
          </button>
        )}
      </div>

      {notices.length === 0 ? (
        <div style={{ color: "var(--sub)", fontSize: 13, padding: 24, textAlign: "center" }}>
          등록된 공지가 없습니다{canManage ? ". '공지 작성'으로 첫 공지를 올리세요." : "."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {notices.map((n) => {
            const isOpen = expanded === n.id;
            return (
              <div key={n.id} style={{ borderTop: "1px solid var(--line)", padding: "12px 6px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: 11, fontWeight: 800, padding: "2px 7px", borderRadius: 999,
                          color: n.audience === "student" ? "var(--accent)" : "var(--sub)",
                          background: n.audience === "student" ? "var(--accent-soft)" : "var(--panel2)",
                        }}
                      >
                        {n.audience === "student" ? "학생" : "직원"}
                      </span>
                      {n.important && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--danger-strong)", fontWeight: 800, fontSize: 12 }}>
                          <ImportantIcon /> 중요
                        </span>
                      )}
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{n.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 3 }}>
                      {n.authorName} · {n.createdLabel}{n.edited && ` · ${n.updatedLabel} 수정됨`}
                    </div>
                    <div style={{ fontSize: 13.5, color: "var(--ink)", marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {n.body}
                    </div>
                    <NoticeGallery images={n.images} title={n.title} />
                  </div>
                  {canManage && (
                    <div style={{ display: "flex", gap: 4, flex: "none" }}>
                      <button className="chip" onClick={() => setEdit(n)} aria-label="수정" title="수정" style={{ width: 30, height: 30, padding: 0, justifyContent: "center" }}>
                        <EditIcon />
                      </button>
                      {confirmDel === n.id ? (
                        <>
                          <button className="chip" onClick={() => setConfirmDel(null)} style={{ height: 30, fontSize: 12 }}>취소</button>
                          <button
                            className="chip"
                            onClick={() => doDelete(n)}
                            disabled={pending}
                            style={{ height: 30, fontSize: 12, background: "var(--danger)", borderColor: "var(--danger)", color: "#fff" }}
                          >
                            정말 삭제
                          </button>
                        </>
                      ) : (
                        <button className="chip" onClick={() => setConfirmDel(n.id)} aria-label="삭제" title="삭제" style={{ width: 30, height: 30, padding: 0, justifyContent: "center", color: "var(--danger-strong)" }}>
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* 읽음 현황 — 직원 공지는 펼치면 명단, 학생 공지는 학생 수가 많아 요약만(명단 없음). */}
                {n.audience === "staff" ? (
                  <button
                    onClick={() => setExpanded(isOpen ? null : n.id)}
                    className="chip"
                    style={{ marginTop: 10, height: 28, fontSize: 12, gap: 4 }}
                    aria-expanded={isOpen}
                  >
                    <ChevronIcon open={isOpen} />
                    {n.total}명 중 {n.readCount}명 읽음
                  </button>
                ) : (
                  <div className="chip" style={{ marginTop: 10, height: 28, fontSize: 12, gap: 4, cursor: "default" }}>
                    {n.total}명 중 {n.readCount}명 읽음
                  </div>
                )}
                {isOpen && (
                  <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, background: "var(--panel2)", borderRadius: 10, padding: 10 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", marginBottom: 5 }}>읽음 ({n.readers.length})</div>
                      {n.readers.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--faint)" }}>아직 없음</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {n.readers.map((r) => (
                            <div key={r.name + r.label} style={{ fontSize: 12, color: "var(--ink)" }}>
                              {r.name} <span style={{ color: "var(--faint)" }}>· {r.label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", marginBottom: 5 }}>안 읽음 ({n.unreadNames.length})</div>
                      {n.unreadNames.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--faint)" }}>없음</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {n.unreadNames.map((name) => (
                            <div key={name} style={{ fontSize: 12, color: "var(--sub)" }}>{name}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {toast.element}

      {(addOpen || edit) && canManage && (
        <NoticeForm
          initial={edit}
          canSms={canSms}
          onClose={() => { setAddOpen(false); setEdit(null); }}
          onBroadcastRequested={requestBroadcast}
        />
      )}

      {broadcast && (
        broadcast.data ? (
          <SmsBatchSendModal
            title="공지 병행 발송 보내기"
            situationLabel="공지 병행 발송"
            candidates={broadcast.data.candidates}
            template={broadcast.data.tmpl}
            vars={() => ({ 학원이름: broadcast.data!.branchName, 제목: broadcast.title })}
            onClose={() => setBroadcast(null)}
            onSend={(ids) => sendNoticeBroadcastSms(ids, broadcast.title)}
          />
        ) : (
          <Modal
            onClose={() => setBroadcast(null)}
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

const PhotoIcon = () => (
  <svg viewBox="0 0 20 20" style={{ width: 15, height: 15, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" }}>
    <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
    <circle cx="7" cy="9" r="1.4" />
    <path d="M4 14l3.8-3.8a1.6 1.6 0 0 1 2.2 0L14 14M12.5 12.5l1-1a1.6 1.6 0 0 1 2.2 0l1.8 1.8" />
  </svg>
);

// 새로 첨부할 파일 하나(클라이언트 축소 전 원본 File + 미리보기 objectURL)
type PendingImage = { key: string; file: File; previewUrl: string };

function NoticeForm({
  initial, canSms, onClose, onBroadcastRequested,
}: {
  initial: NoticeRow | null;
  canSms: boolean;
  onClose: () => void;
  onBroadcastRequested: (title: string) => void; // 저장 성공 + "문자로도 보내기" 선택 시 부모에게 알림
}) {
  const action = initial ? updateNotice : createNotice;
  // 대상은 작성 시에만 고른다 — 수정에서는 바꿀 수 없다(읽음 집계 대상 테이블이 갈리므로 도중에 바꾸면
  // 이미 쌓인 읽음 기록의 의미가 애매해진다). 수정 화면에는 고정된 대상만 표시.
  const [audience, setAudience] = useState<"staff" | "student">(initial?.audience ?? "staff");
  // "문자로도 보내기" — 새 학생 공지에서만(수정·직원 공지에는 없음). 체크된 채로 저장이 성공하면
  // 공지 자체는 이 화면에서 끝내고, 문자 미리보기·확정은 부모(NoticeList)로 넘긴다.
  const [broadcastSms, setBroadcastSms] = useState(false);
  // 기존 사진(수정 화면) 중 "삭제" 표시한 것 — 실제 삭제는 저장(수정 완료) 시 한 번에 반영된다.
  const [keptExisting, setKeptExisting] = useState<NoticeImageRef[]>(initial?.images ?? []);
  const [removedExisting, setRemovedExisting] = useState<NoticeImageRef[]>([]);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const totalCount = keptExisting.length + pending.length;
  const atLimit = totalCount >= NOTICE_IMAGE_MAX_COUNT;

  const onPickFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = NOTICE_IMAGE_MAX_COUNT - totalCount;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    setPending((prev) => [
      ...prev,
      ...picked.map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, previewUrl: URL.createObjectURL(file) })),
    ]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePending = (key: string) => {
    setPending((prev) => {
      const found = prev.find((p) => p.key === key);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  };
  const removeExisting = (img: NoticeImageRef) => {
    setKeptExisting((prev) => prev.filter((i) => i.id !== img.id));
    setRemovedExisting((prev) => [...prev, img]);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!formRef.current || busy) return;
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData(formRef.current);
      for (const img of removedExisting) fd.append("removeImageId", img.id);
      for (const p of pending) {
        const resized = await resizeImageForUpload(p.file);
        fd.append("images", resized, `photo-${p.key}.jpg`);
      }
      const result = await action(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      for (const p of pending) URL.revokeObjectURL(p.previewUrl);
      const title = String(fd.get("title") ?? "");
      onClose();
      if (!initial && audience === "student" && broadcastSms) onBroadcastRequested(title);
    } catch {
      setError("사진을 처리하는 중 문제가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      backdropBackground="rgba(20,22,30,.45)"
      backdropZIndex={60}
      panelZIndex={61}
      ariaLabelledBy="notice-form-title"
      panelStyle={{
        width: 480, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100dvh - 60px)", overflowY: "auto",
        background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "0 24px 70px rgba(20,22,30,.35)",
      }}
    >
      <div className="flex items-center justify-between" style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)" }}>
        <div id="notice-form-title" style={{ fontSize: 17, fontWeight: 800 }}>{initial ? "공지 수정" : "공지 작성"}</div>
        <button onClick={onClose} className="chip" style={{ height: 30, width: 30, padding: 0, justifyContent: "center", cursor: "pointer" }}>✕</button>
      </div>
      <form ref={formRef} onSubmit={onSubmit} style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        {initial && <input type="hidden" name="id" value={initial.id} />}
        <input type="hidden" name="audience" value={audience} />
        <div>
          <label className="label">대상</label>
          {initial ? (
            <div style={{ fontSize: 13.5, color: "var(--sub)", height: 42, display: "flex", alignItems: "center" }}>
              {audience === "student" ? "학생" : "직원"} <span style={{ color: "var(--faint)", marginLeft: 6 }}>(작성 후 변경 불가)</span>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <AudienceButton label="직원" active={audience === "staff"} onClick={() => setAudience("staff")} />
              <AudienceButton label="학생" active={audience === "student"} onClick={() => setAudience("student")} />
            </div>
          )}
        </div>
        <div>
          <label className="label" htmlFor="notice-title">제목 *</label>
          <input id="notice-title" className="input" name="title" required aria-required="true" defaultValue={initial?.title ?? ""} style={{ height: 42 }} autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="notice-body">내용 *</label>
          <textarea
            id="notice-body"
            className="input"
            name="body"
            required
            aria-required="true"
            defaultValue={initial?.body ?? ""}
            rows={7}
            placeholder="여러 줄로 써도 그대로 저장·표시됩니다."
            style={{ height: "auto", padding: "10px 12px", lineHeight: 1.5, resize: "vertical" }}
          />
        </div>
        <div>
          <label className="label">사진 ({totalCount}/{NOTICE_IMAGE_MAX_COUNT})</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {keptExisting.map((img) => (
              <div key={img.id} style={{ position: "relative", width: 72, height: 72, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/notice-image/${img.id}`} alt="첨부 사진" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                <ThumbRemoveButton onClick={() => removeExisting(img)} />
              </div>
            ))}
            {pending.map((p) => (
              <div key={p.key} style={{ position: "relative", width: 72, height: 72, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.previewUrl} alt="첨부 예정 사진" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                <ThumbRemoveButton onClick={() => removePending(p.key)} />
              </div>
            ))}
            {!atLimit && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: 72, height: 72, borderRadius: 10, border: "1px dashed var(--line)", background: "var(--panel2)",
                  color: "var(--sub)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, cursor: "pointer",
                }}
              >
                <PhotoIcon />
                <span style={{ fontSize: 10.5 }}>추가</span>
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => onPickFiles(e.target.files)}
            style={{ display: "none" }}
          />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--sub)" }}>
          <input type="checkbox" name="important" defaultChecked={initial?.important ?? false} /> 중요 공지로 표시
        </label>
        {!initial && audience === "student" && canSms && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--sub)" }}>
            <input type="checkbox" checked={broadcastSms} onChange={(e) => setBroadcastSms(e.target.checked)} />
            문자로도 보내기 <span style={{ fontSize: 11.5, color: "var(--faint)" }}>(저장 후 대상·문구를 확인하고 보냅니다)</span>
          </label>
        )}
        {error && (
          <div style={{ fontSize: 12.5, color: "var(--danger-strong)", background: "rgba(229,72,77,.08)", borderRadius: 10, padding: "8px 10px" }}>
            {error}
          </div>
        )}
        <button className="btn btn-accent" disabled={busy} style={{ height: 44, marginTop: 4 }}>
          {busy ? "처리 중…" : initial ? "수정 완료" : "작성"}
        </button>
      </form>
    </Modal>
  );
}

function ThumbRemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="사진 삭제"
      style={{
        position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: 999, border: "none",
        background: "rgba(20,22,30,.65)", color: "#fff", fontSize: 12, lineHeight: 1, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      ✕
    </button>
  );
}

function AudienceButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, height: 42, borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
        border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
        background: active ? "var(--accent-soft)" : "var(--panel2)",
        color: active ? "var(--accent)" : "var(--sub)",
      }}
    >
      {label}
    </button>
  );
}
