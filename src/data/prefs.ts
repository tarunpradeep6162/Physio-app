import { useSyncExternalStore } from 'react';
import type { ImageTone } from '../camera/postureGrid';
import type { FilterKind } from '../engine/filters';
import type { PoseProviderId } from '../engine/pose/provider';
import type { Locale } from '../i18n';

/** Per-device preferences (accessibility, language, voice, pose runtime). */
export interface Prefs {
  locale: Locale;
  largeText: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  voice: boolean;
  captions: boolean;
  haptics: boolean;
  poseProvider: PoseProviderId;
  filter: FilterKind;
  /** Where pose inference runs: 'auto' = Web Worker when supported. 'main' is for fallback testing. */
  inferenceThread: 'auto' | 'main';
  /** Posture scan camera image tone (display only). */
  scanTone: ImageTone;
  /** Body map display chosen by this person; unset = decided by screen size and data saver. */
  bodyMapMode?: '3d' | '2d';
  /** 3D anatomy model detail chosen by this person; unset = light on phones and data saver. */
  anatomyDetail?: AnatomyDetail;
}

/** 'lite' is the phone-weight simplified model (Phase 41); 'full' the original packed model. */
export type AnatomyDetail = 'lite' | 'full';

const KEY = 'physiovision.prefs';

const DEFAULT_PREFS: Prefs = {
  locale: 'en',
  largeText: false,
  highContrast: false,
  reducedMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  voice: true,
  captions: true,
  haptics: true,
  poseProvider: 'mediapipe-lite',
  filter: 'one_euro',
  inferenceThread: 'auto',
  scanTone: 'colour',
};

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

let prefs = load();
const listeners = new Set<() => void>();

export function getPrefs(): Prefs {
  return prefs;
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getPrefs,
  );
}
