"use client";

// 헤더에 얹는 "스케쥴 미제출 독촉" 버튼 — 학생 스케쥴러 페이지(page.tsx, 서버 컴포넌트) 는 문자
// 관련 상태를 들고 있지 않으므로 이 작은 클라이언트 조각만 따로 뺐다. 후보(스케쥴 한 번도
// 제출하지 않은 재원생)·템플릿은 열 때 서버 액션으로 불러온다(학생 관리 화면의 SmsBatchSendModal
// 사용 방식과 동일).
import { useState } from "react";
import { getScheduleReminderCandidates, sendScheduleReminderSms, type SmsCandidate, type SmsTemplateInfo } from "../student/smsActions";
import SmsBatchSendModal from "../sms/SmsBatchSendModal";
import Modal from "../_shared/Modal";

export default function ScheduleReminderButton() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ candidates: SmsCandidate[]; tmpl: SmsTemplateInfo; branchName: string } | null>(null);

  const openModal = () => {
    setOpen(true);
    setData(null);
    getScheduleReminderCandidates().then(setData).catch(() => setData({ candidates: [], tmpl: { title: "", body: "", enabled: false }, branchName: "" }));
  };

  return (
    <>
      <button className="chip" onClick={openModal} style={{ cursor: "pointer" }}>스케쥴 미제출 독촉</button>
      {open && (
        data ? (
          <SmsBatchSendModal
            title="스케쥴 미제출 독촉 보내기"
            situationLabel="스케쥴 미제출 독촉"
            candidates={data.candidates}
            template={data.tmpl}
            vars={(c) => ({ 학생이름: c.name, 학원이름: data.branchName })}
            onClose={() => setOpen(false)}
            onSend={sendScheduleReminderSms}
          />
        ) : (
          <Modal
            onClose={() => setOpen(false)}
            backdropBackground="rgba(20,22,30,.45)"
            backdropZIndex={70}
            panelZIndex={71}
            panelStyle={{ width: 320, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 20, boxShadow: "var(--shadow-lg)" }}
          >
            <div style={{ padding: 40, textAlign: "center", color: "var(--sub)", fontSize: 13 }}>불러오는 중…</div>
          </Modal>
        )
      )}
    </>
  );
}
