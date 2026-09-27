import { jsPDF } from 'jspdf';
import { REPORT_TEMPLATE_VERSION, type Block, type ReportModel } from '../../clinical/report';
import { SKELETON_SEGMENTS } from '../../engine/landmarks';
import { regionLabel } from '../bodymap/regions';

/**
 * Renders the report model to a real, downloadable PDF (A4). Built with vector primitives only,
 * so skeleton frames and charts are drawn from stored landmarks/signals — no screenshots.
 */

const PAGE_W = 210;
const PAGE_H = 297;
const M = 15;
const CW = PAGE_W - 2 * M;
const TEAL: [number, number, number] = [8, 127, 121];
const INK: [number, number, number] = [20, 43, 45];
const MUTED: [number, number, number] = [82, 104, 106];

/** Standard PDF fonts are WinAnsi-encoded; map characters outside it to safe equivalents. */
export function pdfText(s: string): string {
  return s
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/−/g, '-')
    .replace(/[✓✔]/g, 'v')
    .replace(/[✗✕]/g, 'x')
    .replace(/∠/g, 'angle ')
    .replace(/[▲●■◎△⋯⊾✎⚠]/g, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—‘’“”•…€]/g, '');
}

export function renderPdf(model: ReportModel): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `Dheepika Lab knee report ${model.assessmentId.slice(0, 8)}`, subject: model.state === 'clinician_reviewed' ? 'Clinician-reviewed report' : 'AI preliminary — requires clinician review', creator: 'Dheepika Lab' });
  let y = 0;
  const prelim = model.state !== 'clinician_reviewed';

  const header = () => {
    doc.setFillColor(11, 36, 39);
    doc.rect(0, 0, PAGE_W, 12, 'F');
    doc.setTextColor(236, 253, 250);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    // The small movement monogram is drawn as PDF vectors, so it survives monochrome print.
    doc.setDrawColor(236, 253, 250);
    doc.setLineWidth(0.55);
    doc.line(M + 0.5, 2.5, M + 0.5, 9);
    doc.line(M + 0.5, 2.5, M + 2.6, 2.5);
    doc.ellipse(M + 2.6, 5.75, 2.7, 3.25, 'S');
    doc.setDrawColor(128, 217, 199);
    doc.line(M + 1.6, 8, M + 3.2, 6);
    doc.line(M + 3.2, 6, M + 4.2, 3.8);
    for (const [x, yy] of [[1.6, 8], [3.2, 6], [4.2, 3.8]]) {
      doc.setFillColor(128, 217, 199);
      doc.circle(M + x, yy, 0.42, 'F');
    }
    doc.text('Dheepika Lab', M + 10, 7.8);
    doc.setFont('helvetica', 'normal');
    doc.text(pdfText(`${model.audience === 'patient' ? 'Patient summary' : 'Clinician report'} · ${model.patientLabel}`), PAGE_W - M, 7.8, { align: 'right' });
    y = 18;
    if (prelim) {
      doc.setFillColor(255, 248, 234);
      doc.setDrawColor(245, 158, 11);
      doc.rect(M, y - 4, CW, 8, 'FD');
      doc.setTextColor(138, 90, 0);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(model.staleApproval ? 'AI PRELIMINARY — DATA CHANGED SINCE APPROVAL — REQUIRES CLINICIAN RE-REVIEW' : 'AI PRELIMINARY — REQUIRES CLINICIAN REVIEW', PAGE_W / 2, y + 1.3, { align: 'center' });
      y += 9;
    }
    doc.setTextColor(...INK);
  };
  const newPage = () => {
    doc.addPage();
    header();
  };
  const need = (h: number) => {
    if (y + h > PAGE_H - 16) newPage();
  };
  const text = (s: string, size = 9.5, style: 'normal' | 'bold' | 'italic' = 'normal', color: [number, number, number] = INK, indent = 0) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(pdfText(s), CW - indent) as string[];
    for (const l of lines) {
      need(size * 0.45);
      doc.text(l, M + indent, y);
      y += size * 0.42;
    }
    y += 1.2;
  };

  const table = (head: string[], rows: string[][]) => {
    const n = head.length;
    const w = CW / n;
    const size = n > 4 ? 7 : 8;
    const drawRow = (cells: string[], bold: boolean) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      const wrapped = cells.map((c) => doc.splitTextToSize(pdfText(c ?? ''), w - 2) as string[]);
      const h = Math.max(...wrapped.map((l) => l.length)) * size * 0.4 + 2;
      need(h);
      if (bold) {
        doc.setFillColor(234, 240, 238);
        doc.rect(M, y - 3, CW, h, 'F');
      }
      wrapped.forEach((lines, i) => {
        doc.setTextColor(...(bold ? MUTED : INK));
        lines.forEach((l, j) => doc.text(l, M + i * w + 1, y + j * size * 0.4));
      });
      doc.setDrawColor(216, 226, 223);
      doc.line(M, y - 3 + h, M + CW, y - 3 + h);
      y += h;
    };
    drawRow(head, true);
    rows.forEach((r) => drawRow(r, false));
    y += 2;
  };

  const skeletons = (b: Extract<Block, { kind: 'skeletons' }>) => {
    const n = b.frames.length;
    const boxW = (CW - (n - 1) * 3) / n;
    const aspect = b.height / b.width;
    const boxH = Math.min(55, boxW * aspect);
    need(boxH + 12);
    b.frames.forEach((f, i) => {
      const x0 = M + i * (boxW + 3);
      doc.setFillColor(13, 26, 29);
      doc.rect(x0, y, boxW, boxH, 'F');
      const scale = Math.min(boxW / b.width, boxH / b.height);
      const ox = x0 + (boxW - b.width * scale) / 2;
      const oy = y + (boxH - b.height * scale) / 2;
      const P = (k: number) => [ox + f.landmarks[k].x * b.width * scale, oy + f.landmarks[k].y * b.height * scale] as const;
      doc.setDrawColor(34, 211, 197);
      doc.setLineWidth(0.5);
      for (const [a, c] of SKELETON_SEGMENTS) {
        if (f.landmarks[a].visibility < 0.5 || f.landmarks[c].visibility < 0.5) continue;
        const [x1, y1] = P(a);
        const [x2, y2] = P(c);
        doc.line(x1, y1, x2, y2);
      }
      doc.setTextColor(236, 253, 250);
      doc.setFontSize(7);
      doc.text(f.label, x0 + 2, y + 4);
    });
    doc.setLineWidth(0.2);
    y += boxH + 4;
    text(b.caption, 7.5, 'italic', MUTED);
  };

  const chart = (b: Extract<Block, { kind: 'chart' }>) => {
    const h = 42;
    need(h + 14);
    text(b.title, 8.5, 'bold');
    const pts = b.series.flatMap((s) => s.points.filter((p) => p.y !== null));
    if (!pts.length) {
      text('No valid data points.', 8, 'italic', MUTED);
      return;
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y as number);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const lo = Math.floor(Math.min(0, ...ys) / 10) * 10;
    const rawStep = (Math.max(...ys) - lo) / 4 || 1;
    const step = [1, 2, 2.5, 5, 10, 20, 25, 50, 100].find((s) => s >= rawStep) ?? rawStep;
    const hi = lo + 4 * step;
    const L = M + 10;
    const Wd = CW - 12;
    const sx = (x: number) => L + (x1 === x0 ? Wd / 2 : ((x - x0) / (x1 - x0)) * Wd);
    const sy = (v: number) => y + h - ((v - lo) / (hi - lo || 1)) * h;
    doc.setDrawColor(216, 226, 223);
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4;
      doc.line(L, sy(v), L + Wd, sy(v));
      doc.text(`${Number.isInteger(v) ? v : v.toFixed(1)}${b.unit}`, L - 1, sy(v) + 1, { align: 'right' });
    }
    const fmtX = (x: number) => (b.xFormat === 'date' ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : `${x.toFixed(0)} s`);
    doc.text(fmtX(x0), L, y + h + 4);
    doc.text(fmtX(x1), L + Wd, y + h + 4, { align: 'right' });
    b.series.forEach((s, si) => {
      doc.setDrawColor(...(si === 0 ? TEAL : ([124, 92, 214] as [number, number, number])));
      doc.setLineWidth(0.6);
      if (s.dashed) doc.setLineDashPattern([1.5, 1], 0);
      let prev: { x: number; y: number } | null = null;
      for (const p of s.points) {
        if (p.y === null) {
          prev = null;
          continue;
        }
        const cur = { x: sx(p.x), y: sy(p.y) };
        if (prev) doc.line(prev.x, prev.y, cur.x, cur.y);
        if (b.xFormat === 'date') doc.circle(cur.x, cur.y, 0.8, 'S');
        prev = cur;
      }
      doc.setLineDashPattern([], 0);
    });
    doc.setLineWidth(0.2);
    y += h + 7;
    if (b.series.length > 1) text(`Series: ${b.series.map((s, i) => `${s.label} (${i === 0 ? 'solid' : 'dashed'})`).join(', ')}`, 7, 'normal', MUTED);
  };

  // ---- Document -------------------------------------------------------------------------------
  header();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...INK);
  doc.text(model.audience === 'patient' ? 'Knee assessment — your summary' : 'Knee assessment report', M, y + 4);
  y += 11;

  for (const s of model.sections) {
    need(14);
    doc.setDrawColor(...TEAL);
    doc.setLineWidth(0.6);
    doc.line(M, y - 3, M + 8, y - 3);
    doc.setLineWidth(0.2);
    text(`${s.n}. ${s.title}${s.label ? `  ·  ${s.label}` : ''}`, 12, 'bold');
    for (const b of s.blocks) {
      if (b.kind === 'para') text(b.text, 9, b.tone === 'strong' ? 'bold' : b.tone === 'muted' ? 'italic' : 'normal', b.tone === 'warn' ? [138, 90, 0] : b.tone === 'muted' ? MUTED : INK);
      else if (b.kind === 'missing') text(`Not available: ${b.text}`, 9, 'italic', MUTED);
      else if (b.kind === 'kv') table(['Item', 'Value'], b.rows.map(([k, v]) => [k, v]));
      else if (b.kind === 'table') table(b.head, b.rows);
      else if (b.kind === 'regions') text(`Assessed regions: ${b.ids.length ? b.ids.map(regionLabel).join(', ') : 'none recorded'}`, 9);
      else if (b.kind === 'skeletons') skeletons(b);
      else if (b.kind === 'chart') chart(b);
    }
    y += 3;
  }

  // Sign-off — never implies a signature that does not exist.
  need(30);
  text('Sign-off', 12, 'bold');
  if (model.state === 'clinician_reviewed') {
    text(`Reviewed and approved in Dheepika Lab by ${model.approvedBy ?? '—'} on ${model.approvedAt ? new Date(model.approvedAt).toLocaleString('en-GB') : '—'} (document v${model.documentVersion}).`, 9);
    text('Electronic approval recorded in the application audit log. This document carries no cryptographic signature and no online verification link.', 8, 'italic', MUTED);
  } else {
    text('Not signed off. This document is an AI-assisted preliminary draft and must not be used as a clinical conclusion until a clinician has reviewed and approved it.', 9, 'bold', [138, 90, 0]);
  }

  // Footer on every page.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(pdfText(`Page ${i} of ${pages}`), PAGE_W - M, PAGE_H - 7, { align: 'right' });
    doc.text(pdfText(`Generated ${new Date(model.generatedAt).toLocaleString('en-GB')} · document v${model.documentVersion} · ${REPORT_TEMPLATE_VERSION} · ${prelim ? 'AI preliminary' : 'clinician-reviewed'}`), M, PAGE_H - 7);
  }
  return doc;
}
