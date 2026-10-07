import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const parts = ['anatomy.01.bin', 'anatomy.02.bin'];
const expected = {
  anatomy: '1f6f7a77c3633305acb201649c5538dfad80b29deb2bfad9519fc4b93d318060',
  skeleton: '6288a245e68c9e193ccf9692b22542de78d3f45b3fb4a4ae0d0d78ec11081d36',
  // Phone-weight copies (Phase 41), committed; regenerate with scripts/simplify-anatomy.mjs.
  'anatomy-lite': 'c386312a3a9a104d048ecebb2adb0fefa5e29414b25118e2da61134b48b26d73',
  'skeleton-lite': '6676706ab9b0918cf84e9b5d9923433727427c7f5cecb7d759af82769f65e6be',
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const anatomy = Buffer.concat(await Promise.all(parts.map((part) => readFile(join(root, 'model-source', part)))));
if (digest(anatomy) !== expected.anatomy) throw new Error('Anatomy asset hash mismatch');
const target = join(root, 'public', 'anatomy');
await mkdir(target, { recursive: true });
const skeleton = await readFile(join(target, 'skeleton.glb'));
if (digest(skeleton) !== expected.skeleton) throw new Error('Skeleton asset hash mismatch');
for (const lite of ['anatomy-lite', 'skeleton-lite']) {
  if (digest(await readFile(join(target, `${lite}.glb`))) !== expected[lite]) throw new Error(`${lite} asset hash mismatch`);
}
await writeFile(join(target, 'anatomy.glb'), anatomy);
console.log(`Anatomy assets ready: ${anatomy.length} + ${skeleton.length} bytes`);
