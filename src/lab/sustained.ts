/**
 * Sustained-run telemetry for the live benchmark. A phone that heats up usually slows its
 * inference over minutes, so the run is split into fixed windows and the last window is compared
 * with the first. Only timings are kept — never frames or video.
 */

export interface SustainedWindow {
  startSec: number;
  frames: number;
  fps: number;
  inferenceP50: number;
  inferenceP95: number;
}

export interface SustainedSummary {
  windowSec: number;
  windows: SustainedWindow[];
  /** Last-window p50 inference ÷ first-window p50 (1 = no slowdown). Null with fewer than two windows. */
  slowdownRatio: number | null;
  /** Last-window fps ÷ first-window fps (1 = no drop). */
  fpsRatio: number | null;
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] * 10) / 10;
};

/** `samples`: analysed frames as { t: ms since start, ms: inference time }. */
export function sustainedWindows(samples: { t: number; ms: number }[], totalMs: number, windowSec = 30): SustainedSummary {
  const w = Math.max(1, Math.min(windowSec, totalMs / 1000 / 2)) * 1000;
  const n = Math.max(1, Math.floor(totalMs / w));
  const windows: SustainedWindow[] = [];
  for (let i = 0; i < n; i++) {
    const inWin = samples.filter((s) => s.t >= i * w && s.t < (i + 1) * w);
    windows.push({ startSec: Math.round((i * w) / 100) / 10, frames: inWin.length, fps: Math.round((inWin.length / (w / 1000)) * 10) / 10, inferenceP50: pct(inWin.map((s) => s.ms), 0.5), inferenceP95: pct(inWin.map((s) => s.ms), 0.95) });
  }
  const first = windows[0];
  const last = windows[windows.length - 1];
  const ok = windows.length >= 2 && first.frames > 0 && last.frames > 0;
  return {
    windowSec: w / 1000,
    windows,
    slowdownRatio: ok && first.inferenceP50 > 0 ? Math.round((last.inferenceP50 / first.inferenceP50) * 100) / 100 : null,
    fpsRatio: ok && first.fps > 0 ? Math.round((last.fps / first.fps) * 100) / 100 : null,
  };
}
