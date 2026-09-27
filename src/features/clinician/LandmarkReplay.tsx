import { useEffect, useRef } from 'react';
import { drawLevelLine, drawPlumbLine, drawSkeleton } from '../../camera/overlay';
import { LM } from '../../engine/landmarks';
import type { Landmark } from '../../engine/types';

/**
 * Re-renders a stored capture from its landmarks (and the still image, only if the patient
 * consented to image storage). Lets the clinician verify what the algorithm "saw".
 */
export function LandmarkReplay({ landmarks, width, height, view, image, maxHeight = 360 }: { landmarks: Landmark[]; width: number; height: number; view: string; image?: string; maxHeight?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    c.width = width;
    c.height = height;
    const paint = () => {
      const lateral = view.startsWith('lateral');
      const near = view === 'lateral_right' ? 'right' : 'left';
      const ankleX = lateral ? landmarks[near === 'left' ? LM.leftAnkle : LM.rightAnkle].x : (landmarks[LM.leftAnkle].x + landmarks[LM.rightAnkle].x) / 2;
      drawPlumbLine(ctx, ankleX, width, height);
      if (!lateral) {
        drawLevelLine(ctx, landmarks[LM.rightShoulder], landmarks[LM.leftShoulder], width, height, null, false);
        drawLevelLine(ctx, landmarks[LM.rightHip], landmarks[LM.leftHip], width, height, null, false);
      }
      drawSkeleton(ctx, landmarks, width, height, { mirrored: false });
    };
    ctx.fillStyle = '#0d1a1d';
    ctx.fillRect(0, 0, width, height);
    if (image) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
        ctx.fillStyle = 'rgba(7,16,18,0.35)';
        ctx.fillRect(0, 0, width, height);
        paint();
      };
      img.src = image;
    } else paint();
  }, [landmarks, width, height, view, image]);
  return <canvas ref={ref} style={{ width: '100%', maxHeight, objectFit: 'contain', background: '#0d1a1d', borderRadius: 12, display: 'block' }} role="img" aria-label={`Landmark capture, ${view}`} />;
}
