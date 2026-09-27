import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { VIEWS, regionLabel, type BodyView, type RegionShape, type Shape } from './regions';

interface Props {
  selected: string[];
  onToggle: (id: string) => void;
  readOnly?: boolean;
  initialView: BodyView;
  compact?: boolean;
}

const X = (n: number) => (n - 110) * 0.023;
const Y = (n: number) => (240 - n) * 0.023;
const flesh = 0xae6252;
const selectedColor = 0xe3a17e;
const unit = new THREE.SphereGeometry(1, 20, 16);

function bounds(shape: Shape) {
  if (shape.kind === 'ellipse') return { x: shape.cx, y: shape.cy, w: shape.rx, h: shape.ry, angle: shape.rotate ?? 0 };
  if (shape.kind === 'capsule') return {
    x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2,
    w: Math.max(shape.r1, shape.r2), h: Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) / 2 + Math.min(shape.r1, shape.r2),
    angle: -Math.atan2(shape.x2 - shape.x1, shape.y2 - shape.y1) * 180 / Math.PI,
  };
  const nums = [...shape.d.matchAll(/[-+]?\d*\.?\d+/g)].map((m) => Number(m[0]));
  // Path shapes in the region registry contain paired absolute coordinates.
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: (maxX - minX) / 2, h: (maxY - minY) / 2, angle: 0 };
}

function partDepth(id: string) {
  if (/head/.test(id)) return 0.38;
  if (/chest|back|abdomen|groin|buttock/.test(id)) return 0.33;
  if (/thigh|shoulder/.test(id)) return 0.31;
  return 0.23;
}

function makePart(region: RegionShape, surface: 'front' | 'back') {
  const { x, y, w, h, angle } = bounds(region.shape);
  const depth = partDepth(region.id);
  const geometry = unit;
  const material = new THREE.MeshStandardMaterial({ color: flesh, roughness: 0.76, metalness: 0, side: THREE.FrontSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(X(x), Y(y), (surface === 'front' ? 1 : -1) * depth * 0.42);
  mesh.scale.set(Math.max(w * 0.023, 0.1), Math.max(h * 0.023, 0.1), depth);
  mesh.rotation.z = THREE.MathUtils.degToRad(angle);
  mesh.userData.regionId = region.id;
  mesh.castShadow = false;
  return mesh;
}

function addSurfaceDetails(group: THREE.Group) {
  const tendon = new THREE.MeshStandardMaterial({ color: 0xd6a38c, roughness: 0.85 });
  const line = (points: number[][], radius = 0.013) => {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, radius, 5, false), tendon);
    mesh.raycast = () => undefined;
    group.add(mesh);
  };
  // Tendon and muscle separations add readable depth without presenting the model as a scan.
  line([[0, Y(87), 0.37], [0, Y(145), 0.39], [0, Y(206), 0.36]]);
  for (const sign of [-1, 1]) {
    line([[0, Y(90), 0.38], [sign * 0.33, Y(100), 0.55], [sign * 0.69, Y(120), 0.35]]);
    line([[sign * 0.1, Y(140), 0.36], [sign * 0.38, Y(147), 0.39], [sign * 0.67, Y(137), 0.32]]);
    for (const y of [160, 177, 193]) line([[sign * 0.1, Y(y), 0.35], [sign * 0.36, Y(y + 2), 0.39], [sign * 0.62, Y(y - 2), 0.3]], 0.009);
    line([[sign * 0.1, Y(256), 0.43], [sign * 0.36, Y(285), 0.48], [sign * 0.34, Y(309), 0.3]]);
  }
}

/** A genuine local WebGL anatomical viewer. It is illustrative, not patient-specific imaging. */
export default function BodyMap3D({ selected, onToggle, readOnly, initialView, compact }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const selectRef = useRef(selected);
  const toggleRef = useRef(onToggle);
  const [failed, setFailed] = useState(false);
  selectRef.current = selected;
  toggleRef.current = onToggle;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); }
    catch { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.9;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0, 17.8);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x514137, 2.1));
    const key = new THREE.DirectionalLight(0xffecd9, 3.2); key.position.set(-4, 6, 9); scene.add(key);
    const rim = new THREE.DirectionalLight(0x7ccbc0, 1.3); rim.position.set(5, 3, -7); scene.add(rim);
    const figure = new THREE.Group(); scene.add(figure);
    const parts = [...VIEWS.front.map((r) => makePart(r, 'front')), ...VIEWS.back.map((r) => makePart(r, 'back'))];
    for (const part of parts) figure.add(part);
    addSurfaceDetails(figure);
    figure.rotation.y = initialView === 'back' ? Math.PI : initialView === 'left' ? -Math.PI / 2 : initialView === 'right' ? Math.PI / 2 : 0;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let raf = 0;
    let start: { x: number; y: number; rotation: number; moved: boolean } | null = null;
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const draw = () => {
      for (const p of parts) {
        const material = p.material as THREE.MeshStandardMaterial;
        material.color.setHex(selectRef.current.includes(p.userData.regionId as string) ? selectedColor : flesh);
        material.emissive.setHex(selectRef.current.includes(p.userData.regionId as string) ? 0x401810 : 0x000000);
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(draw);
    };
    draw();
    const down = (e: PointerEvent) => {
      renderer.domElement.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY, rotation: figure.rotation.y, moved: false };
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      if (Math.abs(dx) > 5 || Math.abs(e.clientY - start.y) > 5) start.moved = true;
      if (start.moved) figure.rotation.y = start.rotation + dx * 0.012;
    };
    const up = (e: PointerEvent) => {
      if (!start || start.moved || readOnly) { start = null; return; }
      start = null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(parts)[0];
      if (hit?.object.userData.regionId) toggleRef.current(hit.object.userData.regionId as string);
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); camera.position.z = THREE.MathUtils.clamp(camera.position.z + e.deltaY * 0.012, 11, 24); };
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => { start = null; });
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('wheel', wheel);
      canvas.remove();
      renderer.dispose();
      for (const p of parts) (p.material as THREE.Material).dispose();
      scene.traverse((o) => { if (o instanceof THREE.Mesh && o.geometry !== unit) o.geometry.dispose(); });
    };
  }, [initialView, readOnly]);

  if (failed) return <p role="status">3D is unavailable on this device. Switch to the accessible 2D map.</p>;
  return <div className="bodymap-3d-wrap">
    <div ref={host} className={`bodymap-3d ${compact ? 'compact' : ''}`} role="img" aria-label="Interactive three-dimensional anatomical body model" />
    <div className="bodymap-3d-caption">Drag to rotate · Tap a region to select · Illustrated anatomy</div>
    {!readOnly && <div className="bodymap-3d-selected" aria-live="polite">{selected.length ? selected.map(regionLabel).join(' · ') : 'Select where you feel symptoms'}</div>}
  </div>;
}
