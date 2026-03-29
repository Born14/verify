#!/usr/bin/env bun
/**
 * Real-World Harvest Orchestrator
 * ================================
 *
 * Fetches real external data sources, runs format-specific harvesters,
 * and writes scenarios to fixtures/scenarios/real-world/*-staged.json.
 *
 * Usage:
 *   bun scripts/supply/harvest-real.ts                     # all sources
 *   bun scripts/supply/harvest-real.ts --sources=schemapile,mdn-compat
 *   bun scripts/supply/harvest-real.ts --dry-run           # fetch but don't write
 *   bun scripts/supply/harvest-real.ts --cache-only        # skip fetch, use cache
 *   bun scripts/supply/harvest-real.ts --max-per-source=500
 *
 * Cache: .verify-cache/ (gitignored, 24h TTL)
 * Output: fixtures/scenarios/real-world/*-staged.json
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { SOURCES, fetchSource, getSourcesForHarvester, type FetchResult } from './sources.js';
import { harvestDB } from './harvest-db.js';
import { harvestCSS } from './harvest-css.js';
import { harvestHTML } from './harvest-html.js';
import { harvestHTTP } from './harvest-http.js';
import { harvestSecurity } from './harvest-security.js';
import { harvestInfra } from './harvest-infra.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface HarvestResult {
  sourceId: string;
  harvester: string;
  scenarios: any[];
  fetchMs: number;
  harvestMs: number;
  cached: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Harvester dispatch
// ─────────────────────────────────────────────────────────────────────────────

const HARVESTER_FNS: Record<string, (files: string[], max: number) => any[]> = {
  db: harvestDB,
  css: harvestCSS,
  html: harvestHTML,
  http: harvestHTTP,
  security: harvestSecurity,
  infra: harvestInfra,
};

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const cacheOnly = args.includes('--cache-only');
const sourcesArg = args.find(a => a.startsWith('--sources='))?.split('=')[1];
const maxArg = args.find(a => a.startsWith('--max-per-source='))?.split('=')[1];
const maxPerSource = maxArg ? parseInt(maxArg) : undefined;

const pkgRoot = resolve(import.meta.dir, '..', '..');
const cacheDir = join(pkgRoot, '.verify-cache');
const outputDir = join(pkgRoot, 'fixtures', 'scenarios', 'real-world');

mkdirSync(cacheDir, { recursive: true });
mkdirSync(outputDir, { recursive: true });

// Determine which sources to run
const requestedSources = sourcesArg
  ? sourcesArg.split(',').map(s => s.trim())
  : Object.keys(SOURCES);

console.log(`\n═══ Real-World Harvest ═══`);
console.log(`Cache: ${cacheDir}`);
console.log(`Output: ${outputDir}`);
console.log(`Sources: ${requestedSources.join(', ')}`);
console.log(`Dry run: ${dryRun}`);
console.log(`Cache only: ${cacheOnly}`);
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// Main pipeline
// ─────────────────────────────────────────────────────────────────────────────

const results: HarvestResult[] = [];
let totalScenarios = 0;
let totalFetched = 0;
let totalCached = 0;

for (const sourceId of requestedSources) {
  const source = SOURCES[sourceId];
  if (!source) {
    console.log(`  ✗ Unknown source: ${sourceId} (available: ${Object.keys(SOURCES).join(', ')})`);
    continue;
  }

  const harvesterFn = HARVESTER_FNS[source.harvester];
  if (!harvesterFn) {
    console.log(`  ✗ No harvester for: ${source.harvester} (source: ${sourceId})`);
    continue;
  }

  const max = maxPerSource ?? source.maxScenarios;

  try {
    // Step 1: Fetch
    let fetchResult: FetchResult;
    if (cacheOnly) {
      // Use whatever is in cache, don't fetch
      const sourceDir = join(cacheDir, source.id);
      const files = existsSync(sourceDir) ? listFiles(sourceDir) : [];
      fetchResult = { source, files, cached: true, fetchMs: 0 };
      if (files.length === 0) {
        console.log(`  ⊘ ${sourceId}: no cached data (run without --cache-only first)`);
        continue;
      }
    } else {
      fetchResult = await fetchSource(source, cacheDir);
    }

    if (fetchResult.cached) totalCached++;
    else totalFetched++;

    const cacheStatus = fetchResult.cached ? '(cached)' : `(fetched in ${fetchResult.fetchMs}ms)`;

    // Step 2: Harvest
    const harvestStart = Date.now();
    const scenarios = harvesterFn(fetchResult.files, max);
    const harvestMs = Date.now() - harvestStart;

    console.log(`  ✓ ${sourceId}: ${scenarios.length} scenarios ${cacheStatus} [${harvestMs}ms harvest]`);

    results.push({
      sourceId,
      harvester: source.harvester,
      scenarios,
      fetchMs: fetchResult.fetchMs,
      harvestMs,
      cached: fetchResult.cached,
    });

    totalScenarios += scenarios.length;

    // Step 3: Write (unless dry run)
    if (!dryRun && scenarios.length > 0) {
      const outPath = join(outputDir, `${sourceId}-staged.json`);
      writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
    }

  } catch (err: any) {
    console.log(`  ✗ ${sourceId}: ERROR — ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n─── Summary ───`);
console.log(`Sources processed: ${results.length}/${requestedSources.length}`);
console.log(`  Fetched: ${totalFetched}, Cached: ${totalCached}`);
console.log(`Total scenarios: ${totalScenarios}`);
if (!dryRun) {
  console.log(`Output: ${outputDir}/`);
  // List output files
  if (existsSync(outputDir)) {
    const files = readdirSync(outputDir).filter(f => f.endsWith('-staged.json'));
    for (const f of files) {
      try {
        const d = JSON.parse(readFileSync(join(outputDir, f), 'utf-8'));
        console.log(`  ${f}: ${d.length} scenarios`);
      } catch { /* skip */ }
    }
  }
}
console.log('');

// Write harvest manifest for CI
const manifestPath = join(pkgRoot, 'data', 'harvest-manifest.json');
mkdirSync(join(pkgRoot, 'data'), { recursive: true });
writeFileSync(manifestPath, JSON.stringify({
  timestamp: new Date().toISOString(),
  sources: results.map(r => ({
    id: r.sourceId,
    harvester: r.harvester,
    scenarios: r.scenarios.length,
    cached: r.cached,
    fetchMs: r.fetchMs,
    harvestMs: r.harvestMs,
  })),
  totalScenarios,
}, null, 2));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function listFiles(dir: string): string[] {
  const entries: string[] = [];
  function walk(d: string) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name === '.git') continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else entries.push(full);
    }
  }
  walk(dir);
  return entries;
}
