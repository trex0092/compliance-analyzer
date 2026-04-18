/**
 * Regulatory Horizon Scanner (cron).
 *
 * Daily job that checks the public landing pages + RSS feeds of the
 * regulators this firm is subject to — MoE, EOCN, CBUAE, FATF, LBMA,
 * OFAC, EU Council, UN Security Council, DMCC — and records any new
 * circulars, guidance notes, or announcement headlines in a Netlify
 * Blob store. Writes a `reg_horizon` brain event so the Reg Monitor
 * tab surfaces new items on next load.
 *
 * This differs from `sanctions-ingest-cron.mts`: that one fetches the
 * sanctions LISTS themselves and normalises them. This one fetches
 * the regulator *publications* page and surfaces new headlines so the
 * MLRO knows a circular has dropped the moment it is published.
 *
 * Design decisions:
 *   - Each feed has a short timeout (15s) and an error-isolated fetch.
 *   - A missing RSS endpoint falls back to an HTML scrape of the
 *     anchor text (regex, not DOM). Fragile on purpose — the point is
 *     to catch the headline, not archive the page.
 *   - Deduplication is by a SHA-256 hash of the headline + URL. The
 *     seen-set is persisted across runs so the digest only shows NEW
 *     items.
 *   - Output: array of `{ source, headline, url, publishedAt, hash }`
 *     is written to `regulatory-horizon/daily-{YYYY-MM-DD}.json` and
 *     the brain-events store.
 *
 * Regulatory basis:
 *   FATF Rec 1 (regulatory monitoring must be continuous)
 *   Cabinet Res 134/2025 Art.19 (internal review + horizon scanning)
 *   UAE FDL No.10/2025 Art.22 (30-day policy update deadline after
 *     circular publication)
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { fetchWithTimeout } from '../../src/utils/fetchWithTimeout';

const HORIZON_STORE = 'regulatory-horizon';
const SEEN_STORE = 'regulatory-horizon-seen';
const BRAIN_EVENTS_STORE = 'brain-events';
const FETCH_TIMEOUT_MS = 15_000;

interface RegulatoryFeed {
  id: string;
  source: string;
  kind: 'rss' | 'html';
  url: string;
  /** Regex to extract headlines when kind === 'html'. */
  headlineRegex?: RegExp;
  /** True if the publication resets 30-day policy deadline (FDL Art.22). */
  triggersPolicyDeadline: boolean;
}

/**
 * Feeds are listed here rather than stored in Blobs so the list is
 * audit-reviewable via git blame. Adding a new regulator? PR required.
 */
const FEEDS: RegulatoryFeed[] = [
  {
    id: 'moe-circulars',
    source: 'UAE Ministry of Economy',
    kind: 'html',
    url: 'https://www.moec.gov.ae/en/publications-and-circulars',
    headlineRegex: /<h[23][^>]*>([^<]+)<\/h[23]>/gi,
    triggersPolicyDeadline: true,
  },
  {
    id: 'eocn-advisories',
    source: 'UAE EOCN',
    kind: 'html',
    url: 'https://www.uaeiec.gov.ae/en-us/advisories',
    headlineRegex: /<h[23][^>]*>([^<]+)<\/h[23]>/gi,
    triggersPolicyDeadline: true,
  },
  {
    id: 'cbuae-notices',
    source: 'CBUAE',
    kind: 'html',
    url: 'https://www.centralbank.ae/en/news',
    headlineRegex: /<h[23][^>]*>([^<]+)<\/h[23]>/gi,
    triggersPolicyDeadline: false,
  },
  {
    id: 'fatf-publications',
    source: 'FATF',
    kind: 'rss',
    url: 'https://www.fatf-gafi.org/en/publications.rss',
    triggersPolicyDeadline: true,
  },
  {
    id: 'lbma-news',
    source: 'LBMA',
    kind: 'html',
    url: 'https://www.lbma.org.uk/articles',
    headlineRegex: /<h[23][^>]*>([^<]+)<\/h[23]>/gi,
    triggersPolicyDeadline: false,
  },
  {
    id: 'ofac-recent-actions',
    source: 'OFAC',
    kind: 'rss',
    url: 'https://ofac.treasury.gov/recent-actions/feed.rss',
    triggersPolicyDeadline: true,
  },
  {
    id: 'eu-sanctions',
    source: 'EU Council',
    kind: 'rss',
    url: 'https://www.consilium.europa.eu/en/press/press-releases/?feed=rss',
    triggersPolicyDeadline: true,
  },
  {
    id: 'un-sanctions',
    source: 'UN Security Council',
    kind: 'rss',
    url: 'https://press.un.org/en/rss.xml',
    triggersPolicyDeadline: true,
  },
  {
    id: 'dmcc-news',
    source: 'DMCC',
    kind: 'html',
    url: 'https://www.dmcc.ae/news',
    headlineRegex: /<h[23][^>]*>([^<]+)<\/h[23]>/gi,
    triggersPolicyDeadline: false,
  },
];

interface HorizonItem {
  feedId: string;
  source: string;
  headline: string;
  url: string;
  publishedAt: string;
  hash: string;
  triggersPolicyDeadline: boolean;
}

async function fetchFeedBody(url: string, timeoutMs: number): Promise<string> {
  const res = await fetchWithTimeout(url, {
    timeoutMs,
    headers: { 'user-agent': 'compliance-analyzer regulatory-horizon-cron/1.0' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.text();
}

function extractRssHeadlines(xml: string): Array<{ title: string; link: string; pubDate: string }> {
  const items: Array<{ title: string; link: string; pubDate: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(block) || [])[1] || '';
    const link = (/<link[^>]*>([\s\S]*?)<\/link>/i.exec(block) || [])[1] || '';
    const pubDate = (/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i.exec(block) || [])[1] || new Date().toISOString();
    if (title.trim()) {
      items.push({
        title: title.trim().slice(0, 240),
        link: link.trim(),
        pubDate: pubDate.trim(),
      });
    }
  }
  return items;
}

function extractHtmlHeadlines(html: string, re: RegExp): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  const fresh = new RegExp(re.source, re.flags); // reset lastIndex
  while ((match = fresh.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text && text.length >= 12 && text.length <= 240) {
      out.push(text);
    }
  }
  return Array.from(new Set(out)).slice(0, 20);
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function processFeed(feed: RegulatoryFeed, seen: Set<string>): Promise<HorizonItem[]> {
  try {
    const body = await fetchFeedBody(feed.url, FETCH_TIMEOUT_MS);
    const items: HorizonItem[] = [];

    if (feed.kind === 'rss') {
      const rssItems = extractRssHeadlines(body);
      for (const it of rssItems) {
        const hash = await sha256(feed.id + '|' + it.title + '|' + it.link);
        if (seen.has(hash)) continue;
        items.push({
          feedId: feed.id,
          source: feed.source,
          headline: it.title,
          url: it.link || feed.url,
          publishedAt: it.pubDate,
          hash,
          triggersPolicyDeadline: feed.triggersPolicyDeadline,
        });
      }
    } else if (feed.headlineRegex) {
      const headlines = extractHtmlHeadlines(body, feed.headlineRegex);
      for (const h of headlines) {
        const hash = await sha256(feed.id + '|' + h);
        if (seen.has(hash)) continue;
        items.push({
          feedId: feed.id,
          source: feed.source,
          headline: h,
          url: feed.url,
          publishedAt: new Date().toISOString(),
          hash,
          triggersPolicyDeadline: feed.triggersPolicyDeadline,
        });
      }
    }
    return items;
  } catch (err) {
    return [
      {
        feedId: feed.id,
        source: feed.source,
        headline: '⚠ Feed fetch failed: ' + (err instanceof Error ? err.message : String(err)),
        url: feed.url,
        publishedAt: new Date().toISOString(),
        hash: 'err_' + feed.id + '_' + Date.now(),
        triggersPolicyDeadline: false,
      },
    ];
  }
}

export default async (): Promise<Response> => {
  const startedAt = new Date().toISOString();
  const horizonStore = getStore(HORIZON_STORE);
  const seenStore = getStore(SEEN_STORE);
  const brainEvents = getStore(BRAIN_EVENTS_STORE);

  let seen = new Set<string>();
  try {
    const existing = (await seenStore.get('seen.json', { type: 'json' })) as string[] | null;
    if (Array.isArray(existing)) seen = new Set(existing);
  } catch {}

  const allNew: HorizonItem[] = [];
  for (const feed of FEEDS) {
    const items = await processFeed(feed, seen);
    allNew.push(...items);
    items.forEach((i) => seen.add(i.hash));
  }

  // Persist daily snapshot
  const today = new Date().toISOString().slice(0, 10);
  const snapshotKey = `daily-${today}.json`;
  const existingSnapshot = ((await horizonStore.get(snapshotKey, { type: 'json' })) as HorizonItem[] | null) ?? [];
  await horizonStore.setJSON(snapshotKey, existingSnapshot.concat(allNew));

  // Truncate the seen set to the most recent 2000 hashes so it does not grow unbounded
  const seenArray = Array.from(seen);
  const trimmed = seenArray.length > 2000 ? seenArray.slice(-2000) : seenArray;
  await seenStore.setJSON('seen.json', trimmed);

  // Brain event
  if (allNew.length > 0) {
    const ts = Date.now();
    await brainEvents.setJSON(`reg_horizon_${ts}.json`, {
      type: 'reg_horizon',
      count: allNew.length,
      triggersPolicyDeadline: allNew.some((i) => i.triggersPolicyDeadline),
      at: startedAt,
      sample: allNew.slice(0, 5).map((i) => ({ source: i.source, headline: i.headline })),
    });
  }

  return Response.json({
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    feedsChecked: FEEDS.length,
    newItems: allNew.length,
    policyDeadlineTriggers: allNew.filter((i) => i.triggersPolicyDeadline).length,
  });
};

export const config: Config = {
  // Once per day at 04:00 UTC — after most regulators publish in the
  // early hours and before Asia/Dubai business hours open.
  schedule: '0 4 * * *',
};
