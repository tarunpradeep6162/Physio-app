// Copies the MediaPipe WASM runtime out of node_modules and downloads the pose model so that
// pose inference is served from our own origin (no third-party CDN call at runtime, works offline
// once cached by the service worker). Safe to re-run; failures are non-fatal because the app
// falls back to the official CDN URLs at runtime.
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/pose/wasm');
const modelDir = join(root, 'public/pose/models');
const MODELS = {
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
};

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

try {
  if (await exists(wasmSrc)) {
    await mkdir(wasmDst, { recursive: true });
    // Only the classic-script SIMD and non-SIMD builds are loaded by FilesetResolver (useModule=false).
    for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
      await cp(join(wasmSrc, f), join(wasmDst, f));
    }
    console.log('[pose-assets] WASM runtime copied to public/pose/wasm');
  }
  await mkdir(modelDir, { recursive: true });
  for (const [file, url] of Object.entries(MODELS)) {
    const dst = join(modelDir, file);
    if (await exists(dst)) continue;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    await writeFile(dst, Buffer.from(await res.arrayBuffer()));
    console.log(`[pose-assets] downloaded ${file}`);
  }
} catch (err) {
  console.warn('[pose-assets] could not prepare local pose assets; runtime will use CDN fallback.', err.message);
}
