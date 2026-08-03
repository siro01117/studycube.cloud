"use client";

// 폰용 좌석 캔버스 — 한 방을 보여주고 손가락으로 팬/핀치줌, 좌석 탭.
// 순찰(/patrol)·좌석배치도(/seat) 공용. CSS zoom 대신 transform:scale (좌표계 어긋남 방지).
import { useCallback, useEffect, useRef, useState } from "react";
import { SW, SH, boundsOf } from "@/lib/seatmap";

export type CanvasSeat = { id: string; x: number; y: number };
const MIN_S = 0.5, MAX_S = 3;

export default function SeatCanvas({ seats, onTap, renderSeat, overlay }: {
  seats: CanvasSeat[];
  onTap: (id: string) => void;
  renderSeat: (id: string) => React.ReactNode;
  overlay?: React.ReactNode;                 // 캔버스 위에 얹을 것(상태 배지·버튼 등)
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ tx: 10, ty: 10, s: 1 });
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  const bounds = useCallback(() => boundsOf(seats), [seats]);

  // 초기 배율: 방 전체를 욱여넣지 않는다(좌석이 손가락보다 작아짐).
  // 최소 1:1(82×60 = 터치타깃 48dp 이상)을 보장하고, 넘치면 팬해서 본다.
  const reset = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { w, h } = bounds();
    const vw = el.clientWidth, vh = el.clientHeight, pad = 10;
    const cover = Math.min((vw - pad * 2) / w, (vh - pad * 2) / h);
    const s = Math.min(Math.max(cover, 1), 1.5);
    setView({ tx: Math.max(pad, (vw - w * s) / 2), ty: Math.max(pad, (vh - h * s) / 2), s });
  }, [bounds]);
  useEffect(() => { reset(); }, [reset]);

  const g = useRef<{
    pts: Map<number, { x: number; y: number }>;
    prevMid: { x: number; y: number } | null; prevDist: number | null;
    downAt: number; downPos: { x: number; y: number } | null; moved: boolean; multi: boolean;
  }>({ pts: new Map(), prevMid: null, prevDist: null, downAt: 0, downPos: null, moved: false, multi: false });

  // 캔버스 위에 얹힌 버튼·링크는 제스처 대상이 아니다.
  // (여기서 걸러내지 않으면 setPointerCapture 가 포인터를 가져가 버튼 클릭 자체가 안 먹는다.)
  const onControl = (e: React.PointerEvent) => !!(e.target as HTMLElement).closest?.("button, a, input, select");

  const down = (e: React.PointerEvent) => {
    if (onControl(e)) return;
    const q = g.current;
    q.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (q.pts.size === 1) { q.downAt = Date.now(); q.downPos = { x: e.clientX, y: e.clientY }; q.moved = false; q.multi = false; }
    else { q.multi = true; q.prevDist = null; q.prevMid = null; }
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const q = g.current;
    if (!q.pts.has(e.pointerId)) return;
    const prev = q.pts.get(e.pointerId)!;
    q.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (q.pts.size === 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      if (q.downPos && Math.hypot(e.clientX - q.downPos.x, e.clientY - q.downPos.y) > 8) q.moved = true;
      if (q.moved) setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    } else if (q.pts.size === 2) {
      const [a, b] = [...q.pts.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (q.prevDist != null && q.prevMid != null) {
        const pm = q.prevMid, pd = q.prevDist;
        setView((v) => {
          const s2 = Math.min(Math.max(v.s * (dist / pd), MIN_S), MAX_S);
          const k = s2 / v.s;
          return { tx: pm.x - k * (pm.x - v.tx) + (mid.x - pm.x), ty: pm.y - k * (pm.y - v.ty) + (mid.y - pm.y), s: s2 };
        });
      }
      q.prevMid = mid; q.prevDist = dist;
    }
  };
  const up = (e: React.PointerEvent) => {
    if (onControl(e)) return;
    const q = g.current;
    const tap = q.pts.size === 1 && !q.moved && !q.multi && Date.now() - q.downAt < 400;
    q.pts.delete(e.pointerId);
    if (q.pts.size < 2) { q.prevMid = null; q.prevDist = null; }
    if (!tap) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const v = viewRef.current;
    const wx = (e.clientX - r.left - v.tx) / v.s, wy = (e.clientY - r.top - v.ty) / v.s;
    for (const st of seats) {
      if (wx >= st.x && wx <= st.x + SW && wy >= st.y && wy <= st.y + SH) { onTap(st.id); return; }
    }
  };

  return (
    <div ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", touchAction: "none" }}>
      <div style={{ position: "absolute", left: 0, top: 0, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`, transformOrigin: "0 0" }}>
        {seats.map((st) => (
          <div key={st.id} style={{ position: "absolute", left: st.x, top: st.y, width: SW, height: SH }}>
            {renderSeat(st.id)}
          </div>
        ))}
      </div>
      {overlay}
    </div>
  );
}
