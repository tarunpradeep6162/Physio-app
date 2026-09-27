/** RGBA → planar I420 (BT.601 limited range), for writing a Y4M test clip for fake-camera benchmarks. */
export function rgbaToI420(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 1.5);
  const U = w * h;
  const V = U + (w / 2) * (h / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[y * w + x] = 16 + ((66 * rgba[i] + 129 * rgba[i + 1] + 25 * rgba[i + 2]) >> 8);
    }
  }
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((y + dy) * w + x + dx) * 4;
        r += rgba[i];
        g += rgba[i + 1];
        b += rgba[i + 2];
      }
      r /= 4;
      g /= 4;
      b /= 4;
      const j = (y / 2) * (w / 2) + x / 2;
      out[U + j] = 128 + ((-38 * r - 74 * g + 112 * b) >> 8);
      out[V + j] = 128 + ((112 * r - 94 * g - 18 * b) >> 8);
    }
  }
  return out;
}
