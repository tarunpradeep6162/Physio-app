import { useEffect, useRef } from 'react';
import { renderFrame } from '../../camera/mannequin';
import { synthesize } from '../../engine/pose/synthetic';
import type { ProtocolDef } from '../../engine/protocols/types';
import type { Side } from '../../engine/types';

/**
 * Per-test setup card: an illustrated, unobstructed example of what the camera should see for
 * THIS test (orientation, view, the body region that must stay visible) plus concise placement,
 * distance, lighting and clothing guidance. The example is a drawn figure, not a photograph.
 */
export function SetupGuide({ def, side, mirrored }: { def: ProtocolDef; side: Side | null; mirrored: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const g = def.guide;
  const landscape = def.framing?.orientation === 'landscape';

  useEffect(() => {
    const c = ref.current;
    if (!c || !g) return;
    const W = landscape ? 640 : 360;
    const H = landscape ? 360 : 640;
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const scene = g.example(side);
    // The synthetic layouts are designed for a 9:16 frame; landscape examples are laid out in 16:9.
    const lms = synthesize(scene, { width: landscape ? 1280 : 720, height: landscape ? 720 : 1280 });
    const hip = lms[side === 'right' ? 24 : 23];
    renderFrame(ctx, [{ lms }], {
      mat: def.position === 'supine',
      chair: def.position === 'seated_to_standing' ? { x: hip.x, y: hip.y + 0.02 } : null,
      mirror: mirrored,
    });
    const px = (x: number) => (mirrored ? (1 - x) * W : x * W);
    // Required joints: teal rings.
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#2dd4bf';
    for (const i of def.requiredLandmarks(side)) {
      ctx.beginPath();
      ctx.arc(px(lms[i].x), lms[i].y * H, Math.max(7, W / 45), 0, Math.PI * 2);
      ctx.stroke();
    }
    // Distance band: the range the test region should occupy along the framing axis.
    if (def.framing) {
      const ext = def.framing.extentLandmarks(side).map((i) => lms[i]);
      const [lo, hi] = def.framing.range;
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      if (def.framing.axis === 'horizontal') {
        const cx = (Math.min(...ext.map((l) => px(l.x))) + Math.max(...ext.map((l) => px(l.x)))) / 2;
        for (const f of [lo, hi]) ctx.strokeRect(cx - (f * W) / 2, H * 0.08, f * W, H * 0.84);
      } else {
        const cy = ((Math.min(...ext.map((l) => l.y)) + Math.max(...ext.map((l) => l.y))) / 2) * H;
        for (const f of [lo, hi]) ctx.strokeRect(W * 0.1, cy - (f * H) / 2, W * 0.8, f * H);
      }
      ctx.setLineDash([]);
    }
  }, [def, side, g, landscape, mirrored]);

  if (!g) {
    return (
      <ol className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
        {def.setup.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    );
  }
  return (
    <details open className="setup-guide">
      <summary>
        <strong>Set up for this test</strong> <span className="xs" style={{ color: '#8fb0aa' }}>({landscape ? 'phone sideways' : 'phone upright'})</span>
      </summary>
      <div className="setup-guide-body">
        <figure style={{ margin: 0 }}>
          <canvas ref={ref} className={`setup-guide-canvas ${landscape ? 'landscape' : 'portrait'}`} role="img" aria-label={`Example camera view: ${g.view} ${g.region}`} />
          <figcaption className="xs" style={{ color: '#8fb0aa' }}>
            Drawn example of the camera view. Rings = joints that must stay visible; dashed boxes = closest and farthest framing.
          </figcaption>
        </figure>
        <dl className="setup-facts small">
          <dt>Camera</dt>
          <dd>{g.camera}</dd>
          <dt>Position</dt>
          <dd>{g.view}</dd>
          <dt>Distance</dt>
          <dd>{g.distance}</dd>
          <dt>Must be visible</dt>
          <dd>{g.region}</dd>
          <dt>Light</dt>
          <dd>{g.lighting}</dd>
          <dt>Clothing</dt>
          <dd>{g.clothing}</dd>
        </dl>
      </div>
    </details>
  );
}
