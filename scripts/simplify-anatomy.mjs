#!/usr/bin/env node
/**
 * Phase 41: make phone-weight copies of the anatomy models.
 *
 *   node scripts/simplify-anatomy.mjs            # writes public/anatomy/*-lite.glb
 *
 * Each mesh is simplified on its own with meshoptimizer, so mesh and node names, materials, scene
 * structure and the source frame (mm, +x patient left, −y anterior, +z up) are unchanged. The
 * app maps regions per vertex from position and mesh name, so the same mapping applies to both
 * models (anatomyRegions.test.ts runs on all four files).
 *
 * The error limit is absolute, in millimetres, so small structures keep their shape instead of
 * shrinking with their own size. The outputs are committed and their hashes are checked by
 * scripts/prepare-anatomy-assets.mjs; re-run this only when the source model changes, then update
 * those hashes. Whether phones handle the result well is decided by real-phone runs
 * (docs/ANATOMY_PHONE_QA.md), not by this script.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'anatomy');

/** Share of triangles to aim for, and the largest surface deviation allowed (mm). */
export const LITE = { ratio: 0.25, maxErrorMm: 1.5, minTriangles: 24 };

function unpack(raw) {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw new Error('not a glTF 2 binary');
  const jsonLen = dv.getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(raw.subarray(20, 20 + jsonLen)));
  const binLen = dv.getUint32(20 + jsonLen, true);
  const bin = raw.subarray(28 + jsonLen, 28 + jsonLen + binLen);
  return { doc, bin };
}

function pack(doc, bin) {
  let json = Buffer.from(JSON.stringify(doc), 'utf8');
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(json.length, 0);
  jh.write('JSON', 4, 'ascii');
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.write('BIN\0', 4, 'binary');
  return Buffer.concat([head, jh, json, bh, bin]);
}

/** Copy of an accessor's elements as tightly packed bytes. */
function readElements(doc, bin, index, elementBytes) {
  const a = doc.accessors[index];
  const v = doc.bufferViews[a.bufferView];
  const stride = v.byteStride ?? elementBytes;
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Uint8Array(a.count * elementBytes);
  for (let i = 0; i < a.count; i++) out.set(bin.subarray(start + i * stride, start + i * stride + elementBytes), i * elementBytes);
  return out;
}

function simplifyFile(name, outName) {
  const { doc, bin } = unpack(readFileSync(join(dir, name)));
  const chunks = [];
  let offset = 0;
  const views = [];
  const addView = (bytes, extra) => {
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...extra });
    chunks.push(bytes);
    const pad = (4 - (bytes.length % 4)) % 4;
    if (pad) chunks.push(new Uint8Array(pad));
    offset += bytes.length + pad;
    return views.length - 1;
  };
  let trisIn = 0;
  let trisOut = 0;
  let worstMm = 0;
  const rewritten = new Set();

  for (const mesh of doc.meshes) {
    for (const prim of mesh.primitives) {
      const keys = Object.keys(prim.attributes);
      if (keys.some((k) => k !== 'POSITION' && k !== 'NORMAL')) throw new Error(`${mesh.name}: unexpected attribute`);
      const ia = doc.accessors[prim.indices];
      if (ia.componentType !== 5123 && ia.componentType !== 5125) throw new Error(`${mesh.name}: unexpected index type`);
      const pa = doc.accessors[prim.attributes.POSITION];
      if (pa.componentType !== 5126) throw new Error(`${mesh.name}: positions must be float`);
      const na = doc.accessors[prim.attributes.NORMAL];
      if (na.componentType !== 5120 || !na.normalized) throw new Error(`${mesh.name}: normals must be normalized bytes`);

      const ib = readElements(doc, bin, prim.indices, ia.componentType === 5123 ? 2 : 4);
      const indices = ia.componentType === 5123 ? new Uint32Array(new Uint16Array(ib.buffer)) : new Uint32Array(ib.buffer);
      const positions = new Float32Array(readElements(doc, bin, prim.attributes.POSITION, 12).buffer);
      const normals = readElements(doc, bin, prim.attributes.NORMAL, 3);

      // Weld by position so seams in the normals do not stop the simplifier.
      const weld = MeshoptSimplifier.generatePositionRemap(positions, 3);
      const welded = indices.map((i) => weld[i]);
      const target = Math.max(LITE.minTriangles * 3, Math.floor((welded.length * LITE.ratio) / 3) * 3);
      let out = welded;
      if (welded.length > target) {
        // With ErrorAbsolute both the limit and the returned error are in model units (mm).
        const [simplified, err] = MeshoptSimplifier.simplify(welded, positions, 3, target, LITE.maxErrorMm, ['ErrorAbsolute', 'LockBorder']);
        if (simplified.length >= 3) {
          out = simplified;
          worstMm = Math.max(worstMm, err);
        }
      }
      trisIn += indices.length / 3;
      trisOut += out.length / 3;

      // Keep only the vertices still referenced, in first-use order.
      const idx = Uint32Array.from(out);
      const [remap, count] = MeshoptSimplifier.compactMesh(idx);
      const pos = new Float32Array(count * 3);
      const nrm = new Uint8Array(count * 4);
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < remap.length; v++) {
        const n = remap[v];
        if (n === 0xffffffff) continue;
        for (let c = 0; c < 3; c++) {
          const x = positions[v * 3 + c];
          pos[n * 3 + c] = x;
          if (x < min[c]) min[c] = x;
          if (x > max[c]) max[c] = x;
          nrm[n * 4 + c] = normals[v * 3 + c];
        }
      }
      const small = count <= 65535;
      const idxBytes = small ? new Uint8Array(Uint16Array.from(idx).buffer) : new Uint8Array(idx.buffer);
      const iv = addView(idxBytes, { target: 34963 });
      const pv = addView(new Uint8Array(pos.buffer), { byteStride: 12, target: 34962 });
      const nv = addView(nrm, { byteStride: 4, target: 34962 });
      rewritten.add(prim.indices).add(prim.attributes.POSITION).add(prim.attributes.NORMAL);
      doc.accessors[prim.indices] = { bufferView: iv, componentType: small ? 5123 : 5125, count: idx.length, type: 'SCALAR', max: [count - 1], min: [0] };
      doc.accessors[prim.attributes.POSITION] = { bufferView: pv, componentType: 5126, count, type: 'VEC3', max, min };
      doc.accessors[prim.attributes.NORMAL] = { bufferView: nv, componentType: 5120, count, type: 'VEC3', normalized: true };
    }
  }
  // Every accessor is rewritten above, one view each, so the old views can be replaced wholesale.
  if (rewritten.size !== doc.accessors.length) throw new Error('some accessors were not rewritten');
  doc.bufferViews = views;
  const total = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) {
    total.set(c, at);
    at += c.length;
  }
  doc.buffers = [{ byteLength: offset }];
  doc.asset = { ...doc.asset, generator: `${doc.asset.generator ?? ''}; simplified for phones (meshoptimizer, ratio ${LITE.ratio}, max ${LITE.maxErrorMm} mm)`.replace(/^; /, '') };
  const file = pack(doc, total);
  writeFileSync(join(dir, outName), file);
  console.log(`${name} → ${outName}: ${trisIn.toLocaleString()} → ${trisOut.toLocaleString()} triangles; ${file.length.toLocaleString()} bytes; worst error ${worstMm.toFixed(2)} mm`);
}

await MeshoptSimplifier.ready;
simplifyFile('anatomy.glb', 'anatomy-lite.glb');
simplifyFile('skeleton.glb', 'skeleton-lite.glb');
