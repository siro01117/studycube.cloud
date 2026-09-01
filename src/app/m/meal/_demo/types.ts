export interface Month {
  id: string
  year: number
  month: number
  lunch_label: string
  lunch_price: number
  dinner_label: string
  dinner_price: number
  notice: string | null  // newline-separated lines
}

export interface Meal { date: string; meal_type: 'lunch' | 'dinner'; price: number }

export interface Application {
  id: string
  month_id: string
  studentId: string
  name: string
  seat: string | null
  floor: number | null
  paid: boolean
  paid_amount: number
  paid_date: string | null
  memo: string
  meals: Meal[]
}

export interface UpdatePaymentPayload {
  orderId: string
  paidAmount: number
  paidDate: string | null
  memo: string
}

// Per-meal closure: null means fully open (default)
export interface ClosureInfo {
  lunch_closed: boolean
  dinner_closed: boolean
  label: string
}

declare global {
  interface Window {
    api: {
      getMonth: (y: number, m: number) => Promise<Month>
      updateMonth: (id: string, fields: Partial<Month>) => Promise<void>
      listClosures: (monthId: string) => Promise<Record<string, ClosureInfo>>
      setClosure: (monthId: string, date: string, lunchClosed: boolean, dinnerClosed: boolean, label: string) => Promise<void>
      mealCountOn: (monthId: string, date: string) => Promise<{ lunch: number; dinner: number }>
      holidayLabel: (iso: string) => Promise<string | null>

      listApps: (monthId: string) => Promise<Application[]>
      updatePayment: (payload: UpdatePaymentPayload) => Promise<void>

      todayOrders: () => Promise<{
        today: string
        applicants: { name: string; seat: string | null; meal_type: 'lunch' | 'dinner' }[]
        lunchTotal: number
        dinnerTotal: number
        excludedClosed: number
      }>
    }
  }
}
