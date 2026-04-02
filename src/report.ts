/**
 * Reliability Profile Report
 * ==========================
 *
 * Takes one or more VerifyResult objects and produces a human-readable
 * reliability profile: how does this agent fail on this codebase?
 *
 * This is what verify KNOWS after it runs — not pass/fail, but a profile
 * of the gap between what the agent intended and what's actually true.
 */

import type { VerifyResult, GateResult } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SensorReading {
  sensor: string;
  question: string;
  totalChecks: number;
  passed: number;
  failed: number;
  rate: number; // 0.0 - 1.0, percentage of checks that passed
  findings: string[];
}

export interface ReliabilityProfile {
  /** How many verify() runs were analyzed */
  runsAnalyzed: number;
  /** Overall: what fraction of runs had all gates pass */
  overallPassRate: number;
  /** Per-sensor readings — the core of the profile */
  sensors: SensorReading[];
  /** Top failure patterns across all runs */
  topFailures: Array<{ pattern: string; count: number; sensor: string }>;
  /** What K5 has learned (constraint signatures) */
  learnedPatterns: string[];
  /** Containment: does the agent stay in scope? */
  scopeDiscipline: { totalMutations: number; unexplained: number; rate: number } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sensor metadata — what each sensor measures, in plain language
// ─────────────────────────────────────────────────────────────────────────────

const SENSOR_QUESTIONS: Record<string, string> = {
  grounding:      'Did the agent reference things that actually exist?',
  F9:             'Did the agent\'s edits actually apply to the file?',
  K5:             'Is the agent repeating a known mistake?',
  G5:             'Did the agent do only what it declared?',
  filesystem:     'Did the agent\'s file claims match reality?',
  security:       'Did the agent introduce dangerous patterns?',
  a11y:           'Did the agent break accessibility?',
  performance:    'Did the agent introduce performance anti-patterns?',
  access:         'Did the agent escalate privileges?',
  temporal:       'Did the agent create config drift?',
  propagation:    'Did the agent break cross-file references?',
  state:          'Did the agent assume things that aren\'t true?',
  capacity:       'Did the agent create resource exhaustion risks?',
  contention:     'Did the agent introduce race conditions?',
  observation:    'Would verifying this change the system?',
  hallucination:  'Did the agent claim things that aren\'t grounded?',
  infrastructure: 'Does the infrastructure state match expectations?',
  serialization:  'Is the data format valid?',
  config:         'Are config values correct?',
  staging:        'Does the code build and start?',
  browser:        'Does it render correctly in a real browser?',
  http:           'Do the HTTP endpoints respond correctly?',
  invariants:     'Are system health checks still passing?',
  vision:         'Does it look right visually?',
  content:        'Does the file contain the expected content?',
  goal:           'Does the output match the stated goal?',
};

// ─────────────────────────────────────────────────────────────────────────────
// Profile builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildProfile(results: VerifyResult[]): ReliabilityProfile {
  const sensorMap = new Map<string, { passed: number; failed: number; findings: string[] }>();
  const failurePatterns = new Map<string, { count: number; sensor: string }>();
  const learnedPatterns: Set<string> = new Set();
  let totalMutations = 0;
  let totalUnexplained = 0;
  let hasContainment = false;
  let overallPassed = 0;

  for (const result of results) {
    if (result.success) overallPassed++;

    // Aggregate per-sensor
    for (const gate of result.gates) {
      let entry = sensorMap.get(gate.gate);
      if (!entry) {
        entry = { passed: 0, failed: 0, findings: [] };
        sensorMap.set(gate.gate, entry);
      }
      if (gate.passed) {
        entry.passed++;
      } else {
        entry.failed++;
        if (gate.detail) {
          entry.findings.push(gate.detail);
          // Track failure patterns
          const pattern = extractPattern(gate.detail, gate.gate);
          const existing = failurePatterns.get(pattern);
          if (existing) {
            existing.count++;
          } else {
            failurePatterns.set(pattern, { count: 1, sensor: gate.gate });
          }
        }
      }
    }

    // Containment
    if (result.containment) {
      hasContainment = true;
      totalMutations += result.containment.totalMutations;
      totalUnexplained += result.containment.unexplained;
    }

    // K5 learned constraints
    if (result.constraintDelta) {
      for (const sig of result.constraintDelta.seeded) {
        learnedPatterns.add(sig);
      }
    }
    if (result.narrowing?.constraints) {
      for (const c of result.narrowing.constraints) {
        learnedPatterns.add(c.signature);
      }
    }
  }

  // Build sensor readings
  const sensors: SensorReading[] = [];
  for (const [sensor, data] of sensorMap) {
    const total = data.passed + data.failed;
    sensors.push({
      sensor,
      question: SENSOR_QUESTIONS[sensor] || `Is the ${sensor} check satisfied?`,
      totalChecks: total,
      passed: data.passed,
      failed: data.failed,
      rate: total > 0 ? data.passed / total : 1,
      findings: data.findings.slice(0, 5), // cap at 5 per sensor
    });
  }

  // Sort: worst sensors first
  sensors.sort((a, b) => a.rate - b.rate);

  // Top failure patterns
  const topFailures = [...failurePatterns.entries()]
    .map(([pattern, { count, sensor }]) => ({ pattern, count, sensor }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    runsAnalyzed: results.length,
    overallPassRate: results.length > 0 ? overallPassed / results.length : 0,
    sensors,
    topFailures,
    learnedPatterns: [...learnedPatterns],
    scopeDiscipline: hasContainment
      ? { totalMutations, unexplained: totalUnexplained, rate: totalMutations > 0 ? 1 - (totalUnexplained / totalMutations) : 1 }
      : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Report formatter
// ─────────────────────────────────────────────────────────────────────────────

export function formatProfile(profile: ReliabilityProfile): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('AGENT RELIABILITY PROFILE');
  lines.push('\u2550'.repeat(60));
  lines.push(`Runs analyzed: ${profile.runsAnalyzed}`);
  lines.push(`Overall pass rate: ${pct(profile.overallPassRate)}`);
  lines.push('');

  // Sensor readings
  lines.push('SENSOR READINGS');
  lines.push('\u2500'.repeat(60));
  lines.push('');

  for (const s of profile.sensors) {
    const bar = renderBar(s.rate, 20);
    const status = s.failed === 0 ? '\u2713' : '\u2717';
    lines.push(`  ${status} ${s.sensor.padEnd(16)} ${bar} ${pct(s.rate).padStart(5)} (${s.passed}/${s.totalChecks})`);
    lines.push(`    ${s.question}`);

    if (s.failed > 0 && s.findings.length > 0) {
      const uniqueFindings = [...new Set(s.findings)].slice(0, 3);
      for (const f of uniqueFindings) {
        lines.push(`    \u2192 ${truncate(f, 70)}`);
      }
    }
    lines.push('');
  }

  // Top failure patterns
  if (profile.topFailures.length > 0) {
    lines.push('TOP FAILURE PATTERNS');
    lines.push('\u2500'.repeat(60));
    lines.push('');
    for (const f of profile.topFailures) {
      lines.push(`  ${f.count}x  [${f.sensor}] ${f.pattern}`);
    }
    lines.push('');
  }

  // Scope discipline
  if (profile.scopeDiscipline) {
    lines.push('SCOPE DISCIPLINE (Containment)');
    lines.push('\u2500'.repeat(60));
    lines.push('');
    lines.push(`  Total mutations: ${profile.scopeDiscipline.totalMutations}`);
    lines.push(`  Unexplained:     ${profile.scopeDiscipline.unexplained}`);
    lines.push(`  In-scope rate:   ${pct(profile.scopeDiscipline.rate)}`);
    if (profile.scopeDiscipline.unexplained > 0) {
      lines.push(`  \u26a0 Agent modified files it didn't declare in ${profile.scopeDiscipline.unexplained} edit(s)`);
    }
    lines.push('');
  }

  // Learned patterns (K5)
  if (profile.learnedPatterns.length > 0) {
    lines.push('LEARNED FAILURE PATTERNS (K5)');
    lines.push('\u2500'.repeat(60));
    lines.push('');
    lines.push('  These patterns are now banned — the agent will be blocked');
    lines.push('  if it tries the same approach again:');
    lines.push('');
    for (const p of profile.learnedPatterns) {
      lines.push(`  \u2022 ${p}`);
    }
    lines.push('');
  }

  // Bottom line
  lines.push('\u2500'.repeat(60));

  const failingSensors = profile.sensors.filter(s => s.failed > 0);
  if (failingSensors.length === 0) {
    lines.push('  All sensors nominal. Agent edits aligned with reality.');
  } else {
    lines.push(`  ${failingSensors.length} sensor(s) detected gaps between agent intent and reality.`);
    lines.push('  This profile shows HOW this agent fails on this codebase —');
    lines.push('  not whether it fails, but the specific dimensions where');
    lines.push('  the agent\'s model of reality diverges from the filesystem.');
  }
  lines.push('');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function renderBar(rate: number, width: number): string {
  const filled = Math.round(rate * width);
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

function truncate(s: string, len: number): string {
  if (s.length <= len) return s;
  return s.slice(0, len - 3) + '...';
}

function extractPattern(detail: string, gate: string): string {
  // Normalize details into reusable pattern strings
  // Remove file-specific paths, keep the failure type
  let pattern = detail
    .replace(/[a-f0-9]{8,}/g, '<hash>')
    .replace(/\d+ms/g, '<time>')
    .replace(/line \d+/g, 'line N');

  if (pattern.length > 80) pattern = pattern.slice(0, 77) + '...';
  return pattern;
}
