/**
 * Maps points on the 3D anatomical model to the SAME region ids as the 2D map (regions.ts), so a
 * location chosen in 3D is stored, shown in 2D and read by the intake pathways identically.
 *
 * Coordinates are the model's source frame (BodyParts3D, millimetres): +x = patient's LEFT,
 * −y = ANTERIOR, +z = UP. Height bands come from the model's own skeleton (e.g. patella 362–401,
 * femoral head ≈ 834, C7 ≈ 1365–1392, wrist ≈ 806), not from population norms.
 *
 * Front/back is decided by the muscle compartment where anatomy defines it (biceps vs triceps,
 * quadriceps vs hamstrings), otherwise by the direction the surface faces at that point. A region is
 * fixed to the tissue, never to the camera angle, so it does not change when the model rotates.
 */

export type Side = 'left' | 'right';
type Kind = 'head' | 'neck_front' | 'neck_side' | 'neck_back' | 'arm' | 'leg' | 'trunk';
type Surface = 'front' | 'back' | 'lateral' | 'auto';

export interface MeshInfo {
  side: Side | null;
  kind: Kind;
  surface: Surface;
  /** Leg/arm part pinned by anatomy regardless of height (e.g. iliotibial tract → outer thigh). */
  pin?: 'buttock' | 'hip_lateral' | 'thigh_lateral' | 'achilles' | 'knee_back' | 'shoulder' | 'shoulder_back' | 'calf';
}

/** Landmark heights (mm) taken from the model's skeleton. */
export const Z = {
  headFront: 1420, // mandible top of range; face above
  neckBack: 1380, // C7 upper edge
  upperBack: 1180, // ≈ inferior angle of scapula (scapula 1184–1350)
  midBack: 1050, // T12 / L1 junction
  lowerBack: 880, // below L5 (905) → sacrum / buttock
  chest: 1130,
  abdomenUpper: 1000,
  abdomenLower: 870,
  groin: 740,
  knee: 450,
  kneeLow: 330,
  ankle: 60,
  foot: 0,
  shoulder: 1230,
  upperArm: 1070,
  elbow: 980,
  forearm: 830,
  wrist: 780,
} as const;

const HEAD = /frontalis|procerus|corrugator|orbicularis|(superior|inferior|lateral|medial)_rectus|^(left|right)_(superior|inferior)_oblique$|levator_palpebrae|nasalis|pterygoid|zygomaticus|levator_labii|masseter|temporalis|risorius|depressor_|mentalis|veli_palatini|buccinator|occipit|auricular/;
const NECK_SIDE = /sternocleidomastoid|scalenus|platysma/;
const NECK_FRONT = /hyoid|digastric|intermediate_tendon|longus_colli|longus_capitis|rectus_capitis_(anterior|lateralis)|arytenoid|cricothyroid|crico-arytenoid|thyro-arytenoid|anterior_cervical_intertransversarii|sternothyroid/;
const NECK_BACK = /rectus_capitis_posterior|semispinalis_c|splenius|longissimus_c|multifidus_cervicis|interspinales_cervicis|iliocostalis_cervicis|posterior_cervical_intertransversarii|levator_scapulae|oblique_capitis/;

const ARM = /deltoid|biceps_brachii|triceps|brachialis|coracobrachialis|anconeus|brachioradialis|pronator|supinator|carpi|pollicis|palmaris|_hand|forearm|wrist|flexor_digitorum_(superficialis|profundus)|^(left|right)_extensor_digitorum$|extensor_digiti_minimi$|extensor_indicis|humerus|radius|ulna|scaphoid|lunate|triquetrum|pisiform|trapezium|trapezoid|capitate|hamate|metacarpal|finger|thumb/;
const ARM_BACK = /triceps|anconeus|extensor|supinator|abductor_pollicis_longus|dorsal_interossei|spinal_part_of/;
const LEG = /gluteus|piriformis|gemellus|obturator|quadratus_femoris|tensor_fasciae|iliotibial|sartorius|rectus_femoris|vastus|adductor_(longus|brevis|magnus|minimus)|gracilis|pectineus|biceps_femoris|semimembranosus|semitendinosus|popliteus|gastrocnemius|plantaris|soleus|tibialis|fibularis|_leg$|digitorum_longus|hallucis|calcaneal|_foot|plantar|flexor_accessorius|digitorum_brevis|femur|patella|tibia|fibula|talus|calcaneus|navicular|cuboid|cuneiform|metatarsal|toe/;
const LEG_BACK = /gluteus_maximus|piriformis|gemellus|obturator_internus|quadratus_femoris|biceps_femoris|semimembranosus|semitendinosus|adductor_magnus|popliteus|gastrocnemius|plantaris|soleus|tibialis_posterior|flexor_digitorum_longus|flexor_hallucis_longus|calcaneal/;
const TRUNK_BACK = /trapezius|rhomboid|latissimus|iliocostalis|longissimus|spinalis|multifidus|rotatores|interspinal|serratus_posterior|levatores_costarum|thoracolumbar_fascia|quadratus_lumborum|intertransversari|thoracic_vertebra|lumbar_vertebra|sacrum|coccyx|coccygeus|anal_sphincter/;
const TRUNK_FRONT = /pectoralis|rectus_abdominis|subclavius|transversus_thoracis|psoas|iliacus|sternum|costal_cartilage/;
const LEG_LATERAL = /gluteus_(medius|minimus)|tensor_fasciae|iliotibial|fibularis/;

export function meshSide(name: string): Side | null {
  const n = name.toLowerCase();
  if (/(^|_)left(_|$)/.test(n)) return 'left';
  if (/(^|_)right(_|$)/.test(n)) return 'right';
  return null;
}

/** Classifies a model mesh by its anatomical name (BodyParts3D / FMA naming, underscores). */
export function classifyMesh(rawName: string): MeshInfo {
  const name = rawName.toLowerCase().replace(/\s+/g, '_').replace(/_\(\d+\)$/, '');
  const side = meshSide(name);
  if (HEAD.test(name) || /frontal_bone|parietal|temporal_bone|sphenoid|ethmoid|maxilla|mandible|zygomatic|nasal_bone|lacrimal|vomer|palatine|occipital_bone/.test(name)) return { side, kind: 'head', surface: 'auto' };
  if (NECK_SIDE.test(name)) return { side, kind: 'neck_side', surface: 'lateral' };
  if (NECK_FRONT.test(name)) return { side, kind: 'neck_front', surface: 'front' };
  if (NECK_BACK.test(name) || /cervical_vertebra|atlas|^axis$/.test(name)) return { side, kind: 'neck_back', surface: 'back' };
  if (ARM.test(name)) {
    if (/clavicular_part_of_.*deltoid|acromial_part_of_.*deltoid/.test(name)) return { side, kind: 'arm', surface: 'front', pin: 'shoulder' };
    if (/spinal_part_of_.*deltoid/.test(name)) return { side, kind: 'arm', surface: 'back', pin: 'shoulder_back' };
    // Bones: the direction the surface faces decides front/back.
    if (/humerus|radius|ulna|scaphoid|lunate|triquetrum|pisiform|trapezium|trapezoid|capitate|hamate|metacarpal|finger|thumb/.test(name)) return { side, kind: 'arm', surface: 'auto' };
    return { side, kind: 'arm', surface: ARM_BACK.test(name) ? 'back' : 'front' };
  }
  if (/supraspinatus|infraspinatus|teres_(major|minor)/.test(name)) return { side, kind: 'arm', surface: 'back', pin: 'shoulder_back' };
  if (/scapula$/.test(name)) return { side, kind: 'arm', surface: 'back', pin: 'shoulder_back' };
  if (/subscapularis/.test(name)) return { side, kind: 'arm', surface: 'front', pin: 'shoulder' };
  if (LEG.test(name)) {
    if (/gluteus_maximus|piriformis|gemellus|obturator_internus|quadratus_femoris/.test(name)) return { side, kind: 'leg', surface: 'back', pin: 'buttock' };
    if (/gluteus_(medius|minimus)|tensor_fasciae/.test(name)) return { side, kind: 'leg', surface: 'lateral', pin: 'hip_lateral' };
    if (/iliotibial/.test(name)) return { side, kind: 'leg', surface: 'lateral', pin: 'thigh_lateral' };
    if (/popliteus/.test(name)) return { side, kind: 'leg', surface: 'back', pin: 'knee_back' };
    if (/calcaneal_tendon/.test(name)) return { side, kind: 'leg', surface: 'back', pin: 'achilles' };
    if (/femur|tibia|fibula|patella|talus|calcaneus|navicular|cuboid|cuneiform|metatarsal|toe/.test(name)) return { side, kind: 'leg', surface: 'auto' };
    return { side, kind: 'leg', surface: LEG_BACK.test(name) ? 'back' : LEG_LATERAL.test(name) ? 'lateral' : 'front' };
  }
  return { side, kind: 'trunk', surface: TRUNK_BACK.test(name) ? 'back' : TRUNK_FRONT.test(name) ? 'front' : 'auto' };
}

/**
 * Trunk centre line (y, mm) and half-width (|x|, mm) per 50 mm of height, measured from the trunk
 * meshes of the shipped model. Front/back/side is decided by POSITION against this profile — surface
 * normals are not used, because thin sheets and inner faces in the model point either way.
 */
const TRUNK_PROFILE: [z: number, axisY: number, halfWidth: number][] = [
  [700, -65, 114], [750, -86, 107], [800, -88, 114], [850, -93, 135], [900, -101, 145], [950, -108, 128], [1000, -108, 130],
  [1050, -106, 144], [1100, -102, 157], [1150, -98, 172], [1200, -97, 194], [1250, -91, 190], [1300, -76, 163], [1350, -49, 148], [1400, -50, 60],
];
function trunkAt(z: number): { axisY: number; halfWidth: number } {
  const t = TRUNK_PROFILE;
  if (z <= t[0][0]) return { axisY: t[0][1], halfWidth: t[0][2] };
  for (let i = 1; i < t.length; i++) {
    if (z <= t[i][0]) {
      const f = (z - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
      return { axisY: t[i - 1][1] + f * (t[i][1] - t[i - 1][1]), halfWidth: t[i - 1][2] + f * (t[i][2] - t[i - 1][2]) };
    }
  }
  const last = t[t.length - 1];
  return { axisY: last[1], halfWidth: last[2] };
}
/** Limb bone axes (y, mm) from the skeleton: femur/tibia ≈ −82, humerus/forearm ≈ −85. */
const LIMB_AXIS_Y = { leg: -82, arm: -85 } as const;

/**
 * Region id for one point of a mesh, in the model's source frame (mm).
 * Unsided meshes that cross the midline (e.g. the diaphragm) take the side of the point itself.
 */
export function regionAt(info: MeshInfo, x: number, y: number, z: number): string {
  const s: Side = info.side ?? (x >= 0 ? 'left' : 'right');

  switch (info.kind) {
    case 'head':
      return z > 1450 && y > -75 ? 'head_back' : 'head';
    case 'neck_front':
      return 'neck_front';
    case 'neck_side':
      return `neck_side_${s}`;
    case 'neck_back':
      return 'neck_back';
    case 'arm': {
      if (info.pin === 'shoulder') return `shoulder_${s}`;
      if (info.pin === 'shoulder_back') return `shoulder_${s}_back`;
      const surf = info.surface === 'auto' ? (y < LIMB_AXIS_Y.arm ? 'front' : 'back') : info.surface;
      const back = surf === 'back' ? '_back' : '';
      if (z > Z.shoulder) return `shoulder_${s}${back}`;
      if (z > Z.upperArm) return `upper_arm_${s}${back}`;
      if (z > Z.elbow) return `elbow_${s}${back}`;
      if (z > Z.forearm) return `forearm_${s}${back}`;
      if (z > Z.wrist) return `wrist_${s}${back}`;
      return `hand_${s}${back}`;
    }
    case 'leg': {
      if (info.pin === 'buttock') return `buttock_${s}`;
      if (info.pin === 'hip_lateral') return `hip_${s}_lateral`;
      if (info.pin === 'achilles') return z > 120 ? `calf_${s}` : `achilles_${s}`;
      if (info.pin === 'knee_back') return `knee_${s}_back`;
      if (info.pin === 'thigh_lateral') return z > Z.knee ? `thigh_${s}_lateral` : `knee_${s}`;
      // Where the point sits decides front/back (a hamstring tendon wrapping to the inner front of
      // the knee is "knee", not "back of knee"); the compartment decides only near the centre line.
      const placed = y < LIMB_AXIS_Y.leg - 12 ? 'front' : y > LIMB_AXIS_Y.leg + 12 ? 'back' : null;
      const surf = info.surface === 'auto' ? (y < LIMB_AXIS_Y.leg ? 'front' : 'back') : info.surface === 'lateral' ? 'lateral' : (placed ?? info.surface);
      const back = surf === 'back';
      const lateral = surf === 'lateral';
      if (z > Z.groin) return back ? `buttock_${s}` : lateral ? `hip_${s}_lateral` : `groin_${s}`;
      if (z > Z.knee) return `thigh_${s}_${back ? 'back' : lateral ? 'lateral' : 'front'}`;
      if (z > Z.kneeLow) return back ? `knee_${s}_back` : `knee_${s}`;
      if (z > Z.ankle) return back ? `calf_${s}` : `shin_${s}`;
      if (z > Z.foot) return back ? `achilles_${s}` : `ankle_${s}`;
      // Below the ankle: the back of the heel (calcaneus extends to y ≈ −24) vs the rest of the foot.
      return y > -55 ? `heel_${s}` : `foot_${s}`;
    }
    case 'trunk': {
      const { axisY, halfWidth } = trunkAt(z);
      const rel = y - axisY; // < 0 = in front of the centre line
      const atSide = Math.abs(x) > 0.8 * halfWidth && Math.abs(rel) < 55;
      if (atSide && z > 950 && z < Z.chest && info.surface !== 'front') return `flank_${s}`;
      const front = info.surface === 'front' || (info.surface === 'auto' && rel < 0);
      if (front) {
        if (z > Z.chest) return `chest_${s}`;
        if (z > Z.abdomenUpper) return 'abdomen_upper';
        if (z > Z.abdomenLower) return 'abdomen_lower';
        return `groin_${s}`;
      }
      if (z > Z.neckBack) return 'neck_back';
      if (z > Z.upperBack) return `upper_back_${s}`;
      if (z > Z.midBack) return 'mid_back_center';
      if (z > Z.lowerBack) return 'lower_back_center';
      return `buttock_${s}`;
    }
  }
}
