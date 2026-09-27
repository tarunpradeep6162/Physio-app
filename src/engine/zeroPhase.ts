/**
 * Offline, zero-phase smoothing for STORED signals (applied after a capture ends, never live).
 *
 * A causal filter (One Euro, EMA, Kalman) necessarily lags: the value stored at time t would
 * describe the limb slightly earlier, and peaks are clipped during fast movement. After the
 * capture, the whole signal is available, so each sample is replaced by the median of the samples
 * within ±halfWindowMs (centred window → no delay; median → robust to single-frame spikes),
 * optionally followed by a centred mean (noise reduction, still no delay).
 * Windows never cross a gap (null samples): nothing is interpolated or bridged.
 */
export function zeroPhaseSmooth(samples: { t: number; v: number | null }[], halfWindowMs: number, meanHalfWindowMs = 0): (number | null)[] {
  const med = zeroPhasePass(samples, halfWindowMs, 'median');
  return meanHalfWindowMs > 0 ? zeroPhasePass(samples.map((s, i) => ({ t: s.t, v: med[i] })), meanHalfWindowMs, 'mean') : med;
}

function zeroPhasePass(samples: { t: number; v: number | null }[], halfWindowMs: number, kind: 'median' | 'mean'): (number | null)[] {
  const out: (number | null)[] = new Array(samples.length).fill(null);
  let segStart = 0;
  for (let i = 0; i <= samples.length; i++) {
    if (i === samples.length || samples[i].v === null) {
      smoothSegment(samples, segStart, i, halfWindowMs, out, kind);
      segStart = i + 1;
    }
  }
  return out;
}

function smoothSegment(s: { t: number; v: number | null }[], a: number, b: number, hw: number, out: (number | null)[], kind: 'median' | 'mean') {
  let lo = a;
  let hi = a;
  for (let i = a; i < b; i++) {
    while (s[lo].t < s[i].t - hw) lo++;
    while (hi < b - 1 && s[hi + 1].t <= s[i].t + hw) hi++;
    // Symmetric window: trim to the same number of samples on both sides of i.
    const k = Math.min(i - lo, hi - i);
    const win: number[] = [];
    for (let j = i - k; j <= i + k; j++) win.push(s[j].v as number);
    if (kind === 'mean') out[i] = win.reduce((x, y) => x + y, 0) / win.length;
    else {
      win.sort((x, y) => x - y);
      out[i] = win[win.length >> 1];
    }
  }
}
