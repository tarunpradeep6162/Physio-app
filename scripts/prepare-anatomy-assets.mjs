import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const parts = ['anatomy.01.bin', 'anatomy.02.bin'];
const expected = {
  anatomy: '1f6f7a77c3633305acb201649c5538dfad80b29deb2bfad9519fc4b93d318060',
  skeleton: '6288a245e68c9e193ccf9692b22542de78d3f45b3fb4a4ae0d0d78ec11081d36',
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const anatomy = Buffer.concat(await Promise.all(parts.map((part) => readFile(join(root, 'model-source', part)))));
if (digest(anatomy) !== expected.anatomy) throw new Error('Anatomy asset hash mismatch');
const target = join(root, 'public', 'anatomy');
await mkdir(target, { recursive: true });
const skeleton = await readFile(join(target, 'skeleton.glb'));
if (digest(skeleton) !== expected.skeleton) throw new Error('Skeleton asset hash mismatch');
await writeFile(join(target, 'anatomy.glb'), anatomy);
console.log(`Anatomy assets ready: ${anatomy.length} + ${skeleton.length} bytes`);
