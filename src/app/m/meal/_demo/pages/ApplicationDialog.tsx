import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Modal } from '../components/Modal'
import { PillButton } from '../components/Motion'
import { Search, X, Check } from 'lucide-react'
import { useDialog } from '../components/Dialog'
import type { ClosureInfo, Month, StudentCandidate } from '../types'
import { monthGrid, isoDate, effectiveClosure } from '../lib/calendar'
import { holidayLabel } from '@/lib/holidays'

const DAYS = ['월', '화', '수', '목', '금', '토']

interface Props {
  open: boolean; year: number; month: number
  monthRow: Month; onClose: () => void; onSaved: () => void
}

export function ApplicationDialog({ open, year, month, monthRow, onClose, onSaved }: Props) {
  const { toast } = useDialog()
  // 학생 검색 선택 — 재원생만, 이미 이 달에 신청서가 있으면 검색 결과에서 걸러진다.
  const [student, setStudent] = useState<{ id: string; name: string; seat: string | null; floor: number | null } | null>(null)
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<StudentCandidate[]>([])

  const [paidAmount, setPaidAmount] = useState(0)
  const [paidDate, setPaidDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [memo, setMemo] = useState('')
  const [closures, setClosures] = useState<Record<string, ClosureInfo>>({})
  const [holidays, setHolidays] = useState<Record<string, string>>({})
  const [meals, setMeals] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    ;(async () => {
      const cls = await window.api.listClosures(monthRow.id)
      setClosures(cls)
      const grid = monthGrid(year, month)
      const hh: Record<string, string> = {}
      for (const row of grid) for (const d of row) {
        if (!d) continue
        const iso = isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
        const lbl = holidayLabel(iso) // 순수 함수 — 날짜마다 서버 왕복(42회) 돌지 않는다
        if (lbl) hh[iso] = lbl
      }
      setHolidays(hh)
      setStudent(null); setQuery(''); setCandidates([]); setPaidAmount(0)
      setPaidDate(new Date().toISOString().slice(0, 10)); setMemo(''); setMeals(new Set())
    })()
  }, [open, year, month, monthRow.id])

  // 학생 검색 — 이미 학생을 고른 뒤엔 검색하지 않는다. onChange는 필터(state)만, 조회는
  // debounce된 쿼리로만 나간다(11→01 같은 조기 정규화 버그를 피하려는 이 레포의 확립된 규칙과 같은 맥락).
  useEffect(() => {
    if (!open || student) { setCandidates([]); return }
    const q = query.trim()
    if (!q) { setCandidates([]); return }
    const t = setTimeout(async () => {
      setCandidates(await window.api.searchStudents(monthRow.id, q))
    }, 200)
    return () => clearTimeout(t)
  }, [open, student, query, monthRow.id])

  const toggle = (iso: string, type: 'lunch' | 'dinner') => {
    const key = `${iso}|${type}`
    const next = new Set(meals)
    if (next.has(key)) next.delete(key); else next.add(key)
    setMeals(next)
  }

  const { lunch, dinner, total, remaining } = (() => {
    let l = 0, d = 0
    for (const k of meals) { if (k.endsWith('|lunch')) l++; else d++ }
    const t = l * monthRow.lunch_price + d * monthRow.dinner_price
    return { lunch: l, dinner: d, total: t, remaining: t - paidAmount }
  })()

  const save = async () => {
    if (!student) { alert('학생을 선택해주세요.'); return }
    try {
      await window.api.createApp({
        monthId: monthRow.id, studentId: student.id,
        paidAmount, paidDate, memo,
        meals: Array.from(meals).map((k) => { const [date, meal_type] = k.split('|'); return { date, meal_type: meal_type as 'lunch' | 'dinner' } })
      })
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : '저장하지 못했습니다.', 'error')
    }
  }

  const grid = monthGrid(year, month)

  return (
    <Modal open={open} onClose={onClose} title="신청서 추가" width="max-w-5xl"
      footer={<>
        <PillButton variant="ghost" onClick={onClose}>취소</PillButton>
        <PillButton variant="primary" onClick={save}>저장</PillButton>
      </>}
    >
      <div className="grid grid-cols-[240px_1fr] gap-4 pb-1">
        {/* Left */}
        <div className="flex flex-col gap-3">
          <Sec title="학생 정보">
            {student ? (
              <div className="flex items-center gap-2 bg-surface rounded-lg border border-ink-200 px-3 h-9">
                <span className="text-[13px] font-semibold truncate">{student.name}</span>
                <span className="text-[11px] text-ink-400 ml-auto shrink-0">{student.seat || '좌석 미배정'}</span>
                <button onClick={() => { setStudent(null); setQuery('') }}
                  className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-ink-100 text-ink-400 shrink-0">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
                <input
                  className={clsx(inp, 'pl-8')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="이름으로 검색"
                  autoFocus
                />
                {candidates.length > 0 && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white rounded-lg border border-ink-200 shadow-pop max-h-56 overflow-auto">
                    {candidates.map((c) => (
                      <button key={c.id} disabled={c.alreadyApplied}
                        onClick={() => { setStudent({ id: c.id, name: c.name, seat: c.seat, floor: c.floor }); setQuery('') }}
                        className={clsx('w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors',
                          c.alreadyApplied ? 'text-ink-300 cursor-not-allowed' : 'hover:bg-surface text-ink-800')}
                      >
                        <span className="font-medium truncate flex-1">{c.name}</span>
                        <span className="text-[11px] text-ink-400 shrink-0">{c.seat || '좌석 미배정'}</span>
                        {c.alreadyApplied && <span className="text-[10px] text-ink-400 shrink-0">이미 신청</span>}
                        {!c.alreadyApplied && <Check size={12} className="text-ink-300 shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Sec>

          <Sec title="납입">
            <Fld label="납입 금액">
              <div className="relative">
                <input type="number" value={paidAmount} onChange={(e) => setPaidAmount(parseInt(e.target.value || '0'))}
                  className={clsx(inp, 'pr-8')} step={500} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 text-[11px]">원</span>
              </div>
            </Fld>
            <Fld label="납입 날짜">
              <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className={inp} />
            </Fld>
            <Fld label="메모">
              <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="(선택)" className={inp} />
            </Fld>
          </Sec>

          {/* Totals */}
          <div className="rounded-xl border border-ink-200 p-3 text-[12px] space-y-1.5">
            <Row k="중식" v={`${lunch}개 × ${monthRow.lunch_price.toLocaleString()}원`} />
            <Row k="석식" v={`${dinner}개 × ${monthRow.dinner_price.toLocaleString()}원`} />
            <div className="border-t border-ink-100 pt-1.5">
              <Row k="총액" v={`${total.toLocaleString()}원`} bold />
              <Row k="잔액" v={`${remaining.toLocaleString()}원`} bold color={remaining > 0 ? 'text-red-500' : 'text-ink-500'} />
            </div>
          </div>
        </div>

        {/* Right: Excel-style meal grid */}
        <div className="flex flex-col gap-2 self-start min-w-0 flex-1">
          <div className="border border-ink-300 rounded-xl overflow-hidden text-[12px]">
          {/* header row */}
          <div className="grid grid-cols-[50px_36px_repeat(6,1fr)] bg-ink-50 border-b border-ink-300">
            <div className="px-2 py-2 font-semibold text-ink-600 border-r border-ink-300 text-center text-[11px]">주차</div>
            <div className="px-1 py-2 font-semibold text-ink-600 border-r border-ink-300 text-center text-[11px]">구분</div>
            {DAYS.map((d, i) => (
              <div key={d} className={clsx('px-1 py-2 text-center font-semibold border-r border-ink-300 last:border-0 text-[11px]',
                i === 5 ? 'text-blue-500' : 'text-ink-700')}>{d}</div>
            ))}
          </div>

          {/* weeks */}
          {grid.map((week, wi) => {
            if (week.every((d) => !d)) return null
            return (
              <div key={wi} className="grid grid-cols-[50px_36px_repeat(6,1fr)] border-t border-ink-200">
                {/* week label */}
                <div className="border-r border-ink-200 flex flex-col">
                  <div className="bg-ink-50 text-center text-[10px] font-bold text-ink-500 py-1 border-b border-ink-200">{wi + 1}주</div>
                  <div className="flex-1 flex items-center justify-center text-[10px] text-ink-500 border-b border-ink-100">중</div>
                  <div className="flex-1 flex items-center justify-center text-[10px] text-ink-500">석</div>
                </div>

                {/* 구분 */}
                <div className="border-r border-ink-200 flex flex-col">
                  <div className="bg-ink-50 py-1 border-b border-ink-200 h-[26px]" />
                  <div className="flex-1 flex items-center justify-center text-[9px] text-ink-400 border-b border-ink-100">중식</div>
                  <div className="flex-1 flex items-center justify-center text-[9px] text-ink-400">석식</div>
                </div>

                {week.slice(0, 6).map((d, di) => {
                  if (!d) return (
                    <div key={di} className="border-r border-ink-200 last:border-0 flex flex-col">
                      <div className="bg-ink-50 h-[26px] border-b border-ink-200" />
                      <div className="flex-1 bg-ink-50 border-b border-ink-100" />
                      <div className="flex-1 bg-ink-50" />
                    </div>
                  )
                  const eff = effectiveClosure(d, closures, holidays)
                  const lClosed = eff?.lunch_closed ?? false
                  const dClosed = eff?.dinner_closed ?? false
                  const iso = isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate())
                  const lOn = meals.has(`${iso}|lunch`)
                  const dOn = meals.has(`${iso}|dinner`)

                  return (
                    <div key={di} className="border-r border-ink-200 last:border-0 flex flex-col min-h-[88px]">
                      {/* date */}
                      <div className="bg-ink-50 text-center font-bold text-[12px] py-1 border-b border-ink-200 h-[26px] flex items-center justify-center">
                        {d.getDate()}
                      </div>
                      {/* lunch */}
                      <div
                        className={clsx('flex-1 flex items-center justify-center border-b border-ink-100 relative',
                          !lClosed && 'cursor-pointer hover:bg-ink-50')}
                        onClick={() => !lClosed && toggle(iso, 'lunch')}
                      >
                        {lClosed ? <Diag /> : lOn ? <span className="block w-4 h-4 rounded-full border-[2.5px] border-accent" /> : null}
                      </div>
                      {/* dinner */}
                      <div
                        className={clsx('flex-1 flex items-center justify-center relative',
                          !dClosed && 'cursor-pointer hover:bg-ink-50')}
                        onClick={() => !dClosed && toggle(iso, 'dinner')}
                      >
                        {dClosed ? <Diag /> : dOn ? <span className="block w-4 h-4 rounded-full border-[2.5px] border-accent" /> : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}

          {/* legend */}
          <div className="border-t border-ink-200 bg-ink-50 px-3 py-2 flex gap-4 text-[10px] text-ink-500">
            <span className="flex items-center gap-1.5"><span className="text-[12px] text-accent">●</span> 신청 (클릭 토글)</span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-3 inline-block relative border border-ink-300 rounded-sm overflow-hidden">
                <Diag />
              </span> 휴무
            </span>
          </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

const inp = 'w-full bg-surface rounded-lg h-8 px-3 text-[13px] border border-ink-200 outline-none focus:border-ink-500'

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-sm p-3">
      <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-ink-400 mb-2.5">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] text-ink-500 mb-1">{label}</div>
      {children}
    </label>
  )
}

function Row({ k, v, bold, color }: { k: string; v: string; bold?: boolean; color?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-ink-500">{k}</span>
      <span className={clsx(bold && 'font-semibold', color)}>{v}</span>
    </div>
  )
}

function Diag() {
  return (
    <div className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: 'linear-gradient(to top right, transparent calc(50% - 0.75px), #adb4c2 calc(50% - 0.75px), #adb4c2 calc(50% + 0.75px), transparent calc(50% + 0.75px))',
      }} />
  )
}
