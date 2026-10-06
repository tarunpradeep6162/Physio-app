import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** QR code drawn as SVG squares (no HTML injection). Encode only public, non-identifying text. */
export function QrCode({ text, size = 160, label }: { text: string; size?: number; label: string }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const dark: [number, number][] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark.push([r, c]);
    return { n, dark };
  }, [text]);
  const q = 4; // quiet zone in modules
  const span = cells.n + q * 2;
  return (
    <svg viewBox={`0 0 ${span} ${span}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges" style={{ background: '#fff', borderRadius: 8 }}>
      <rect width={span} height={span} fill="#fff" />
      {cells.dark.map(([r, c]) => (
        <rect key={`${r}-${c}`} x={c + q} y={r + q} width={1} height={1} fill="#0f172a" />
      ))}
    </svg>
  );
}
