import { describe, expect, it } from 'vitest';
import { buildQuery, fetchAbstract, parseAbstractXml, parseSearch, parseSummary, PubMedError, searchPubMed } from './pubmed';

// Shapes copied from real E-utilities responses (PMIDs checked against PubMed on 30 Sep 2026).
const SEARCH = { esearchresult: { count: '2', retmax: '2', idlist: ['25629215', '28666405'] } };
const SUMMARY = {
  result: {
    uids: ['25629215', '28666405'],
    '25629215': { uid: '25629215', pubdate: '2015 Jan 28', source: 'Cochrane Database Syst Rev', fulljournalname: 'The Cochrane database of systematic reviews', title: 'Exercises for mechanical neck disorders.' },
    '28666405': { uid: '28666405', pubdate: '2017 Jul', source: 'J Orthop Sports Phys Ther', fulljournalname: 'The Journal of orthopaedic and sports physical therapy', title: 'Neck Pain: Revision 2017.' },
  },
};

const fakeFetch = (responses: unknown[]) => {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => responses.shift() } as Response;
  }) as unknown as typeof fetch;
  return { f, calls };
};

describe('PubMed evidence lookup — records exactly as PubMed returns them', () => {
  it('copies PMID, title, journal and year verbatim and links to PubMed', () => {
    const refs = parseSummary(SUMMARY, ['25629215', '28666405'], 'neck exercise', '2026-09-30T00:00:00Z');
    expect(refs[0]).toEqual({ pmid: '25629215', title: 'Exercises for mechanical neck disorders.', journal: 'The Cochrane database of systematic reviews', year: '2015', url: 'https://pubmed.ncbi.nlm.nih.gov/25629215/', query: 'neck exercise', retrievedAt: '2026-09-30T00:00:00Z' });
    expect(refs[1].year).toBe('2017');
  });

  it('drops records PubMed flags as errors or returns without a title — never fills them in', () => {
    const json = { result: { '1': { uid: '1', error: 'cannot get document summary' }, '2': { uid: '2', title: '' }, '3': { uid: '3', title: 'Real title.', pubdate: '', source: 'J' } } };
    const refs = parseSummary(json, ['1', '2', '3'], 'q', 't');
    expect(refs.map((r) => r.pmid)).toEqual(['3']);
    expect(refs[0].year).toBe(''); // unknown stays unknown
  });

  it('rejects malformed responses instead of guessing', () => {
    expect(() => parseSearch({})).toThrow(PubMedError);
    expect(() => parseSummary({}, ['1'], 'q', 't')).toThrow(PubMedError);
    expect(parseSearch({ esearchresult: { count: '1', idlist: ['12', 'not-a-pmid'] } }).ids).toEqual(['12']);
  });

  it('searches then summarises with the tool name and no patient data, and preserves order', async () => {
    const { f, calls } = fakeFetch([SEARCH, SUMMARY]);
    const r = await searchPubMed('neck pain exercise therapy', { fetchImpl: f, now: () => 'T' });
    expect(r.count).toBe(2);
    expect(r.refs.map((x) => x.pmid)).toEqual(['25629215', '28666405']);
    expect(calls[0]).toContain('esearch.fcgi');
    expect(calls[0]).toContain('term=neck%20pain%20exercise%20therapy');
    expect(calls[0]).toContain('tool=dheepika-lab');
    expect(calls[1]).toContain('id=25629215,28666405');
  });

  it('a network failure is an error with no citations', async () => {
    const f = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(searchPubMed('x', { fetchImpl: f })).rejects.toBeInstanceOf(PubMedError);
    const bad = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(searchPubMed('x', { fetchImpl: bad })).rejects.toThrow(/429/);
  });
});

describe('research: filters, abstracts and free full text', () => {
  it('appends PubMed filters to the terms', () => {
    expect(buildQuery(' knee osteoarthritis exercise ', ['systematic', 'free'])).toBe('(knee osteoarthritis exercise) AND systematic[sb] AND free full text[sb]');
    expect(buildQuery('  ', ['free'])).toBe('');
  });
  it('parses structured abstracts verbatim, without markup', () => {
    const xml = '<Abstract><AbstractText Label="BACKGROUND" NlmCategory="BACKGROUND">Knee pain &amp; <i>function</i>.</AbstractText><AbstractText Label="RESULTS">n = 120; p &lt; 0.05</AbstractText></Abstract>';
    expect(parseAbstractXml(xml)).toEqual([
      { label: 'BACKGROUND', text: 'Knee pain & function.' },
      { label: 'RESULTS', text: 'n = 120; p < 0.05' },
    ]);
    expect(parseAbstractXml('<PubmedArticle></PubmedArticle>')).toEqual([]);
  });
  it('returns an error rather than placeholder text when PubMed fails', async () => {
    const fail = (async () => new Response('x', { status: 503 })) as unknown as typeof fetch;
    await expect(fetchAbstract('123', fail)).rejects.toThrow('503');
    await expect(fetchAbstract('abc', fail)).rejects.toThrow('Invalid PMID');
  });
});
