import type { EvidenceRef } from '../data/models';

/**
 * PubMed evidence lookup through NCBI E-utilities (esearch → esummary). Records are shown exactly
 * as PubMed returns them: PMID, title, journal and year are copied verbatim, never generated,
 * summarised or completed by a model. A failed request returns an error — never placeholder
 * citations. Relevance and quality are NOT assessed here; that is the clinician's appraisal.
 *
 * Only the search terms leave the device (no patient identifiers). NCBI allows 3 requests/second
 * without an API key; one search makes two requests.
 */

export const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const TOOL = 'dheepika-lab';

export interface PubMedRef {
  pmid: string;
  title: string;
  journal: string;
  year: string;
  url: string;
  /** DOI as listed in PubMed's article identifiers, when present (never constructed). */
  doi?: string;
  /** PubMed Central id when PubMed lists one (free full text). */
  pmcid?: string;
  /** Publication types exactly as PubMed lists them. */
  pubTypes?: string[];
  /** The search that returned it and when — for provenance. */
  query: string;
  retrievedAt: string;
}

export function attachRef(r: PubMedRef, attachedBy: string, attachedAt: string): EvidenceRef {
  return { source: 'pubmed', ...r, attachedBy, attachedAt };
}

export class PubMedError extends Error {}

export function parseSearch(json: unknown): { count: number; ids: string[] } {
  const r = (json as { esearchresult?: { count?: string; idlist?: unknown[] } })?.esearchresult;
  if (!r || !Array.isArray(r.idlist)) throw new PubMedError('Unexpected search response from PubMed');
  return { count: Number(r.count ?? 0) || 0, ids: r.idlist.filter((x): x is string => typeof x === 'string' && /^\d+$/.test(x)) };
}

/** Maps esummary records in the order of `ids`; records with an error or no title are dropped, not filled in. */
export function parseSummary(json: unknown, ids: string[], query: string, retrievedAt: string): PubMedRef[] {
  const res = (json as { result?: Record<string, unknown> })?.result;
  if (!res) throw new PubMedError('Unexpected summary response from PubMed');
  const out: PubMedRef[] = [];
  for (const id of ids) {
    const r = res[id] as { uid?: string; title?: unknown; fulljournalname?: unknown; source?: unknown; pubdate?: unknown; error?: unknown; articleids?: unknown; pubtype?: unknown } | undefined;
    if (!r || r.error || typeof r.title !== 'string' || !r.title.trim()) continue;
    const pmid = String(r.uid ?? id);
    const journal = typeof r.fulljournalname === 'string' && r.fulljournalname ? r.fulljournalname : typeof r.source === 'string' ? r.source : '';
    const year = typeof r.pubdate === 'string' ? (r.pubdate.match(/\d{4}/)?.[0] ?? '') : '';
    const doiRow = Array.isArray(r.articleids) ? (r.articleids as { idtype?: unknown; value?: unknown }[]).find((a) => a?.idtype === 'doi' && typeof a.value === 'string' && /^10\.\d{4,9}\/\S+$/.test(a.value)) : undefined;
    const pmcRow = Array.isArray(r.articleids) ? (r.articleids as { idtype?: unknown; value?: unknown }[]).find((a) => a?.idtype === 'pmc' && typeof a.value === 'string' && /^PMC\d+$/.test(a.value)) : undefined;
    const pubTypes = Array.isArray(r.pubtype) ? (r.pubtype as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    out.push({ pmid, title: r.title, journal, year, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, ...(doiRow ? { doi: doiRow.value as string } : {}), ...(pmcRow ? { pmcid: pmcRow.value as string } : {}), ...(pubTypes.length ? { pubTypes } : {}), query, retrievedAt });
  }
  return out;
}

export async function searchPubMed(query: string, opts: { retmax?: number; fetchImpl?: typeof fetch; now?: () => string } = {}): Promise<{ count: number; refs: PubMedRef[] }> {
  const term = query.trim();
  if (!term) return { count: 0, refs: [] };
  const f = opts.fetchImpl ?? fetch;
  const get = async (url: string) => {
    let res: Response;
    try {
      res = await f(url);
    } catch {
      throw new PubMedError('PubMed could not be reached. Check the connection and try again.');
    }
    if (!res.ok) throw new PubMedError(`PubMed returned an error (${res.status}). Try again shortly.`);
    return res.json();
  };
  const common = `db=pubmed&retmode=json&tool=${TOOL}`;
  const s = parseSearch(await get(`${EUTILS}/esearch.fcgi?${common}&sort=relevance&retmax=${opts.retmax ?? 8}&term=${encodeURIComponent(term)}`));
  if (!s.ids.length) return { count: s.count, refs: [] };
  const summary = await get(`${EUTILS}/esummary.fcgi?${common}&id=${s.ids.join(',')}`);
  return { count: s.count, refs: parseSummary(summary, s.ids, term, (opts.now ?? (() => new Date().toISOString()))()) };
}

/** PubMed's own filters, appended to the clinician's terms. Names describe the filter, not quality. */
export const RESEARCH_FILTERS = {
  systematic: { label: 'Systematic reviews', term: 'systematic[sb]' },
  guideline: { label: 'Guidelines', term: '(guideline[pt] OR practice guideline[pt])' },
  rct: { label: 'Randomised controlled trials', term: 'randomized controlled trial[pt]' },
  free: { label: 'Free full text', term: 'free full text[sb]' },
  recent: { label: 'Last 5 years', term: '"last 5 years"[dp]' },
} as const;
export type ResearchFilter = keyof typeof RESEARCH_FILTERS;

export function buildQuery(terms: string, filters: ResearchFilter[]): string {
  const t = terms.trim();
  if (!t) return '';
  return [`(${t})`, ...filters.map((f) => RESEARCH_FILTERS[f].term)].join(' AND ');
}

export interface AbstractSection {
  label?: string;
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim();

/** Abstract sections from an efetch XML record, verbatim (markup removed). Empty when PubMed has no abstract. */
export function parseAbstractXml(xml: string): AbstractSection[] {
  const out: AbstractSection[] = [];
  const re = /<AbstractText(\s[^>]*)?>([\s\S]*?)<\/AbstractText>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const label = m[1]?.match(/Label="([^"]*)"/)?.[1];
    const text = decode(m[2]);
    if (text) out.push({ ...(label ? { label: decode(label) } : {}), text });
  }
  return out;
}

export async function fetchAbstract(pmid: string, fetchImpl: typeof fetch = fetch): Promise<AbstractSection[]> {
  if (!/^\d+$/.test(pmid)) throw new PubMedError('Invalid PMID');
  let res: Response;
  try {
    res = await fetchImpl(`${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&rettype=abstract&tool=${TOOL}&id=${pmid}`);
  } catch {
    throw new PubMedError('PubMed could not be reached. Check the connection and try again.');
  }
  if (!res.ok) throw new PubMedError(`PubMed returned an error (${res.status}). Try again shortly.`);
  return parseAbstractXml(await res.text());
}
