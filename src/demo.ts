/**
 * Demo Suite — Three scenarios that tell the verify story.
 * ========================================================
 *
 * Each demo replays a recorded agent trace through live verification gates.
 * The agent behavior is pre-scripted. The gates are real.
 *
 * The viewer watches gates fire one by one with translated names.
 * This is what verify actually does — the viewer sees it happen.
 */

import { govern } from './govern.js';
import type { GovernAgent, GovernResult, GovernContext } from './govern.js';
import type { VerifyResult } from './types.js';
import { join, resolve, dirname } from 'path';
import { mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

// =============================================================================
// TERMINAL COLORS
// =============================================================================

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const BG_RED = '\x1b[41m';
const BG_GREEN = '\x1b[42m';
const WHITE = '\x1b[37m';

function red(s: string) { return `${RED}${s}${RESET}`; }
function green(s: string) { return `${GREEN}${s}${RESET}`; }
function dim(s: string) { return `${DIM}${s}${RESET}`; }
function bold(s: string) { return `${BOLD}${s}${RESET}`; }

function header(title: string) {
  const line = '\u2550'.repeat(56);
  console.log(`\n${BOLD}${line}${RESET}`);
  console.log(`${BOLD}  ${title}${RESET}`);
  console.log(`${BOLD}${line}${RESET}\n`);
}

// =============================================================================
// PACING (--slow mode for recordings)
// =============================================================================

let slowMode = false;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pause(ms: number = 1500): Promise<void> {
  if (slowMode) await sleep(ms);
}

async function tick(ms: number = 600): Promise<void> {
  if (slowMode) await sleep(ms);
}

// =============================================================================
// GATE NAMES — translate internal IDs to plain English
// =============================================================================

const GATE_LABELS: Record<string, string> = {
  grounding: 'Grounding check',
  F9: 'Syntax validation',
  K5: 'Constraint check',
  G5: 'Containment check',
  hallucination: 'Hallucination detection',
  access: 'Access boundary check',
  temporal: 'Temporal consistency',
  propagation: 'Propagation check',
  state: 'State integrity',
  capacity: 'Capacity check',
  contention: 'Contention detection',
  observation: 'Observer effect check',
  filesystem: 'File integrity',
  triangulation: 'Cross-authority check',
  staging: 'Staging validation',
  browser: 'Browser verification',
  http: 'HTTP endpoint check',
  invariants: 'System health check',
  security: 'Security scan',
  a11y: 'Accessibility check',
  performance: 'Performance budget',
  content: 'Content verification',
  config: 'Config validation',
  serialization: 'Serialization check',
  infrastructure: 'Infrastructure check',
};

function getGateLabel(gate: string): string {
  return GATE_LABELS[gate] || gate;
}

/** Translate a failed gate's detail into a short plain-English reason. */
function failReason(gate: string, detail: string): string {
  if (gate === 'grounding') {
    const match = detail.match(/"([^"]+)"/);
    return match ? `selector ${match[1]} does not exist in source` : detail;
  }
  if (gate === 'filesystem') {
    if (detail.includes('does not exist')) return 'claimed file does not exist';
    if (detail.includes('unchanged') || detail.includes('modified')) return 'undeclared file mutation detected';
    return detail.split(':').slice(0, 2).join(':');
  }
  return detail.length > 60 ? detail.slice(0, 57) + '...' : detail;
}

// =============================================================================
// LIVE GATE ANIMATION — the viewer watches verify work
// =============================================================================

/** Stream gate results one at a time with translated names. */
async function animateGates(result: VerifyResult, indent: string = '    ') {
  console.log(`${indent}${dim('Running verification gates...')}`);
  await tick(400);

  for (const gate of result.gates) {
    const label = getGateLabel(gate.gate);
    const padded = label.padEnd(26);

    if (gate.passed) {
      console.log(`${indent}  ${green('\u2713')} ${dim(padded)}`);
    } else {
      const reason = failReason(gate.gate, gate.detail);
      console.log(`${indent}  ${red('\u2717')} ${bold(padded)} ${red(reason)}`);
    }
    await tick(250);
  }
  await tick(400);
}

// =============================================================================
// SHARED HELPERS
// =============================================================================

function suppressLogs(): () => void {
  const original = console.log;
  console.log = () => {};
  return () => { console.log = original; };
}

function makeTempApp(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const fixtureDir = resolve(__dirname, '..', 'fixtures', 'demo-app');
  const tempDir = join(tmpdir(), `verify-demo-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  cpSync(fixtureDir, tempDir, { recursive: true });
  return tempDir;
}

function cleanup(tempDir: string) {
  try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
}

function printWhyMissed(lines: string[]) {
  console.log(`\n  ${YELLOW}Why your stack missed this:${RESET}`);
  for (const line of lines) {
    console.log(`  ${DIM}${line}${RESET}`);
  }
}

// =============================================================================
// DEMO E: "The Agent Said Done" — THE HOOK
// =============================================================================

async function runDemoLiar() {
  header('The Agent Said Done');

  console.log(`${DIM}Goal: "Write the weekly report and save to reports/weekly.md"${RESET}\n`);
  await pause(2000);

  // --- WITHOUT: actually simulate the damage ---
  const damageDir = makeTempApp();
  console.log(`${DIM}Without verify \u2014 the agent runs unverified:${RESET}\n`);
  await tick();
  console.log(`  ${DIM}Agent says: "Report saved successfully. \u2713"${RESET}`);
  await tick(800);
  console.log(`  ${DIM}Pipeline continues. Next stage assumes the file exists.${RESET}\n`);
  await tick();

  const reportPath = join(damageDir, 'reports', 'weekly.md');
  console.log(`  ${RED}$ ls reports/weekly.md${RESET}`);
  await tick(400);
  console.log(`  ${RED}ls: cannot access 'reports/weekly.md': No such file or directory${RESET}`);
  await tick(800);
  console.log(`  ${DIM}\u2192 The file was never created. The agent lied.${RESET}`);
  cleanup(damageDir);
  await pause(2500);

  // --- WITH: run govern() silently, then animate ---
  console.log(`\n${CYAN}Replaying recorded agent trace through live verification gates:${RESET}\n`);
  await pause();

  const tempDir = makeTempApp();
  const stateDir = join(tempDir, '.verify-demo');
  mkdirSync(stateDir, { recursive: true });

  const agent: GovernAgent = {
    plan: async (_goal: string, ctx: GovernContext) => {
      if (ctx.attempt === 1) {
        return {
          edits: [],
          predicates: [{ type: 'filesystem_exists' as const, file: 'reports/weekly.md', description: 'Weekly report exists' }],
        };
      }
      return {
        edits: [{
          file: 'reports/weekly.md',
          search: '',
          replace: '# Weekly Report\n\nAll tasks completed.\n\n- Feature A: shipped\n- Bug B: fixed\n- Review C: approved\n',
        }],
        predicates: [{ type: 'filesystem_exists' as const, file: 'reports/weekly.md', description: 'Weekly report exists' }],
      };
    },
  };

  const restore = suppressLogs();
  const result = await govern({
    appDir: tempDir,
    goal: 'Write the weekly report and save to reports/weekly.md',
    agent,
    maxAttempts: 3,
    stateDir,
    gates: { grounding: false, staging: false, browser: false, http: false, vision: false, invariants: false },
  });
  restore();

  // --- Animate attempt 1 ---
  console.log(`  ${bold('Trace 1:')} Agent claims completion without creating the file.`);
  await tick(800);
  if (result.history.length > 0 && !result.history[0].success) {
    // No edits = gates don't run. Show the predicate check directly.
    console.log(`    ${dim('Running verification gates...')}`);
    await tick(400);
    console.log(`      ${dim('Agent provided 0 edits. Checking predicates directly...')}`);
    await tick(600);
    console.log(`      ${red('\u2717')} ${bold('File integrity'.padEnd(26))} ${red('reports/weekly.md does not exist')}`);
    await tick(800);
    console.log(`  \u2192 ${dim('Constraint seeded: can\'t claim success without file evidence.')}`);
    await pause();
    printWhyMissed([
      'The agent framework accepted the completion message at face value.',
      'A unit test wouldn\'t catch this \u2014 nothing asserted the artifact existed.',
    ]);
    await pause(2000);
  }

  // --- Animate attempt 2 gates ---
  if (result.success && result.attempts >= 2) {
    console.log(`\n  ${bold('Trace 2:')} Injecting constraints and re-running. Agent creates the file.`);
    await tick(800);
    await animateGates(result.history[1]);
    console.log(`\n  ${green('\u2713')} ${bold('Converged in 2 attempts.')}`);
    await pause();
  }

  console.log(`\n${bold('Verify does not trust status messages. It checks reality.')}`);
  await pause(2000);
  cleanup(tempDir);
}

// =============================================================================
// DEMO A: "Wrong World Model" — THE ENGINE
// =============================================================================

async function runDemoWorld() {
  header('Wrong World Model');

  console.log(`${DIM}Goal: "Style the profile navigation on the about page"${RESET}\n`);
  await pause(2000);

  // --- WITHOUT ---
  const damageDir = makeTempApp();
  console.log(`${DIM}Without verify \u2014 the agent runs unverified:${RESET}\n`);
  await tick();

  const serverPath = join(damageDir, 'server.js');
  let serverContent = readFileSync(serverPath, 'utf-8');
  serverContent = serverContent.replace(
    'a.nav-link { color: #0066cc; margin-right: 1rem; }',
    'a.nav-link { color: #0066cc; margin-right: 1rem; }\n    .profile-nav { color: #2c3e50; font-weight: bold; padding: 1rem; }',
  );
  writeFileSync(serverPath, serverContent);

  console.log(`  ${DIM}Agent says: "Added profile section using .profile-nav. \u2713"${RESET}\n`);
  await tick(800);
  console.log(`  ${RED}$ grep '.profile-nav' server.js${RESET}`);
  await tick(400);
  console.log(`  ${DIM}    .profile-nav { color: #2c3e50; font-weight: bold; padding: 1rem; }${RESET}`);
  await tick(800);
  console.log(`\n  ${RED}$ grep -c 'class="profile-nav"' server.js${RESET}`);
  await tick(400);
  console.log(`  ${RED}0${RESET}`);
  await tick(800);
  console.log(`  ${DIM}\u2192 The CSS rule exists. The element it targets does not. Page unchanged.${RESET}`);
  cleanup(damageDir);
  await pause(2500);

  // --- WITH ---
  console.log(`\n${CYAN}Replaying recorded agent trace through live verification gates:${RESET}\n`);
  await pause();

  const tempDir = makeTempApp();
  const stateDir = join(tempDir, '.verify-demo');
  mkdirSync(stateDir, { recursive: true });

  const agent: GovernAgent = {
    plan: async (_goal: string, ctx: GovernContext) => {
      if (ctx.attempt === 1) {
        return {
          edits: [{
            file: 'server.js',
            search: '.hero { background: #3498db;',
            replace: '.hero { background: #2c3e50;',
          }],
          predicates: [{
            type: 'css' as const,
            selector: '.profile-nav',
            property: 'color',
            expected: '#2c3e50',
            path: '/about',
            description: 'Profile nav section styled',
          }],
        };
      }
      return {
        edits: [{
          file: 'server.js',
          search: 'a.nav-link { color: #0066cc; margin-right: 1rem; }',
          replace: 'a.nav-link { color: #0066cc; margin-right: 1rem; font-weight: bold; }',
        }],
        predicates: [{
          type: 'css' as const,
          selector: 'a.nav-link',
          property: 'font-weight',
          expected: 'bold',
          path: '/about',
          description: 'Nav links bold for profile section',
        }],
      };
    },
  };

  const restore = suppressLogs();
  const result = await govern({
    appDir: tempDir,
    goal: 'Style the profile navigation on the about page',
    agent,
    maxAttempts: 3,
    stateDir,
    gates: { staging: false, browser: false, http: false, vision: false, invariants: false },
  });
  restore();

  // --- Animate attempt 1 ---
  console.log(`  ${bold('Trace 1:')} Agent uses selector .profile-nav`);
  await tick(800);
  if (result.history.length > 0) {
    await animateGates(result.history[0]);

    if (!result.history[0].success) {
      await tick(400);
      console.log(`    ${dim('Real selectors on /about: .hero, .card, .nav-link, .team-list, .badge')}`);
      await tick(800);
      console.log(`  \u2192 ${dim('.profile-nav banned. Search space narrowed.')}`);
      await pause();
      printWhyMissed([
        'A linter would not flag this \u2014 the CSS is syntactically valid.',
        'The agent framework saw valid code and called it done.',
      ]);
      await pause(2000);
    }
  }

  // --- Animate attempt 2 ---
  if (result.success && result.attempts >= 2) {
    console.log(`\n  ${bold('Trace 2:')} Injecting constraints and re-running. Agent uses a.nav-link.`);
    await tick(800);
    await animateGates(result.history[1]);
    console.log(`\n  ${green('\u2713')} ${bold('Converged in 2 attempts.')}`);
    await pause();
  }

  console.log(`\n${bold('The agent planned against a world that doesn\'t exist. Verify forced it into the real one.')}`);
  await pause(2000);
  cleanup(tempDir);
}

// =============================================================================
// DEMO B: "The Silent Drift" — THE CLOSER
// =============================================================================

async function runDemoDrift() {
  header('The Silent Drift');

  console.log(`${DIM}Goal: "Change the hero background to navy"${RESET}\n`);
  await pause(2000);

  // --- WITHOUT ---
  const damageDir = makeTempApp();
  console.log(`${DIM}Without verify \u2014 the agent runs unverified:${RESET}\n`);
  await tick();

  const configBefore = readFileSync(join(damageDir, 'config.json'), 'utf-8');

  let serverSrc = readFileSync(join(damageDir, 'server.js'), 'utf-8');
  serverSrc = serverSrc.replace('.hero { background: #3498db;', '.hero { background: #001f3f;');
  writeFileSync(join(damageDir, 'server.js'), serverSrc);

  let configSrc = readFileSync(join(damageDir, 'config.json'), 'utf-8');
  configSrc = configSrc.replace('"darkMode": true', '"darkMode": false');
  configSrc = configSrc.replace('"analytics": false', '"analytics": true');
  writeFileSync(join(damageDir, 'config.json'), configSrc);

  console.log(`  ${DIM}Agent says: "Updated hero section as requested. \u2713"${RESET}\n`);
  await tick(800);
  console.log(`  ${RED}$ diff config.json.orig config.json${RESET}`);
  await tick(400);
  console.log(`  ${RED}- "darkMode": true${RESET}`);
  console.log(`  ${GREEN}+ "darkMode": false${RESET}`);
  await tick(600);
  console.log(`  ${RED}- "analytics": false${RESET}`);
  console.log(`  ${GREEN}+ "analytics": true${RESET}`);
  await tick(800);
  console.log(`\n  ${DIM}\u2192 Hero background changed. But config.json was silently modified too.${RESET}`);
  await tick(800);
  console.log(`  ${DIM}\u2192 Tests pass. Deploys fine. Config drift surfaces days later.${RESET}`);
  cleanup(damageDir);
  await pause(2500);

  // --- WITH ---
  console.log(`\n${CYAN}Replaying recorded agent trace through live verification gates:${RESET}\n`);
  await pause();

  const tempDir = makeTempApp();
  const stateDir = join(tempDir, '.verify-demo');
  mkdirSync(stateDir, { recursive: true });

  const configHash = createHash('sha256')
    .update(readFileSync(join(tempDir, 'config.json')))
    .digest('hex');

  const agent: GovernAgent = {
    plan: async (_goal: string, ctx: GovernContext) => {
      if (ctx.attempt === 1) {
        return {
          edits: [
            {
              file: 'server.js',
              search: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; }',
              replace: '.hero { background: #001f3f; color: white; padding: 2rem; border-radius: 8px; }',
            },
            { file: 'config.json', search: '"darkMode": true', replace: '"darkMode": false' },
            { file: 'config.json', search: '"analytics": false', replace: '"analytics": true' },
          ],
          predicates: [
            { type: 'css' as const, selector: '.hero', property: 'background', expected: '#001f3f', path: '/about', description: 'Hero background is navy' },
            { type: 'filesystem_unchanged' as const, file: 'config.json', hash: configHash, description: 'Config file unchanged' },
          ],
        };
      }
      return {
        edits: [{
          file: 'server.js',
          search: '.hero { background: #3498db; color: white; padding: 2rem; border-radius: 8px; }',
          replace: '.hero { background: #001f3f; color: white; padding: 2rem; border-radius: 8px; }',
        }],
        predicates: [{
          type: 'css' as const, selector: '.hero', property: 'background', expected: '#001f3f', path: '/about', description: 'Hero background is navy',
        }],
      };
    },
  };

  const restore = suppressLogs();
  const result = await govern({
    appDir: tempDir,
    goal: 'Change the hero background to navy',
    agent,
    maxAttempts: 3,
    stateDir,
    gates: { constraints: false, staging: false, browser: false, http: false, vision: false, invariants: false },
  });
  restore();

  // --- Animate attempt 1 ---
  console.log(`  ${bold('Trace 1:')} Agent edits server.js and config.json.`);
  await tick(800);
  if (result.history.length > 0) {
    await animateGates(result.history[0]);

    if (!result.history[0].success) {
      await tick(400);
      console.log(`    ${dim('Declared: server.js (.hero background)')}`);
      await tick(400);
      console.log(`    ${dim('Undeclared: config.json (darkMode, analytics)')}`);
      await tick(800);
      console.log(`  \u2192 ${dim('config.json was modified but not covered by any predicate.')}`);
      await pause();
      printWhyMissed([
        'The visible task succeeded. Tests pass \u2014 they don\'t test config consistency.',
        'Code review might catch it. At 3 AM on an auto-deploy, it won\'t.',
      ]);
      await pause(2000);
    }
  }

  // --- Animate attempt 2 ---
  if (result.success && result.attempts >= 2) {
    console.log(`\n  ${bold('Trace 2:')} Injecting constraints and re-running. Agent edits server.js only.`);
    await tick(800);
    await animateGates(result.history[1]);
    console.log(`\n  ${green('\u2713')} ${bold('Converged in 2 attempts.')}`);
    await pause();
  }

  console.log(`\n${bold('The most dangerous agent failures are the ones that look like success.')}`);
  await pause(2000);
  cleanup(tempDir);
}

// =============================================================================
// EXPORTS
// =============================================================================

export type DemoScenario = 'liar' | 'world' | 'drift';

export async function runDemo(scenario: DemoScenario, slow: boolean = false) {
  slowMode = slow;
  switch (scenario) {
    case 'liar':
      return runDemoLiar();
    case 'world':
      return runDemoWorld();
    case 'drift':
      return runDemoDrift();
    default:
      console.error(`Unknown demo scenario: ${scenario}`);
      console.error('Available: liar, world, drift');
      process.exit(1);
  }
}
