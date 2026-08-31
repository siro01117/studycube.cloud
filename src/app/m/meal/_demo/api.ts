// window.api 어댑터 — 예전엔 localStorage(더미 시드 포함)였다. 지금은 실 DB 위 서버 액션
// (../actions.ts)을 그대로 호출하는 얇은 래퍼다. 원본 렌더러 코드(App.tsx, pages/*, components/*)는
// window.api 만 호출하므로 이 파일이 무엇으로 구현됐는지 전혀 모른다 — 그래서 렌더러 쪽은 이 교체로
// 단 한 줄도 바꾸지 않아도 됐다(단, createApp(구 upsertApp) 시그니처는 학생 검색 전환으로 바뀌었고,
// 결제 저장은 updatePayment 로 분리됐다).
import { holidayLabel as libHolidayLabel } from "@/lib/holidays";
import type { Application, ClosureInfo, CreateAppPayload, Month, StudentCandidate, UpdatePaymentPayload } from "./types";
import * as actions from "../actions";

function toClosureMap(rows: { date: string; lunch_closed: boolean; dinner_closed: boolean; label: string | null }[]): Record<string, ClosureInfo> {
  const out: Record<string, ClosureInfo> = {};
  for (const r of rows) out[r.date] = { lunch_closed: r.lunch_closed, dinner_closed: r.dinner_closed, label: r.label ?? "" };
  return out;
}

function toApplication(a: actions.AppRow): Application {
  return {
    id: a.id, month_id: a.month_id, studentId: a.studentId,
    name: a.name, seat: a.seat, floor: a.floor,
    paid: a.paid, paid_amount: a.paid_amount, paid_date: a.paid_date, memo: a.memo,
    source: a.source,
    meals: a.meals,
  };
}

// ─── window.api 설치 ────────────────────────────────────────────────────────
export function installMealApi() {
  window.api = {
    getMonth: async (y: number, m: number): Promise<Month> => {
      const r = await actions.getMonth(y, m);
      return { id: r.id, year: r.year, month: r.month, lunch_label: r.lunch_label, lunch_price: r.lunch_price, dinner_label: r.dinner_label, dinner_price: r.dinner_price, notice: r.notice };
    },
    updateMonth: async (id: string, fields: Partial<Month>) => {
      await actions.updateMonth(id, {
        lunch_label: fields.lunch_label, lunch_price: fields.lunch_price,
        dinner_label: fields.dinner_label, dinner_price: fields.dinner_price,
        notice: fields.notice ?? undefined,
      });
    },
    listClosures: async (monthId: string) => toClosureMap(await actions.listClosures(monthId)),
    setClosure: async (monthId: string, date: string, lunchClosed: boolean, dinnerClosed: boolean, label: string) => {
      await actions.setClosure(monthId, date, lunchClosed, dinnerClosed, label);
    },
    holidayLabel: async (iso: string) => libHolidayLabel(iso),

    listApps: async (monthId: string) => (await actions.listApps(monthId)).map(toApplication),
    createApp: async (payload: CreateAppPayload) =>
      actions.createApp({
        monthId: payload.monthId, studentId: payload.studentId,
        paidAmount: payload.paidAmount, paidDate: payload.paidDate, memo: payload.memo, meals: payload.meals,
      }),
    updatePayment: async (payload: UpdatePaymentPayload) => {
      await actions.updatePayment({
        orderId: payload.orderId, paidAmount: payload.paidAmount, paidDate: payload.paidDate, memo: payload.memo,
      });
    },
    deleteApp: async (id: string) => { await actions.deleteApp(id); },
    searchStudents: async (monthId: string, query: string): Promise<StudentCandidate[]> => actions.searchStudents(monthId, query),

    todayOrders: async () => actions.todayOrders(),
  };
}
