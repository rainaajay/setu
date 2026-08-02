// Claims-consistency guard.
//
// Public numbers have drifted apart three times now: "4 ms" finality that nothing reproduced,
// "423 /s" that fresh benchmarks did not hit, and a WAN latency figure that was unified on two pages
// while pitch.html was left saying something else for a whole cycle. Each was caught by a human
// reading the pages. This test catches it mechanically: retired numbers may never reappear, and a
// metric stated on more than one page must agree.
//
// When a measurement legitimately changes: update CANONICAL here and the pages together, in one commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const PAGES = ['index.html', 'pitch.html', 'whitepaper.html', 'economy.html', 'explorer.html', 'arena.html', 'primer.html', 'credits.html'];

// Strip markup/attributes so CSS lengths, viewBox coords and SVG paths can't look like claims.
function prose(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

const pages = new Map<string, string>();
for (const p of PAGES) {
  try { pages.set(p, prose(readFileSync(join(ROOT, p), 'utf8'))); } catch { /* page may not exist */ }
}

// Numbers we have explicitly retired because no reproducible measurement supports them.
// Each entry: the pattern, and why it was retired (shown when it reappears).
const RETIRED: { re: RegExp; why: string }[] = [
  { re: /\b4\s?ms\b/i, why: '"4 ms" finality was never reproducible; npm run demo shows ~30 ms in-process' },
  { re: /\b423\s?\/s\b/i, why: '"423 /s" was not reproducible; fresh runs give ~340-420 /s' },
  { re: /~?\s?280\s?ms\b/i, why: '"~280 ms" WAN finality was superseded by the measured ~180 ms warm (p50)' },
  { re: /\b200\s?milliseconds\s+across\s+continents\b/i, why: '"200 milliseconds across continents" was superseded by ~180 ms warm across four regions' },
];

test('retired public numbers never reappear on a public page', () => {
  const hits: string[] = [];
  for (const [page, text] of pages) {
    for (const { re, why } of RETIRED) {
      const m = text.match(re);
      if (m) hits.push(`${page}: found "${m[0]}" — ${why}`);
    }
  }
  assert.deepEqual(hits, [], 'retired figures reappeared:\n' + hits.join('\n'));
});

// A metric stated on more than one page must state the SAME value everywhere.
const CANONICAL: { name: string; re: RegExp; expect: string }[] = [
  { name: 'warm WAN certificate finality', re: /~?\s?(\d{2,4})\s?(?:ms|milliseconds)\s+warm/gi, expect: '180' },
  { name: 'in-process finality', re: /~\s?(\d{1,3})\s?ms\s+in-process/gi, expect: '30' },
];

test('a metric stated on multiple public pages agrees everywhere', () => {
  for (const { name, re, expect } of CANONICAL) {
    const seen: string[] = [];
    for (const [page, text] of pages) {
      for (const m of text.matchAll(re)) seen.push(`${page}=${m[1]}`);
    }
    const values = new Set(seen.map((s) => s.split('=')[1]));
    if (values.size === 0) continue; // metric not currently stated anywhere
    assert.equal(values.size, 1, `${name} disagrees across pages: ${seen.join(', ')}`);
    assert.equal([...values][0], expect, `${name} should be ${expect} (found ${[...values][0]}) — update CANONICAL and the pages together`);
  }
});

// The quorum is a protocol fact, not a measurement: it must never be misstated.
test('the 3-of-4 quorum is stated consistently', () => {
  const bad: string[] = [];
  for (const [page, text] of pages) {
    for (const m of text.matchAll(/(\d)\s*(?:of|\/)\s*4\s+(?:signatures?|authorities)/gi)) {
      if (m[1] !== '3') bad.push(`${page}: "${m[0]}"`);
    }
  }
  assert.deepEqual(bad, [], 'quorum misstated (must be 3 of 4):\n' + bad.join('\n'));
});
