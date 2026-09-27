/**
 * Anatomical pain-map regions. Region ids are view-independent where the same surface is visible
 * from several views (e.g. `knee_left` is selectable from the front AND the left-side view), so a
 * future 3D renderer can reuse exactly the same ids and stored assessments stay valid.
 */

export type BodyView = 'front' | 'right' | 'back' | 'left';
export const VIEW_ORDER: BodyView[] = ['front', 'right', 'back', 'left'];

export type Shape =
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotate?: number }
  | { kind: 'capsule'; x1: number; y1: number; x2: number; y2: number; r1: number; r2: number }
  | { kind: 'path'; d: string };

export interface RegionShape {
  id: string;
  shape: Shape;
}

type S = 'left' | 'right';

/** Tapered capsule between two points: an anatomical limb segment. */
export function capsulePath(x1: number, y1: number, x2: number, y2: number, r1: number, r2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const f = (n: number) => n.toFixed(2);
  return [
    `M${f(x1 + nx * r1)},${f(y1 + ny * r1)}`,
    `L${f(x2 + nx * r2)},${f(y2 + ny * r2)}`,
    `A${f(r2)},${f(r2)} 0 0 1 ${f(x2 - nx * r2)},${f(y2 - ny * r2)}`,
    `L${f(x1 - nx * r1)},${f(y1 - ny * r1)}`,
    `A${f(r1)},${f(r1)} 0 0 1 ${f(x1 + nx * r1)},${f(y1 + ny * r1)}`,
    'Z',
  ].join(' ');
}

const CX = 110;
/** Mirror an x coordinate around the body midline. */
const mx = (x: number) => 2 * CX - x;
/** Mirror an SVG path's absolute x coordinates (only M/L/Q/A/Z with absolute numbers). */
function mirrorPath(d: string): string {
  return d.replace(/([MLQ])([\d.\-]+),([\d.\-]+)(?:\s+([\d.\-]+),([\d.\-]+))?/g, (_m, cmd: string, x1: string, y1: string, x2?: string, y2?: string) => {
    let out = `${cmd}${mx(+x1)},${y1}`;
    if (x2 !== undefined) out += ` ${mx(+x2)},${y2}`;
    return out;
  });
}

function mirrorShape(s: Shape): Shape {
  if (s.kind === 'ellipse') return { ...s, cx: mx(s.cx), rotate: s.rotate ? -s.rotate : undefined };
  if (s.kind === 'capsule') return { ...s, x1: mx(s.x1), x2: mx(s.x2) };
  return { kind: 'path', d: mirrorPath(s.d) };
}

/**
 * Bilateral helper: `geom` is authored for the side drawn on the VIEWER'S LEFT (x < 110).
 * In the front view that is the patient's RIGHT; in the back view it is the patient's LEFT.
 */
function bilateral(idFor: (s: S) => string, viewerLeftSide: S, geom: Shape): RegionShape[] {
  const other: S = viewerLeftSide === 'left' ? 'right' : 'left';
  return [
    { id: idFor(viewerLeftSide), shape: geom },
    { id: idFor(other), shape: mirrorShape(geom) },
  ];
}

const cap = (x1: number, y1: number, x2: number, y2: number, r1: number, r2: number): Shape => ({ kind: 'capsule', x1, y1, x2, y2, r1, r2 });

function frontOrBack(view: 'front' | 'back'): RegionShape[] {
  const vl: S = view === 'front' ? 'right' : 'left';
  const back = view === 'back';
  const sfx = back ? '_back' : '';
  return [
    { id: back ? 'head_back' : 'head', shape: { kind: 'ellipse', cx: CX, cy: 40, rx: 21, ry: 26 } },
    { id: back ? 'neck_back' : 'neck_front', shape: cap(CX, 66, CX, 84, 10, 12) },
    ...bilateral((s) => (back ? `upper_back_${s}` : `chest_${s}`), vl, { kind: 'path', d: back ? 'M110,86 L86,88 Q74,94 74,110 L76,150 Q94,154 110,152 Z' : 'M110,86 L86,88 Q74,94 74,110 L76,138 Q94,146 110,142 Z' }),
    ...(back
      ? [
          { id: 'mid_back_center', shape: { kind: 'path', d: 'M76,150 Q94,154 110,152 Q126,154 144,150 L142,178 L78,178 Z' } as Shape },
          { id: 'lower_back_center', shape: { kind: 'path', d: 'M78,178 L142,178 L146,206 Q128,212 110,212 Q92,212 74,206 Z' } as Shape },
        ].map((r) => ({ id: r.id, shape: r.shape }))
      : [
          { id: 'abdomen_upper', shape: { kind: 'path', d: 'M76,138 Q94,146 110,142 Q126,146 144,138 L142,178 L78,178 Z' } as Shape },
          { id: 'abdomen_lower', shape: { kind: 'path', d: 'M78,178 L142,178 L146,206 Q128,214 110,216 Q92,214 74,206 Z' } as Shape },
        ]),
    ...bilateral((s) => (back ? `buttock_${s}` : `groin_${s}`), vl, { kind: 'path', d: back ? 'M74,206 Q92,212 110,212 L110,236 Q94,248 80,240 Q70,226 74,206 Z' : 'M74,206 Q92,214 110,216 L106,236 L80,236 Q72,222 74,206 Z' }),
    ...bilateral((s) => `shoulder_${s}${sfx}`, vl, cap(80, 94, 66, 110, 13, 12)),
    ...bilateral((s) => `upper_arm_${s}${sfx}`, vl, cap(63, 116, 54, 172, 11, 9)),
    ...bilateral((s) => `elbow_${s}${sfx}`, vl, cap(53, 178, 51, 192, 9, 8.5)),
    ...bilateral((s) => `forearm_${s}${sfx}`, vl, cap(50, 198, 43, 248, 8, 6)),
    ...bilateral((s) => `wrist_${s}${sfx}`, vl, cap(43, 253, 42, 262, 6, 6)),
    ...bilateral((s) => `hand_${s}${sfx}`, vl, { kind: 'ellipse', cx: 40, cy: 281, rx: 9, ry: 15, rotate: 6 }),
    ...bilateral((s) => `thigh_${s}_${back ? 'back' : 'front'}`, vl, cap(95, 244, 92, 316, 16, 12)),
    ...bilateral((s) => `knee_${s}${sfx}`, vl, cap(92, 324, 92, 344, 12.5, 11)),
    ...bilateral((s) => (back ? `calf_${s}` : `shin_${s}`), vl, cap(92, 352, 94, 418, back ? 12 : 10.5, 7)),
    ...bilateral((s) => (back ? `achilles_${s}` : `ankle_${s}`), vl, cap(94, 424, 94, 434, 7, 7)),
    ...bilateral((s) => (back ? `heel_${s}` : `foot_${s}`), vl, { kind: 'ellipse', cx: 93, cy: back ? 446 : 450, rx: back ? 9 : 10, ry: back ? 8 : 12 }),
  ];
}

/** Left-side view (patient faces screen-left, so their LEFT side faces the viewer). */
function lateral(side: S): RegionShape[] {
  const s = side;
  const regions: RegionShape[] = [
    { id: 'upper_back_' + s, shape: { kind: 'path', d: 'M110,88 L110,148 L128,148 Q134,118 124,94 Q118,88 110,88 Z' } },
    { id: 'chest_' + s, shape: { kind: 'path', d: 'M110,88 Q90,90 86,112 L90,148 L110,148 Z' } },
    { id: 'flank_' + s, shape: { kind: 'path', d: 'M90,148 L110,148 L110,198 L88,198 Q84,172 90,148 Z' } },
    { id: 'lower_back_center', shape: { kind: 'path', d: 'M110,148 L128,148 Q132,174 131,198 L110,198 Z' } },
    { id: 'buttock_' + s, shape: { kind: 'path', d: 'M112,198 L131,198 Q140,218 132,240 L116,240 Z' } },
    { id: 'groin_' + s, shape: { kind: 'path', d: 'M88,198 L108,198 L106,236 L92,236 Q86,218 88,198 Z' } },
    { id: 'hip_' + s + '_lateral', shape: { kind: 'ellipse', cx: 111, cy: 220, rx: 13, ry: 16 } },
    { id: 'thigh_' + s + '_lateral', shape: cap(110, 246, 106, 314, 17, 12.5) },
    { id: 'knee_' + s, shape: cap(105, 322, 105, 344, 12.5, 11) },
    { id: 'shin_' + s, shape: cap(100, 352, 102, 418, 6.5, 5) },
    { id: 'calf_' + s, shape: cap(111, 354, 108, 412, 9, 5.5) },
    { id: 'ankle_' + s, shape: cap(105, 424, 105, 434, 7, 7) },
    { id: 'foot_' + s, shape: { kind: 'ellipse', cx: 94, cy: 446, rx: 20, ry: 8 } },
    { id: 'head', shape: { kind: 'ellipse', cx: 106, cy: 40, rx: 22, ry: 25 } },
    { id: 'neck_side_' + s, shape: cap(110, 66, 111, 86, 9, 10) },
    { id: 'shoulder_' + s, shape: cap(112, 96, 113, 110, 14, 13) },
    { id: 'upper_arm_' + s, shape: cap(113, 118, 115, 172, 10.5, 8.5) },
    { id: 'elbow_' + s, shape: cap(115, 178, 115, 192, 8.5, 8) },
    { id: 'forearm_' + s, shape: cap(114, 198, 110, 246, 7.5, 5.5) },
    { id: 'wrist_' + s, shape: cap(110, 251, 109, 259, 5.5, 5.5) },
    { id: 'hand_' + s, shape: { kind: 'ellipse', cx: 108, cy: 276, rx: 7, ry: 14, rotate: -4 } },
  ];
  return side === 'left' ? regions : regions.map((r) => ({ id: r.id, shape: mirrorShape(r.shape) }));
}

export const VIEWS: Record<BodyView, RegionShape[]> = {
  front: frontOrBack('front'),
  back: frontOrBack('back'),
  left: lateral('left'),
  right: lateral('right'),
};

// ---- Labels -------------------------------------------------------------------------------------

const PARTS_EN: Record<string, string> = {
  head: 'Head',
  head_back: 'Back of head',
  neck_front: 'Front of neck',
  neck_back: 'Back of neck',
  neck_side: 'Side of neck',
  chest: 'Chest',
  upper_back: 'Upper back',
  mid_back_center: 'Mid back',
  lower_back_center: 'Lower back',
  abdomen_upper: 'Upper abdomen',
  abdomen_lower: 'Lower abdomen',
  flank: 'Side of trunk',
  groin: 'Hip / groin (front)',
  buttock: 'Buttock',
  hip_lateral: 'Outer hip',
  shoulder: 'Shoulder (front)',
  shoulder_back: 'Shoulder blade',
  upper_arm: 'Upper arm',
  upper_arm_back: 'Back of upper arm',
  elbow: 'Elbow',
  elbow_back: 'Back of elbow',
  forearm: 'Forearm',
  forearm_back: 'Back of forearm',
  wrist: 'Wrist',
  wrist_back: 'Back of wrist',
  hand: 'Hand (palm)',
  hand_back: 'Back of hand',
  thigh_front: 'Front of thigh',
  thigh_back: 'Back of thigh',
  thigh_lateral: 'Outer thigh',
  knee: 'Knee',
  knee_back: 'Back of knee',
  shin: 'Shin',
  calf: 'Calf',
  ankle: 'Ankle',
  achilles: 'Achilles',
  heel: 'Heel',
  foot: 'Foot',
};

/** Splits an id like `knee_left_back` into { part: 'knee_back', side: 'left' }. */
export function parseRegion(id: string): { part: string; side: S | null } {
  const m = id.match(/^(.*?)_(left|right)(?:_(.*))?$/);
  if (!m) return { part: id, side: null };
  return { part: m[3] ? `${m[1]}_${m[3]}` : m[1], side: m[2] as S };
}

export function regionLabel(id: string): string {
  const { part, side } = parseRegion(id);
  const name = PARTS_EN[part] ?? part.replace(/_/g, ' ');
  return side ? `${side === 'left' ? 'Left' : 'Right'} ${name.charAt(0).toLowerCase()}${name.slice(1)}` : name;
}

/** Views in which a region can be seen (used to show selection counts per view). */
export function viewsFor(id: string): BodyView[] {
  return VIEW_ORDER.filter((v) => VIEWS[v].some((r) => r.id === id));
}
