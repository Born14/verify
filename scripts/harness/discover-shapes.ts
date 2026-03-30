#!/usr/bin/env bun
/**
 * Stage 8: DISCOVER — Find unclassified failures, propose new shapes
 * ===================================================================
 *
 * When a scenario fails but has no failureClass, the failure doesn't map
 * to any known shape in the taxonomy. This script:
 *
 * 1. Scans the self-test ledger for dirty entries without failureClass
 * 2. Clusters by gate + predicate type + error signature
 * 3. When a cluster reaches 3+ occurrences, proposes a candidate shape
 * 4. Writes candidates to data/discovered-shapes.jsonl for operator review
 *
 * The curriculum agent picks up confirmed shapes on the next nightly run.
 *
 * Usage:
 *   bun scripts/harness/discover-shapes.ts --ledger=data/self-test-ledger.jsonl
 *   bun scripts/harness/discover-shapes.ts --threshold=3   # minimum cluster size
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const PKG_ROOT = resolve(import.meta.dir, '..', '..');

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface LedgerEntry {
  id: string;
  scenario: {
    family: string;
    generator: string;
    description: string;
    failureClass?: string;
  };
  result: {
    success: boolean | null;
    gatesFailed: string[];
    error?: string;
  };
  invariants: Array<{
    name: string;
    passed: boolean;
    violation?: string;
    severity?: string;
  }>;
  clean: boolean;
}

interface ClusterKey {
  gate: string;
  errorSignature: string;
}

interface FailureCluster {
  key: ClusterKey;
  entries: LedgerEntry[];
  count: number;
}

interface CandidateShape {
  proposedId: string;
  domain: string;
  description: string;
  claimType: string;
  evidence: {
    gate: string;
    errorSignature: string;
    occurrences: number;
    sampleScenarios: string[];
  };
  status: 'proposed';
  discoveredAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error signature extraction
// ─────────────────────────────────────────────────────────────────────────────

/** Map gate name → domain for shape ID assignment */
const GATE_TO_DOMAIN: Record<string, string> = {
  grounding: 'css', F9: 'syntax', K5: 'constraints', G5: 'containment',
  staging: 'infra', browser: 'browser', http: 'http', invariants: 'invariant',
  vision: 'vision', triangulation: 'crosscutting', infrastructure: 'infra',
  serialization: 'serialization', config: 'config', security: 'security',
  a11y: 'a11y', performance: 'performance', filesystem: 'filesystem',
  access: 'access', capacity: 'capacity', contention: 'contention',
  state: 'state', temporal: 'temporal', propagation: 'propagation',
  observation: 'observation', content: 'content', hallucination: 'hallucination',
};

/** Domain → shape ID prefix */
const DOMAIN_TO_PREFIX: Record<string, string> = {
  css: 'C', html: 'H', filesystem: 'FS', content: 'N', http: 'P',
  db: 'D', security: 'SEC', config: 'CFG', performance: 'PERF',
  a11y: 'A11Y', infra: 'I', browser: 'BR', temporal: 'TO',
  invariant: 'INV', crosscutting: 'X', access: 'AC', capacity: 'CAP',
  contention: 'CO', state: 'ST', propagation: 'PROP', observation: 'OE',
  serialization: 'SER', containment: 'G5', syntax: 'F9', constraints: 'K5',
  vision: 'VIS', hallucination: 'HAL',
};

/**
 * Extract a stable error signature from a failure.
 * Strips variable parts (timestamps, line numbers, file paths) to cluster similar failures.
 */
function extractErrorSignature(entry: LedgerEntry): string {
  const parts: string[] = [];

  // Failed gates
  if (entry.result.gatesFailed.length > 0) {
    parts.push(`gates:${entry.result.gatesFailed.sort().join(',')}`);
  }

  // Error message (strip numbers and paths)
  if (entry.result.error) {
    const normalized = entry.result.error
      .replace(/\d+/g, 'N')       // numbers
      .replace(/["'][^"']*["']/g, '"..."')  // quoted strings
      .replace(/\/[^\s]+/g, '/...')  // file paths
      .substring(0, 100);
    parts.push(`err:${normalized}`);
  }

  // Failed invariant names + violations
  const failedInvariants = entry.invariants.filter(i => !i.passed);
  if (failedInvariants.length > 0) {
    const invNames = failedInvariants.map(i => i.name).sort().join(',');
    parts.push(`inv:${invNames}`);

    // First violation text (normalized)
    const firstViolation = failedInvariants[0]?.violation;
    if (firstViolation) {
      const normalized = firstViolation
        .replace(/\d+/g, 'N')
        .replace(/["'][^"']*["']/g, '"..."')
        .substring(0, 80);
      parts.push(`viol:${normalized}`);
    }
  }

  return parts.join('|') || 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// Clustering
// ─────────────────────────────────────────────────────────────────────────────

function clusterFailures(entries: LedgerEntry[]): FailureCluster[] {
  const clusters = new Map<string, FailureCluster>();

  for (const entry of entries) {
    const gate = entry.result.gatesFailed[0] ?? 'invariant';
    const sig = extractErrorSignature(entry);
    const key = `${gate}::${sig}`;

    const existing = clusters.get(key);
    if (existing) {
      existing.entries.push(entry);
      existing.count++;
    } else {
      clusters.set(key, {
        key: { gate, errorSignature: sig },
        entries: [entry],
        count: 1,
      });
    }
  }

  return [...clusters.values()].sort((a, b) => b.count - a.count);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shape proposal
// ─────────────────────────────────────────────────────────────────────────────

function proposeShape(cluster: FailureCluster, existingIds: Set<string>): CandidateShape {
  const gate = cluster.key.gate;
  const domain = GATE_TO_DOMAIN[gate] ?? 'unknown';
  const prefix = DOMAIN_TO_PREFIX[domain] ?? 'X';

  // Find next available ID
  let num = 100; // Start discovered shapes at 100 to avoid collisions
  while (existingIds.has(`${prefix}-${num}`)) num++;
  const id = `${prefix}-${num}`;
  existingIds.add(id);

  // Derive description from the cluster
  const sampleDescs = cluster.entries.slice(0, 3).map(e => e.scenario.description);
  const firstViolation = cluster.entries[0]?.invariants.find(i => !i.passed)?.violation
    ?? cluster.entries[0]?.result.error
    ?? cluster.key.errorSignature;

  // Infer claim type from gate
  const claimType = inferClaimTypeFromGate(gate);

  return {
    proposedId: id,
    domain,
    description: `Discovered: ${gate} gate failure — ${firstViolation?.substring(0, 100)}`,
    claimType,
    evidence: {
      gate,
      errorSignature: cluster.key.errorSignature,
      occurrences: cluster.count,
      sampleScenarios: sampleDescs,
    },
    status: 'proposed',
    discoveredAt: new Date().toISOString(),
  };
}

function inferClaimTypeFromGate(gate: string): string {
  const map: Record<string, string> = {
    grounding: 'existence', F9: 'equality', K5: 'invariance', G5: 'containment',
    staging: 'existence', browser: 'equality', http: 'equality', invariants: 'invariance',
    filesystem: 'existence', infrastructure: 'existence', serialization: 'equality',
    config: 'equality', security: 'absence', a11y: 'existence', performance: 'threshold',
    hallucination: 'containment',
  };
  return map[gate] ?? 'equality';
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI + Main
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const ledgerPath = args.find(a => a.startsWith('--ledger='))?.split('=')[1]
  ?? join(PKG_ROOT, 'data', 'self-test-ledger.jsonl');
const threshold = parseInt(args.find(a => a.startsWith('--threshold='))?.split('=')[1] ?? '3');
const outputPath = join(PKG_ROOT, 'data', 'discovered-shapes.jsonl');

function main() {
  console.log('=== Stage 8: DISCOVER ===');
  console.log(`Ledger: ${ledgerPath}`);
  console.log(`Threshold: ${threshold} occurrences`);
  console.log('');

  if (!existsSync(ledgerPath)) {
    console.log('No ledger found. Nothing to discover.');
    return;
  }

  // Parse ledger
  const lines = readFileSync(ledgerPath, 'utf-8').trim().split('\n').filter(l => l);
  const entries: LedgerEntry[] = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as any;

  // Find dirty entries without a failure class
  const unclassified = entries.filter(e =>
    !e.clean && !e.scenario.failureClass
  );

  const classified = entries.filter(e => !e.clean && e.scenario.failureClass);

  console.log(`  Total entries: ${entries.length}`);
  console.log(`  Dirty: ${entries.filter(e => !e.clean).length}`);
  console.log(`  Classified (has shape ID): ${classified.length}`);
  console.log(`  Unclassified (no shape ID): ${unclassified.length}`);
  console.log('');

  if (unclassified.length === 0) {
    console.log('No unclassified failures. Nothing to discover.');
    return;
  }

  // Cluster by gate + error signature
  const clusters = clusterFailures(unclassified);
  console.log(`  Clusters found: ${clusters.length}`);
  for (const c of clusters.slice(0, 10)) {
    console.log(`    ${c.count}x — ${c.key.gate}: ${c.key.errorSignature.substring(0, 80)}`);
  }

  // Propose shapes for clusters above threshold
  const aboveThreshold = clusters.filter(c => c.count >= threshold);
  console.log(`\n  Clusters above threshold (${threshold}): ${aboveThreshold.length}`);

  if (aboveThreshold.length === 0) {
    console.log('  No clusters large enough to propose as shapes.');
    return;
  }

  // Load existing shape IDs to avoid collisions
  const existingIds = new Set<string>();
  if (existsSync(outputPath)) {
    const existing = readFileSync(outputPath, 'utf-8').trim().split('\n').filter(l => l);
    for (const line of existing) {
      try {
        const shape = JSON.parse(line);
        existingIds.add(shape.proposedId);
      } catch { /* skip */ }
    }
  }

  // Propose
  const candidates: CandidateShape[] = [];
  for (const cluster of aboveThreshold) {
    const candidate = proposeShape(cluster, existingIds);
    candidates.push(candidate);
    console.log(`\n  PROPOSED: ${candidate.proposedId} [${candidate.domain}]`);
    console.log(`    ${candidate.description}`);
    console.log(`    Claim type: ${candidate.claimType}`);
    console.log(`    Evidence: ${candidate.evidence.occurrences} occurrences`);
    console.log(`    Samples:`);
    for (const s of candidate.evidence.sampleScenarios.slice(0, 3)) {
      console.log(`      - ${s.substring(0, 80)}`);
    }
  }

  // Append to discovered shapes log
  const newLines = candidates.map(c => JSON.stringify(c)).join('\n');
  const existing = existsSync(outputPath) ? readFileSync(outputPath, 'utf-8') : '';
  writeFileSync(outputPath, existing + (existing && !existing.endsWith('\n') ? '\n' : '') + newLines + '\n');

  console.log(`\n  Written ${candidates.length} candidate shape(s) to ${outputPath}`);
  console.log('  Operator: review and confirm with `status: confirmed` to add to taxonomy.');
}

main();
