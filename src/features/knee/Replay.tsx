import { useEffect, useMemo, useRef, useState } from 'react';
import { drawSkeleton, OVERLAY_COLORS } from '../../camera/overlay';
import { IconPause, IconPlay } from '../../components/icons';
import { decodeFrames } from '../../engine/protocols/codec';
import type { ProtocolResult } from '../../engine/protocols/types';

/**
 * Dynamic replay from landmark-only storage (no video): skeleton, signal curve, movement events
 * and a timeline are synchronised to one playhead. Invalid (paused) spans are drawn as gaps.
 */

const EVENT_GLYPH: Record<string, string> = { start: '▲', peak: '●', end: '■', incomplete: '✕', discarded: '✕', paused: '⏸' };

export function Replay({ result, focus = [], height = 300, label, unit }: { result: ProtocolResult; focus?: number[]; height?: number; label: string; unit: string }) {
  const frames = useMemo(() => decodeFrames(result.frames), [result.frames]);
  const duration = Math.max(result.frames.times.at(-1) ?? 0, 1);
  const [t, setT] = useState(() => result.keyframes.find((k) => k.label === 'peak')?.t ?? 0);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const W = result.frameWidth ?? 720;
  const H = result.frameHeight ?? 1280;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      setT((prev) => {
        const next = prev + (now - last);
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      last = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  const frame = useMemo(() => {
    let best = frames[0];
    for (const f of frames) if (Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
    return best;
  }, [frames, t]);

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    c.width = W;
    c.height = H;
    ctx.fillStyle = '#0d1a1d';
    ctx.fillRect(0, 0, W, H);
    if (frame?.lms) drawSkeleton(ctx, frame.lms, W, H, { mirrored: false, focus, state: 'tracked', minVisibility: 0.5 });
    else {
      ctx.fillStyle = OVERLAY_COLORS.attention;
      ctx.font = `${Math.round(H / 28)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText('No valid pose at this moment', W / 2, H / 2);
    }
  }, [frame, W, H, focus]);

  // Signal curve geometry
  const CW = 480;
  const CH = 130;
  const vals = result.signal.map((s) => s.v).filter((v): v is number => v !== null);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(10, ...vals);
  const sx = (sec: number) => 8 + (sec * 1000 / duration) * (CW - 16);
  const sy = (v: number) => CH - 18 - ((v - lo) / (hi - lo || 1)) * (CH - 30);
  const segs: string[] = [];
  let cur = '';
  for (const s of result.signal) {
    if (s.v === null) {
      if (cur) segs.push(cur);
      cur = '';
    } else cur += `${cur ? 'L' : 'M'}${sx(s.t).toFixed(1)},${sy(s.v).toFixed(1)}`;
  }
  if (cur) segs.push(cur);
  const nowVal = (() => {
    let best = result.signal[0];
    for (const s of result.signal) if (Math.abs(s.t * 1000 - t) < Math.abs((best?.t ?? 0) * 1000 - t)) best = s;
    return best?.v ?? null;
  })();
  const shownEvents = result.events.filter((e) => e.type in EVENT_GLYPH && e.type !== 'paused');

  return (
    <div className="replay">
      <canvas ref={canvasRef} className="replay-canvas" style={{ height }} role="img" aria-label={`Skeleton replay at ${(t / 1000).toFixed(1)} s`} />
      <div className="stack tight grow" style={{ minWidth: 0 }}>
        <div className="row between wrap">
          <strong className="small">
            {label}: <span className="num">{nowVal === null ? 'paused' : `${nowVal}${unit}`}</span> <span className="muted xs">at {(t / 1000).toFixed(1)} s</span>
          </strong>
          <span className="xs muted">Landmark replay · no video stored</span>
        </div>
        <svg viewBox={`0 0 ${CW} ${CH}`} className="chart" role="img" aria-label={`${label} over time with movement events`}>
          <line x1="8" x2={CW - 8} y1={CH - 18} y2={CH - 18} stroke="#d8e2df" />
          {segs.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="#0D9488" strokeWidth="2" />
          ))}
          {shownEvents.map((e, i) => (
            <text key={i} x={sx(e.t / 1000)} y={CH - 4} textAnchor="middle" fontSize="10" fill={e.type === 'incomplete' || e.type === 'discarded' ? '#b53131' : '#3c4d49'}>
              {EVENT_GLYPH[e.type]}
            </text>
          ))}
          <line x1={sx(t / 1000)} x2={sx(t / 1000)} y1="4" y2={CH - 14} stroke="#10201d" strokeWidth="1.5" />
        </svg>
        <div className="row">
          <button type="button" className="icon-btn" onClick={() => (t >= duration ? (setT(0), setPlaying(true)) : setPlaying((p) => !p))} aria-label={playing ? 'Pause replay' : 'Play replay'}>
            {playing ? <IconPause width={18} /> : <IconPlay width={18} />}
          </button>
          <input
            type="range"
            className="grow"
            min={0}
            max={duration}
            step={50}
            value={t}
            onChange={(e) => {
              setPlaying(false);
              setT(Number(e.target.value));
            }}
            aria-label="Replay timeline"
          />
        </div>
        <div className="row wrap xs muted">
          <span>▲ start</span>
          <span>● peak</span>
          <span>■ repetition complete</span>
          <span style={{ color: 'var(--red-ink)' }}>✕ not counted</span>
          <span>gaps = measurement paused</span>
        </div>
        <div className="row wrap">
          {result.keyframes.map((k) => (
            <button key={k.label} type="button" className="btn sm secondary" onClick={() => (setPlaying(false), setT(k.t))}>
              {k.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
