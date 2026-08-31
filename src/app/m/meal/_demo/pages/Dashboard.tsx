import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { UtensilsCrossed, Moon, Users } from 'lucide-react'
import { spring } from '../components/Motion'

const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const POLL_INTERVAL_MS = 60_000

export function Dashboard({ onChange }: { onChange: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof window.api.todayOrders>> | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const load = async () => {
    setData(await window.api.todayOrders())
    setLastRefreshed(new Date())
  }
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    load()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') loadRef.current()
    }, POLL_INTERVAL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') loadRef.current() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  if (!data) return null

  const today = new Date()
  const dateLabel = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 (${DAYS[today.getDay()]})`
  const lunchList = data.applicants.filter((a) => a.meal_type === 'lunch')
  const dinnerList = data.applicants.filter((a) => a.meal_type === 'dinner')
  const refreshedLabel = lastRefreshed
    ? `${String(lastRefreshed.getHours()).padStart(2, '0')}:${String(lastRefreshed.getMinutes()).padStart(2, '0')} 기준`
    : ''

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-[1080px] mx-auto flex items-end justify-between mb-5">
        <div>
          <div className="text-ink-500 text-[11px] tracking-[0.16em] uppercase font-semibold">Today</div>
          <h1 className="text-[38px] leading-tight font-semibold tracking-tight mt-0.5">{dateLabel}</h1>
          <p className="text-ink-500 text-[13px] mt-1">오늘 들어가야 할 발주 수량</p>
        </div>
        {refreshedLabel && <span className="text-ink-400 text-[11px] tabular-nums">{refreshedLabel}</span>}
      </div>

      <div className="max-w-[1080px] mx-auto">
        <div className="grid grid-cols-2 gap-3 mb-4">
          {/* 중식 — 연한 인디고 */}
          <motion.div whileHover={{ y: -2 }} transition={spring} className="rounded-[20px] border border-accent-soft bg-accent-soft p-6">
            <div className="flex items-center gap-2 mb-3" style={{ color: '#4338CA' }}>
              <UtensilsCrossed size={15} />
              <span className="text-[12px] font-semibold uppercase tracking-wider">중식 발주</span>
            </div>
            <div className="flex items-baseline gap-2">
              <motion.span key={data.lunchTotal} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                transition={spring} className="text-[72px] leading-none font-semibold tabular-nums text-ink-900">{data.lunchTotal}</motion.span>
              <span className="text-lg" style={{ color: '#4338CA', opacity: 0.6 }}>개</span>
            </div>
          </motion.div>

          {/* 석식 — 진한 인디고 */}
          <motion.div whileHover={{ y: -2 }} transition={spring} className="rounded-[20px] border border-accent bg-accent p-6">
            <div className="flex items-center gap-2 mb-3" style={{ color: 'rgba(255,255,255,0.65)' }}>
              <Moon size={15} />
              <span className="text-[12px] font-semibold uppercase tracking-wider">석식 발주</span>
            </div>
            <div className="flex items-baseline gap-2">
              <motion.span key={data.dinnerTotal} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                transition={spring} className="text-[72px] leading-none font-semibold tabular-nums text-white">{data.dinnerTotal}</motion.span>
              <span className="text-lg" style={{ color: 'rgba(255,255,255,0.5)' }}>개</span>
            </div>
          </motion.div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <ApplicantCard title="중식 신청자" list={lunchList} delay={0.06} />
          <ApplicantCard title="석식 신청자" list={dinnerList} delay={0.09} />
        </div>
      </div>
    </div>
  )
}

function ApplicantCard({ title, list, delay }: { title: string; list: { name: string; seat: string | null }[]; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay }} className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Users size={16} className="text-ink-500" />
        <h2 className="text-[16px] font-semibold">{title}</h2>
      </div>
      {list.length === 0 ? (
        <div className="text-ink-400 text-[13px] py-10 text-center">오늘 신청된 도시락이 없습니다.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {list.map((a, i) => (
            <motion.div key={`${a.name}-${i}`}
              initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
              transition={{ ...spring, delay: 0.02 * i }}
              className="grid grid-cols-[1fr_auto] px-3 py-2.5 rounded-xl bg-surface items-center"
            >
              <span className="font-medium text-[13.5px] truncate">{a.name}</span>
              <span className="text-[12px] text-ink-500 tabular-nums">{a.seat || '좌석 미배정'}</span>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  )
}
