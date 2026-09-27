import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Camera roll from the device orientation sensor (phones/tablets). Laptops have no sensor and
 * report null — calibration then shows "unknown" rather than pretending the camera is level.
 *
 * For a phone standing upright, roll ≈ gamma in portrait and ≈ beta−90 style offsets in
 * landscape; we use screen.orientation to pick the right axis.
 */
export function useDeviceRoll(): { roll: number | null; needsPermission: boolean; request: () => void } {
  const [roll, setRoll] = useState<number | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const smoothed = useRef<number | null>(null);

  const attach = useCallback(() => {
    const handler = (e: DeviceOrientationEvent) => {
      if (e.gamma === null || e.beta === null) return;
      const angle = (screen.orientation?.angle ?? 0) % 360;
      // Portrait: tilt left/right = gamma. Landscape: tilt = beta (sign depends on rotation).
      let r = e.gamma;
      if (angle === 90) r = -e.beta;
      else if (angle === 270) r = e.beta;
      smoothed.current = smoothed.current === null ? r : smoothed.current * 0.8 + r * 0.2;
      setRoll(Math.round(smoothed.current * 10) / 10);
    };
    window.addEventListener('deviceorientation', handler);
    return () => window.removeEventListener('deviceorientation', handler);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE.requestPermission === 'function') {
      setNeedsPermission(true); // iOS: must be requested from a user gesture
      return;
    }
    return attach();
  }, [attach]);

  const request = useCallback(() => {
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    DOE.requestPermission?.().then((s) => {
      if (s === 'granted') {
        setNeedsPermission(false);
        attach();
      }
    });
  }, [attach]);

  return { roll, needsPermission, request };
}
