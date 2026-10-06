import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { classifyMesh, regionAt } from './anatomyRegions';
import { VIEWS } from './regions';

const CATALOGUE = new Set(Object.values(VIEWS).flatMap((v) => v.map((r) => r.id)));

// Node built-in, loaded dynamically: the app's tsconfig carries browser types only.
const fs = (await import('node:' + 'fs')) as { readFileSync: (path: string) => Uint8Array };

function loadModel(file: string): Promise<THREE.Mesh[]> {
  const buf = fs.readFileSync(`public/anatomy/${file}`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new Promise((resolve, reject) =>
    new GLTFLoader().parse(ab, '', (g) => {
      const meshes: THREE.Mesh[] = [];
      g.scene.traverse((n) => n instanceof THREE.Mesh && meshes.push(n));
      resolve(meshes);
    }, reject),
  );
}

/** Region of each vertex of a mesh, counted. */
function regionsOf(m: THREE.Mesh): Map<string, number> {
  const info = classifyMesh(m.name);
  const p = m.geometry.getAttribute('position');
  const out = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const id = regionAt(info, p.getX(i), p.getY(i), p.getZ(i));
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}
const dominant = (r: Map<string, number>) => [...r.entries()].sort((a, b) => b[1] - a[1])[0][0];

describe('3D anatomy → 2D region ids (whole shipped model)', async () => {
  const muscles = await loadModel('anatomy.glb');
  const bones = await loadModel('skeleton.glb');
  const all = [...muscles, ...bones];
  const byName = (n: string) => {
    const m = all.find((x) => x.name === n);
    if (!m) throw new Error(`mesh not in model: ${n}`);
    return m;
  };

  it('every vertex of every mesh maps to a region that exists in the 2D map', () => {
    const unknown = new Set<string>();
    for (const m of all) for (const id of regionsOf(m).keys()) if (!CATALOGUE.has(id)) unknown.add(`${m.name} → ${id}`);
    expect([...unknown]).toEqual([]);
  });

  it('known anatomy lands in the expected region and side', () => {
    const expectRegion = (mesh: string, id: string) => expect(dominant(regionsOf(byName(mesh))), mesh).toBe(id);
    expectRegion('left_vastus_lateralis', 'thigh_left_front');
    expectRegion('right_rectus_femoris', 'thigh_right_front');
    expectRegion('long_head_of_left_biceps_femoris', 'thigh_left_back');
    expectRegion('medial_head_of_right_gastrocnemius', 'calf_right');
    expectRegion('left_calcaneal_tendon', 'achilles_left');
    expectRegion('left_popliteus', 'knee_left_back');
    expectRegion('left_patella', 'knee_left');
    expectRegion('right_gluteus_maximus', 'buttock_right');
    expectRegion('left_gluteus_medius', 'hip_left_lateral');
    expectRegion('left_iliotibial_tract', 'thigh_left_lateral');
    expectRegion('sternocostal_part_of_right_pectoralis_major', 'chest_right');
    expectRegion('left_rectus_abdominis', 'abdomen_upper');
    expectRegion('ascending_part_of_left_trapezius', 'upper_back_left');
    expectRegion('left_rhomboid_major', 'upper_back_left');
    expectRegion('left_iliocostalis_lumborum', 'lower_back_center');
    expectRegion('left_infraspinatus_muscle', 'shoulder_left_back');
    expectRegion('acromial_part_of_right_deltoid', 'shoulder_right');
    expectRegion('long_head_of_left_biceps_brachii', 'upper_arm_left');
    expectRegion('lateral_head_of_left_triceps_brachii', 'upper_arm_left_back');
    expectRegion('left_flexor_carpi_radialis', 'forearm_left');
    expectRegion('left_extensor_carpi_radialis_brevis', 'forearm_left_back');
    expectRegion('left_sternocleidomastoid', 'neck_side_left');
    expectRegion('left_splenius_capitis', 'neck_back');
    expectRegion('left_superficial_part_of_masseter', 'head');
    expectRegion('frontal_bone', 'head');
    expectRegion('left_clavicle', 'chest_left');
    expectRegion('left_scapula', 'shoulder_left_back');
    expectRegion('left_abductor_hallucis', 'foot_left');
  });

  it('a muscle spanning several regions is split by height, not given one region', () => {
    // Tibialis anterior: belly on the shin, tendon over the ankle onto the top of the foot.
    const ta = regionsOf(byName('left_tibialis_anterior'));
    expect([...ta.keys()].sort()).toEqual(expect.arrayContaining(['shin_left', 'ankle_left', 'foot_left']));
    const lat = regionsOf(byName('left_latissimus_dorsi'));
    expect(lat.has('mid_back_center') || lat.has('upper_back_left')).toBe(true);
    expect(lat.has('lower_back_center')).toBe(true);
    // The patient's left side stays left in every part of the muscle.
    for (const id of lat.keys()) expect(id).not.toMatch(/right/);
  });

  it('unsided midline muscles take the side of the point', () => {
    // The diaphragm crosses the midline (the model's intercostals are left-sided only).
    const d = regionsOf(byName('diaphragm'));
    expect([...d.keys()].some((k) => k.endsWith('_left'))).toBe(true);
    expect([...d.keys()].some((k) => k.endsWith('_right'))).toBe(true);
  });
});
