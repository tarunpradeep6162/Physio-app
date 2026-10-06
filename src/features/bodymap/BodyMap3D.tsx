import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { recordIncident } from '../../app/incidents';
import { classifyMesh, regionAt } from './anatomyRegions';
import { regionLabel, type BodyView } from './regions';

interface Props {
  selected: string[];
  onToggle: (id: string) => void;
  onUnavailable: (reason: 'webgl' | 'model') => void;
  readOnly?: boolean;
  initialView: BodyView;
  compact?: boolean;
}
type Part = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
const ROOT = '/anatomy/';

const VIEW_ANGLE: Record<BodyView, number> = { front: 0, back: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
const VIEW_LABEL: Record<BodyView, string> = { front: 'Front', back: 'Back', left: 'Left side', right: 'Right side' };
const ZOOM = { min: 10, max: 25, step: 2 } as const;

// Tissue colours, written as sRGB and stored LINEAR (vertex colours are linear in the renderer).
const lin = (c: number) => Math.round(255 * new THREE.Color().setRGB(c / 255, 0, 0, THREE.SRGBColorSpace).r);
const rgb = (r: number, g: number, b: number) => [lin(r), lin(g), lin(b)] as const;
const RGB = { muscle: rgb(173, 80, 58), tendon: rgb(228, 203, 174), bone: rgb(216, 204, 181), hover: rgb(251, 191, 36), selected: rgb(56, 189, 248) };

/**
 * Region ids are stored per VERTEX, computed once from the model's own coordinates (see
 * anatomyRegions.ts). Selection never depends on the camera angle, a long muscle can be selected by
 * part, and highlighting shows exactly the selected region.
 */
interface Tagged {
  mesh: Part;
  /** Index into `ids` for each vertex. */
  region: Uint16Array;
  base: readonly number[];
}

// BodyParts3D is Z-up with −Y anterior. Adapt in place to Three.js Y-up, facing +Z (the camera).
function orient(geometry: THREE.BufferGeometry, origin: THREE.Vector3, scale: number) {
  const p = geometry.getAttribute('position') as THREE.BufferAttribute;
  const n = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, (x - origin.x) * scale, (z - origin.z) * scale, -(y - origin.y) * scale);
  }
  if (n) for (let i = 0; i < n.count; i++) {
    const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
    n.setXYZ(i, x, z, -y);
  }
  p.needsUpdate = true;
  if (n) n.needsUpdate = true;
  // The loader stored bounds in the source frame; stale bounds make ray tests (taps) miss.
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function load(loader: GLTFLoader, url: string, progress?: (f: number) => void) {
  return new Promise<THREE.Group>((resolve, reject) => loader.load(url, (g) => resolve(g.scene), (e) => { if (e.total) progress?.(e.loaded / e.total); }, reject));
}

/** A licensed anatomical atlas, not a rendering or diagnosis of the patient. */
export default function BodyMap3D({ selected, onToggle, onUnavailable, readOnly, initialView, compact }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected), toggleRef = useRef(onToggle), unavailableRef = useRef(onUnavailable);
  const api = useRef<{ rotateTo: (a: number) => void; rotateBy: (d: number) => void; zoom: (d: number) => void; draw: () => void } | null>(null);
  const [status, setStatus] = useState('Loading anatomical model…');
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<BodyView | null>(initialView);
  selectedRef.current = selected;
  toggleRef.current = onToggle;
  unavailableRef.current = onUnavailable;
  useEffect(() => api.current?.draw(), [selected]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      unavailableRef.current('webgl');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.7;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 80);
    camera.position.set(0, 0, 17.5);
    scene.add(new THREE.HemisphereLight(0xffe9d9, 0x403030, 2.5));
    const key = new THREE.DirectionalLight(0xffdfc5, 3);
    key.position.set(-4, 6, 8);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8ebfbd, 1.5);
    rim.position.set(5, 3, -6);
    scene.add(rim);
    const figure = new THREE.Group();
    scene.add(figure);
    figure.rotation.y = VIEW_ANGLE[initialView];
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, side: THREE.DoubleSide });

    const ids: string[] = [];
    const idIndex = new Map<string, number>();
    const indexOf = (id: string) => {
      let i = idIndex.get(id);
      if (i === undefined) {
        i = ids.length;
        ids.push(id);
        idIndex.set(id, i);
      }
      return i;
    };
    const parts: Tagged[] = [];
    let disposed = false, frame = 0, hoverIdx = -1;
    let lastColoured: { sel: string; hover: number } | null = null;
    let origin: THREE.Vector3 | null = null, scale = 1;

    const colour = () => {
      const sel = selectedRef.current;
      const key = sel.join('|');
      if (lastColoured && lastColoured.sel === key && lastColoured.hover === hoverIdx) return;
      lastColoured = { sel: key, hover: hoverIdx };
      const selectedIdx = new Set(sel.map((s) => idIndex.get(s)).filter((i): i is number => i !== undefined));
      for (const t of parts) {
        const c = t.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
        const arr = c.array as Uint8Array;
        for (let v = 0; v < t.region.length; v++) {
          const r = t.region[v];
          const rgb = selectedIdx.has(r) ? RGB.selected : r === hoverIdx ? RGB.hover : t.base;
          arr[v * 3] = rgb[0];
          arr[v * 3 + 1] = rgb[1];
          arr[v * 3 + 2] = rgb[2];
        }
        c.needsUpdate = true;
      }
    };
    const render = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        colour();
        renderer.render(scene, camera);
      });
    };
    const snapView = () => {
      const a = ((figure.rotation.y % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const near = (t: number) => Math.min(Math.abs(a - t), 2 * Math.PI - Math.abs(a - t)) < 0.05;
      setView(near(0) ? 'front' : near(Math.PI) ? 'back' : near((3 * Math.PI) / 2) ? 'left' : near(Math.PI / 2) ? 'right' : null);
    };
    api.current = {
      rotateTo: (a) => { figure.rotation.y = a; snapView(); render(); },
      rotateBy: (d) => { figure.rotation.y += d; snapView(); render(); },
      zoom: (d) => { camera.position.z = THREE.MathUtils.clamp(camera.position.z + d, ZOOM.min, ZOOM.max); render(); },
      draw: () => { lastColoured = null; render(); },
    };
    const resize = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    /** Tags every vertex with its region (source coordinates), then orients the geometry in place. */
    const seen = new WeakSet<THREE.BufferGeometry>();
    const add = (root: THREE.Group, kind: 'muscle' | 'bone') =>
      root.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const geometry = node.geometry as THREE.BufferGeometry;
        // Oriented in place: a geometry shared by two nodes must only be processed once.
        if (seen.has(geometry)) return;
        seen.add(geometry);
        const info = classifyMesh(node.name || '');
        const p = geometry.getAttribute('position');
        const region = new Uint16Array(p.count);
        for (let v = 0; v < p.count; v++) region[v] = indexOf(regionAt(info, p.getX(v), p.getY(v), p.getZ(v)));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(p.count * 3), 3, true));
        orient(geometry, origin!, scale);
        const mesh = new THREE.Mesh(geometry, material) as Part;
        mesh.name = node.name || 'anatomical structure';
        const tendon = /tendon|ligament|retinaculum|membrane|fascia|tract/i.test(mesh.name);
        figure.add(mesh);
        parts.push({ mesh, region, base: kind === 'bone' ? RGB.bone : tendon ? RGB.tendon : RGB.muscle });
      });

    const loader = new GLTFLoader();
    load(loader, ROOT + 'anatomy.glb', (f) => setStatus(`Loading anatomical model… ${Math.round(f * 100)}%`))
      .then((anatomy) => {
        if (disposed) return;
        const box = new THREE.Box3().setFromObject(anatomy);
        origin = box.getCenter(new THREE.Vector3());
        scale = 8.7 / box.getSize(new THREE.Vector3()).z;
        add(anatomy, 'muscle');
        setStatus('');
        render();
        // The skeleton adds context and lets bony landmarks (kneecap, shin, collarbone) be tapped.
        // A failed optional download must not hide usable anatomy.
        load(loader, ROOT + 'skeleton.glb')
          .then((skeleton) => {
            if (disposed) return;
            add(skeleton, 'bone');
            api.current?.draw();
          })
          .catch((error) => { if (!disposed) recordIncident('error', error); });
      })
      .catch((error) => {
        if (!disposed) {
          recordIncident('error', error);
          unavailableRef.current('model');
        }
      });

    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(), canvas = renderer.domElement;
    /** Region under the pointer: the first surface hit, bone or muscle, and the vertex nearest the hit. */
    const hit = (clientX: number, clientY: number): number => {
      const r = canvas.getBoundingClientRect();
      pointer.set(((clientX - r.left) / r.width) * 2 - 1, (-(clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const h = ray.intersectObjects(parts.map((t) => t.mesh), false)[0];
      if (!h?.face) return -1;
      const t = parts.find((x) => x.mesh === h.object);
      if (!t) return -1;
      const local = t.mesh.worldToLocal(h.point.clone());
      const pos = t.mesh.geometry.getAttribute('position');
      let best = h.face.a, bestD = Infinity;
      for (const v of [h.face.a, h.face.b, h.face.c]) {
        const d = (pos.getX(v) - local.x) ** 2 + (pos.getY(v) - local.y) ** 2 + (pos.getZ(v) - local.z) ** 2;
        if (d < bestD) { bestD = d; best = v; }
      }
      return t.region[best];
    };
    let drag: { x: number; y: number; a: number; moved: boolean } | null = null;
    let hoverQueued = false;
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, a: figure.rotation.y, moved: false };
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.x;
        if (Math.abs(dx) > 6) drag.moved = true;
        if (drag.moved) {
          figure.rotation.y = drag.a + dx * 0.012;
          render();
        }
        return;
      }
      // Hover feedback is for mice only, at most once per frame (ray tests are not free on phones).
      if (e.pointerType !== 'mouse' || hoverQueued) return;
      hoverQueued = true;
      requestAnimationFrame(() => {
        hoverQueued = false;
        const i = hit(e.clientX, e.clientY);
        if (i !== hoverIdx) {
          hoverIdx = i;
          setHover(i >= 0 ? ids[i] : null);
          render();
        }
      });
    };
    const up = (e: PointerEvent) => {
      if (drag && !drag.moved && !readOnly) {
        const i = hit(e.clientX, e.clientY);
        if (i >= 0) toggleRef.current(ids[i]);
      }
      if (drag?.moved) snapView();
      drag = null;
    };
    const leave = () => {
      if (hoverIdx !== -1) {
        hoverIdx = -1;
        setHover(null);
        render();
      }
    };
    // Plain scrolling scrolls the page; pinch (or Ctrl + scroll) zooms the model.
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      api.current?.zoom(e.deltaY * 0.01);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => (drag = null));
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      canvas.remove();
      for (const t of parts) t.mesh.geometry.dispose();
      material.dispose();
      renderer.dispose();
      api.current = null;
    };
  }, [initialView, readOnly]);

  const onKey = (e: KeyboardEvent) => {
    const a = api.current;
    if (!a) return;
    if (e.key === 'ArrowLeft') a.rotateBy(-Math.PI / 12);
    else if (e.key === 'ArrowRight') a.rotateBy(Math.PI / 12);
    else if (e.key === '+' || e.key === '=') a.zoom(-ZOOM.step);
    else if (e.key === '-') a.zoom(ZOOM.step);
    else return;
    e.preventDefault();
  };

  return (
    <div className="bodymap-3d-outer">
      <div className="bodymap-3d-wrap">
        <div
          ref={host}
          className={`bodymap-3d ${compact ? 'compact' : ''}`}
          role="img"
          tabIndex={0}
          onKeyDown={onKey}
          aria-label={`Rotatable 3D anatomical model, ${view ? VIEW_LABEL[view].toLowerCase() : 'turned'} view. Left and right arrow keys rotate, plus and minus zoom. Choose regions with the list below the model.${selected.length ? ` Selected: ${selected.map(regionLabel).join(', ')}.` : ''}`}
        />
        {status && <div className="bodymap-3d-status" role="status">{status}</div>}
        <div className="bodymap-3d-caption" aria-hidden="true">{readOnly ? 'Drag to rotate' : 'Drag to rotate · Tap where you feel it'}</div>
        <div className="bodymap-3d-views" role="group" aria-label="Body view">
          {(Object.keys(VIEW_ANGLE) as BodyView[]).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => api.current?.rotateTo(VIEW_ANGLE[v])}>
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
        <div className="bodymap-3d-zoom" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom in" onClick={() => api.current?.zoom(-ZOOM.step)}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => api.current?.zoom(ZOOM.step)}>−</button>
        </div>
      </div>
      <div className="bodymap-3d-footer">
        <div className="bodymap-3d-selected" aria-live="polite">
          {hover ? `${regionLabel(hover)}${selected.includes(hover) ? ' · selected' : ''}` : selected.length ? selected.map(regionLabel).join(' · ') : readOnly ? 'No locations marked' : 'Tap where you feel symptoms'}
        </div>
        <p className="bodymap-3d-credit">
          Anatomy: BodyParts3D / Z-Anatomy · CC BY-SA · Illustrative, not your scan ·{' '}
          <a href="/anatomy/SOURCE_ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">
            Model credits
          </a>
        </p>
      </div>
    </div>
  );
}
