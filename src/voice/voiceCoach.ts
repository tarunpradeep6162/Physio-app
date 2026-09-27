import type { SpeechCue } from '../engine/feedback';

/**
 * Event-driven voice coach on top of the Web Speech API.
 *
 * - Speaks only when the feedback engine emits an event (never a running commentary).
 * - Per-cue cooldowns prevent repetition; a higher-priority cue interrupts a lower one.
 * - Stale cues (older than 1.5 s by the time the synthesiser is free) are dropped.
 * - Mute/rate are user-controlled; every spoken cue is also shown as a caption.
 */

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export class VoiceCoach {
  private lastSpoken = new Map<string, number>();
  private current: { priority: number; at: number } | null = null;
  private muted = false;
  private voice: SpeechSynthesisVoice | null = null;
  private readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  onCaption: ((text: string) => void) | null = null;

  constructor(private lang: string, private rate = 1.0) {
    this.pickVoice();
    if (this.supported) speechSynthesis.addEventListener?.('voiceschanged', () => this.pickVoice());
  }

  get isSupported() {
    return this.supported;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m && this.supported) speechSynthesis.cancel();
  }

  setLang(lang: string) {
    this.lang = lang;
    this.pickVoice();
  }

  private pickVoice() {
    if (!this.supported) return;
    const voices = speechSynthesis.getVoices();
    const base = this.lang.split('-')[0];
    this.voice = voices.find((v) => v.lang === this.lang) ?? voices.find((v) => v.lang.startsWith(base)) ?? null;
  }

  /** Plain announcement (e.g. calibration instruction). */
  say(text: string, key = text, priority = 2, cooldownMs = 3000) {
    this.speak(text, key, priority, cooldownMs);
  }

  cues(cues: SpeechCue[], t: Translate) {
    // Only the most important cue of this frame is spoken.
    const top = [...cues].sort((a, b) => b.priority - a.priority)[0];
    if (!top) return;
    this.speak(t(top.key, top.params), top.key + JSON.stringify(top.params ?? {}), top.priority, top.cooldownMs, top.key);
  }

  private speak(text: string, dedupeKey: string, priority: number, cooldownMs: number, cooldownKey = dedupeKey) {
    const now = performance.now();
    const last = this.lastSpoken.get(cooldownKey) ?? -Infinity;
    if (now - last < cooldownMs) return;
    this.lastSpoken.set(cooldownKey, now);
    this.onCaption?.(text);
    if (!this.supported || this.muted) return;
    const busy = speechSynthesis.speaking && this.current && now - this.current.at < 4000;
    if (busy && this.current && priority <= this.current.priority && priority < 4) return;
    if (busy) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.lang;
    u.rate = this.rate;
    if (this.voice) u.voice = this.voice;
    u.onend = () => {
      this.current = null;
    };
    this.current = { priority, at: now };
    speechSynthesis.speak(u);
  }

  stop() {
    if (this.supported) speechSynthesis.cancel();
    this.current = null;
  }
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
