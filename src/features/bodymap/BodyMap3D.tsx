import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { regionLabel, type BodyView } from './regions';

interface Props { selected: string[]; onToggle: (id: string) => void; readOnly?: boolean; initialView: BodyView; compact?: boolean }
type Part = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
const ROOT = 'https://raw.githubusercontent.com/JohanBellander/BodyExplorer/7d04bf3c4de2bd9cb234dd51d7e6857c099afafd/public/';

// BodyParts3D is Z-up with Y as depth. Adapt the geometries to Three.js Y-up.
function orient(geometry: THREE.BufferGeometry, origin: THREE.Vector3, scale: number) {
  const p = geometry.getAttribute('position') as THREE.BufferAttribute;
  const n = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, (x - origin.x) * scale, (z - origin.z) * scale, -(y - origin.y) * scale); }
  if (n) for (let i = 0; i < n.count; i++) { const x = n.getX(i), y = n.getY(i), z = n.getZ(i); n.setXYZ(i, x, z, -y); }
  p.needsUpdate = true; if (n) n.needsUpdate = true;
  geometry.computeBoundingSphere();
}

function region(name: string, point: THREE.Vector3, back: boolean) {
  const n = name.toLowerCase().replaceAll('_', ' ');
  const side = /\bleft\b/.test(n) ? 'left' : /\bright\b/.test(n) ? 'right' : point.x > 0 ? 'left' : 'right';
  const suffix = back ? '_back' : '';
  if (/head|face|occipit|temporalis|masseter/.test(n) || point.y > 3.35) return back ? 'head_back' : 'head';
  if (/neck|sternocleidomastoid|scalen|splenius/.test(n) || point.y > 2.85 && Math.abs(point.x) < 0.3) return back ? 'neck_back' : 'neck_front';
  if (/deltoid|supraspinatus|infraspinatus|teres|subscapular/.test(n)) return `shoulder_${side}${suffix}`;
  if (/trapezius|rhomboid|latissimus|erector spinae|multifidus/.test(n)) return back ? `upper_back_${side}` : `chest_${side}`;
  if (/pectoral|serratus|intercostal/.test(n)) return back ? `upper_back_${side}` : `chest_${side}`;
  if (/biceps brachii|brachialis|triceps|coracobrachialis/.test(n)) return `upper_arm_${side}${suffix}`;
  if (/brachioradialis|pronator|supinator|flexor|extensor|palmaris/.test(n) && point.y > -0.4) return `forearm_${side}${suffix}`;
  if (/hand|pollicis|digiti|lumbrical|interosseous/.test(n) && Math.abs(point.x) > 0.6) return `hand_${side}${suffix}`;
  if (/gluteus|piriformis/.test(n)) return back ? `buttock_${side}` : `groin_${side}`;
  if (/rectus abdominis|oblique|transversus abdominis/.test(n)) return back ? 'lower_back_center' : point.y > 0.3 ? 'abdomen_upper' : 'abdomen_lower';
  if (/quadriceps|rectus femoris|vastus|sartorius|adductor|hamstring|biceps femoris|semitendinosus|semimembranosus/.test(n)) return `thigh_${side}_${back ? 'back' : 'front'}`;
  if (/patella|patellar|popliteus/.test(n)) return `knee_${side}${suffix}`;
  if (/gastrocnemius|soleus|tibialis|peroneus|fibularis/.test(n)) return back ? `calf_${side}` : `shin_${side}`;
  if (/achilles|calcaneal/.test(n)) return back ? `achilles_${side}` : `ankle_${side}`;
  if (/foot|plantar|hallucis/.test(n)) return back ? `heel_${side}` : `foot_${side}`;
  if (point.y > 2) return Math.abs(point.x) > 0.55 ? `shoulder_${side}${suffix}` : back ? `upper_back_${side}` : `chest_${side}`;
  if (point.y > 0.3) return Math.abs(point.x) > 0.8 ? `upper_arm_${side}${suffix}` : back ? 'mid_back_center' : 'abdomen_upper';
  if (point.y > -0.4) return Math.abs(point.x) > 0.9 ? `forearm_${side}${suffix}` : back ? 'lower_back_center' : 'abdomen_lower';
  if (point.y > -2) return `thigh_${side}_${back ? 'back' : 'front'}`;
  if (point.y > -2.6) return `knee_${side}${suffix}`;
  if (point.y > -3.8) return back ? `calf_${side}` : `shin_${side}`;
  return back ? `heel_${side}` : `foot_${side}`;
}

function load(loader: GLTFLoader, url: string, progress?: (f: number) => void) {
  return new Promise<THREE.Group>((resolve, reject) => loader.load(url, (g) => resolve(g.scene), (e) => { if (e.total) progress?.(e.loaded / e.total); }, reject));
}

/** A licensed anatomical atlas, not a rendering or diagnosis of the patient. */
export default function BodyMap3D({ selected, onToggle, readOnly, initialView, compact }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected), toggleRef = useRef(onToggle);
  const rotateRef = useRef<((a: number) => void) | null>(null), drawRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState('Loading anatomical model…');
  const [hover, setHover] = useState<string | null>(null);
  selectedRef.current = selected; toggleRef.current = onToggle;
  useEffect(() => { drawRef.current?.(); }, [selected]);

  useEffect(() => {
    const el = host.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); }
    catch { setStatus('3D is unavailable on this device. Use the 2D map.'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.7;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(31, 1, 0.1, 80);
    camera.position.set(0, 0, 17.5);
    scene.add(new THREE.HemisphereLight(0xffe9d9, 0x403030, 2.5));
    const key = new THREE.DirectionalLight(0xffdfc5, 3); key.position.set(-4, 6, 8); scene.add(key);
    const rim = new THREE.DirectionalLight(0x8ebfbd, 1.5); rim.position.set(5, 3, -6); scene.add(rim);
    const figure = new THREE.Group(); scene.add(figure);
    figure.rotation.y = initialView === 'back' ? Math.PI : initialView === 'left' ? -Math.PI / 2 : initialView === 'right' ? Math.PI / 2 : 0;
    const muscle = new THREE.MeshStandardMaterial({ color: 0xad503a, roughness: 0.63, side: THREE.DoubleSide });
    const tendon = new THREE.MeshStandardMaterial({ color: 0xe4cbae, roughness: 0.72, side: THREE.DoubleSide });
    const bone = new THREE.MeshStandardMaterial({ color: 0xd8ccb5, roughness: 0.76, side: THREE.DoubleSide });
    const active = new THREE.MeshStandardMaterial({ color: 0xf5b084, emissive: 0x552015, roughness: 0.5, side: THREE.DoubleSide });
    const hovered = new THREE.MeshStandardMaterial({ color: 0xd8795b, roughness: 0.55, side: THREE.DoubleSide });
    const muscles: Part[] = [], bones: Part[] = [];
    let disposed = false, frame = 0, drag: { x: number; y: number; a: number; moved: boolean } | null = null, hoverId: string | null = null;
    const front = () => Math.cos(figure.rotation.y) >= 0;
    const idFor = (m: Part) => region(m.name, m.geometry.boundingSphere!.center, !front());
    const render = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      for (const m of muscles) { const id = idFor(m); m.material = selectedRef.current.includes(id) ? active : id === hoverId ? hovered : m.userData.tendon ? tendon : muscle; }
      renderer.render(scene, camera);
    }); };
    drawRef.current = render;
    rotateRef.current = (a) => { figure.rotation.y = a; render(); };
    const resize = () => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return; renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); render(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const loader = new GLTFLoader();
    Promise.all([
      load(loader, ROOT + 'anatomy.glb', (f) => setStatus(`Loading anatomical model… ${Math.round(f * 70)}%`)),
      load(loader, ROOT + 'skeleton.glb'),
    ]).then(([anatomy, skeleton]) => {
      if (disposed) return;
      const box = new THREE.Box3().setFromObject(anatomy), center = box.getCenter(new THREE.Vector3());
      const scale = 8.7 / box.getSize(new THREE.Vector3()).z;
      const add = (root: THREE.Group, material: THREE.MeshStandardMaterial, target: Part[]) => root.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const geometry = (node.geometry as THREE.BufferGeometry).clone(); orient(geometry, center, scale);
        const part = new THREE.Mesh(geometry, material) as Part;
        part.name = node.name || 'anatomical structure';
        part.userData.tendon = /tendon|ligament|retinaculum|membrane/i.test(part.name);
        figure.add(part); target.push(part);
      });
      add(anatomy, muscle, muscles); add(skeleton, bone, bones);
      setStatus(''); render();
    }).catch(() => { if (!disposed) setStatus('The anatomical model could not load. Use the 2D map.'); });
    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(), canvas = renderer.domElement;
    const hit = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(pointer, camera); const part = ray.intersectObjects(muscles)[0]?.object as Part | undefined; return part ? idFor(part) : null; };
    const down = (e: PointerEvent) => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, a: figure.rotation.y, moved: false }; };
    const move = (e: PointerEvent) => { if (drag) { const dx = e.clientX - drag.x; if (Math.abs(dx) > 5 || Math.abs(e.clientY - drag.y) > 5) drag.moved = true; if (drag.moved) { figure.rotation.y = drag.a + dx * 0.012; render(); } } else { const id = hit(e); if (id !== hoverId) { hoverId = id; setHover(id); render(); } } };
    const up = (e: PointerEvent) => { if (drag && !drag.moved && !readOnly) { const id = hit(e); if (id) toggleRef.current(id); } drag = null; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); camera.position.z = THREE.MathUtils.clamp(camera.position.z + e.deltaY * 0.01, 10, 25); render(); };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('wheel', wheel, { passive: false });
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('wheel', wheel); canvas.remove(); renderer.dispose(); for (const m of [...muscles, ...bones]) m.geometry.dispose(); for (const m of [muscle, tendon, bone, active, hovered]) m.dispose(); drawRef.current = null; rotateRef.current = null; };
  }, [initialView, readOnly]);

  return <div className="bodymap-3d-wrap">
    <div ref={host} className={`bodymap-3d ${compact ? 'compact' : ''}`} role="img" aria-label="Rotatable three-dimensional anatomical muscle model" />
    {status && <div className="bodymap-3d-status" role="status">{status}</div>}
    <div className="bodymap-3d-caption">Drag to rotate · Tap a region · Anatomical reference model</div>
    <div className="bodymap-3d-views" role="group" aria-label="Body view"><button type="button" onClick={() => rotateRef.current?.(0)}>Front</button><button type="button" onClick={() => rotateRef.current?.(Math.PI)}>Back</button><button type="button" onClick={() => rotateRef.current?.(-Math.PI / 2)}>Side</button></div>
    <div className="bodymap-3d-selected" aria-live="polite">{hover ? regionLabel(hover) : selected.length ? selected.map(regionLabel).join(' · ') : 'Select where you feel symptoms'}</div>
    <p className="bodymap-3d-credit">Anatomy: BodyParts3D / Z-Anatomy · CC BY-SA · Illustrative, not your scan</p>
  </div>;
}
