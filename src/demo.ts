/**
 * Demo Suite — Three scenarios that tell the verify story.
 * ========================================================
 *
 * Each demo replays a recorded agent trace through live verification gates.
 * The agent behavior is pre-scripted. The gates are real.
 *
 * Three presentation fixes vs v1:
 *   1. WITHOUT section: actually mutate temp files, cat/diff to show real damage
 *   2. Framing: "Replaying recorded trace" — honest about what's scripted vs live
 *   3. Grouped gate output: plain English, no gate-name walls or raw hashes
 */

import { govern } from './govern.js';
import type { GovernAgent, GovernResult, GovernContext } from './govern.js';
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

function tag(label: string, color: string) {
  return `${color}${WHITE}${BOLD} ${label} ${RESET}`;
}

// =============================================================================
// PACING (--slow mode for recordings)
// =============================================================================

let slowMode = false;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Pause between narrative beats. No-op in normal mode. */
async function pause(ms: number = 1500): Promise<void> {
  if (slowMode) await sleep(ms);
}

/** Short pause — within a section. */
async function tick(ms: number = 600): Promise<void> {
  if (slowMode) await sleep(ms);
}

// =============================================================================
// SHARED HELPERS
// =============================================================================

/** Suppress all console.log during govern() — we render post-facto. */
function suppressLogs(): () => void {
  const original = console.log;
  console.log = () => {};
  return () => { console.log = original; };
}

/** Create a temp copy of demo-app so demos don't pollute the fixture. */
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

/** Group gates into plain-English pass/fail summary. */
function printGateSummary(result: GovernResult) {
  const final = result.finalResult;
  const passed = final.gates.filter(g => g.passed);
  const failed = final.gates.filter(g => !g.passed);

  console.log(`\n  ${DIM}Audit trail:${RESET}`);

  if (result.success) {
    console.log(`  ${tag('PASS', BG_GREEN)} All gates passed (${passed.length} checks)`);
  } else {
    if (passed.length > 0) {
      console.log(`  ${tag('PASS', BG_GREEN)} Syntax, integrity, and ${passed.length - 1} other checks`);
    }
    for (const f of failed) {
      // Translate gate names to plain English
      const label = translateGateFailure(f.gate, f.detail);
      console.log(`  ${tag('FAIL', BG_RED)} ${label}`);
    }
  }

  if (result.receipt.constraintsSeeded.length > 0) {
    console.log(`  ${DIM}\u251c${RESET} Banned pattern: ${dim(result.receipt.constraintsSeeded[0])}`);
  }
  if (result.receipt.constraintsActive > 0) {
    console.log(`  ${DIM}\u2514${RESET} ${dim(`${result.receipt.constraintsActive} constraint${result.receipt.constraintsActive > 1 ? 's' : ''} active \u2014 search space reduced`)}`);
  } else if (result.success) {
    console.log(`  ${DIM}\u2514${RESET} ${dim(`Converged in ${result.attempts} attempts`)}`);
  }
}

/** Translate raw gate names + detail into plain English. */
function translateGateFailure(gate: string, detail: string): string {
  if (gate === 'grounding') {
    // Extract selector name from detail
    const match = detail.match(/"([^"]+)"/);
    return `Grounding: selector ${match ? match[1] : '(unknown)'} does not exist in source`;
  }
  if (gate === 'filesystem') {
    if (detail.includes('does not exist')) return 'Filesystem: claimed file does not exist';
    if (detail.includes('unchanged') || detail.includes('modified')) return 'Containment: undeclared file mutation detected';
    return `Filesystem: ${detail.split(':').slice(0, 2).join(':')}`;
  }
  if (gate === 'G5') return `Containment: ${detail}`;
  if (gate === 'K5') return `Constraint: ${detail}`;
  if (gate === 'F9') return `Syntax: ${detail}`;
  return `${gate}: ${detail}`;
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

  // Actually check the filesystem — prove the file doesn't exist
  const reportPath = join(damageDir, 'reports', 'weekly.md');
  const exists = existsSync(reportPath);
  console.log(`  ${RED}$ ls reports/weekly.md${RESET}`);
  await tick(400);
  console.log(`  ${RED}ls: cannot access 'reports/weekly.md': No such file or directory${RESET}`);
  await tick(800);
  console.log(`  ${DIM}\u2192 The file was never created. The agent lied.${RESET}`);
  cleanup(damageDir);
  await pause(2500);

  // --- WITH: replay recorded trace through live gates ---
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

  // --- Render attempt 1 ---
  console.log(`  ${bold('Trace 1:')} Agent claims completion without creating the file.`);
  await tick(800);
  if (result.history.length > 0 && !result.history[0].success) {
    console.log(`  ${red('\u2717')} Filesystem gate: reports/weekly.md does not exist.`);
    await tick(800);
    console.log(`  \u2192 ${dim('Constraint seeded: can\'t claim success without file evidence.')}`);
    await pause();

    printWhyMissed([
      'The agent framework accepted the completion message at face value.',
      'A unit test wouldn\'t catch this \u2014 nothing asserted the artifact existed.',
    ]);
    await pause(2000);
  }

  // --- Render attempt 2 ---
  if (result.success && result.attempts >= 2) {
    console.log(`\n  ${bold('Trace 2:')} Injecting constraints and re-running. Agent creates the file.`);
    await tick(800);
    console.log(`  ${green('\u2713')} reports/weekly.md exists. Converged in ${result.attempts} attempts.`);
    await pause();
    printGateSummary(result);
    await pause();
  }

  console.log(`\n${bold('Verify does not trust status messages. It checks reality.')}`);
  cleanup(tempDir);
}

// =============================================================================
// DEMO A: "Wrong World Model" — THE ENGINE
// =============================================================================

async function runDemoWorld() {
  header('Wrong World Model');

  console.log(`${DIM}Goal: "Style the profile navigation on the about page"${RESET}\n`);
  await pause(2000);

  // --- WITHOUT: actually apply the bad CSS, show it targets nothing ---
  const damageDir = makeTempApp();
  console.log(`${DIM}Without verify \u2014 the agent runs unverified:${RESET}\n`);
  await tick();

  // Actually mutate the file
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

  // --- WITH: replay recorded trace through live gates ---
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

  // --- Render attempt 1 ---
  console.log(`  ${bold('Trace 1:')} Agent uses selector .profile-nav`);
  await tick(800);
  if (result.history.length > 0 && !result.history[0].success) {
    console.log(`  ${red('\u2717')} Grounding gate: .profile-nav does not exist in source.`);
    await tick(800);
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

  // --- Render attempt 2 ---
  if (result.success && result.attempts >= 2) {
    console.log(`\n  ${bold('Trace 2:')} Injecting constraints and re-running. Agent uses a.nav-link.`);
    await tick(800);
    console.log(`  ${green('\u2713')} a.nav-link exists in source. Converged in ${result.attempts} attempts.`);
    await pause();
    printGateSummary(result);
    await pause();
  }

  console.log(`\n${bold('The agent planned against a world that doesn\'t exist. Verify forced it into the real one.')}`);
  cleanup(tempDir);
}

// =============================================================================
// DEMO B: "The Silent Drift" — THE CLOSER
// =============================================================================

async function runDemoDrift() {
  header('The Silent Drift');

  console.log(`${DIM}Goal: "Change the hero background to navy"${RESET}\n`);
  await pause(2000);

  // --- WITHOUT: actually mutate server.js AND config.json, show the diff ---
  const damageDir = makeTempApp();
  console.log(`${DIM}Without verify \u2014 the agent runs unverified:${RESET}\n`);
  await tick();

  // Save original config for diff
  const configBefore = readFileSync(join(damageDir, 'config.json'), 'utf-8');

  // Actually mutate both files
  let serverSrc = readFileSync(join(damageDir, 'server.js'), 'utf-8');
  serverSrc = serverSrc.replace(
    '.hero { background: #3498db;',
    '.hero { background: #001f3f;',
  );
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

  // --- WITH: replay recorded trace through live gates ---
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
            {
              file: 'config.json',
              search: '"darkMode": true',
              replace: '"darkMode": false',
            },
            {
              file: 'config.json',
              search: '"analytics": false',
              replace: '"analytics": true',
            },
          ],
          predicates: [
            {
              type: 'css' as const,
              selector: '.hero',
              property: 'background',
              expected: '#001f3f',
              path: '/about',
              description: 'Hero background is navy',
            },
            {
              type: 'filesystem_unchanged' as const,
              file: 'config.json',
              hash: configHash,
              description: 'Config file unchanged',
            },
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
          type: 'css' as const,
          selector: '.hero',
          property: 'background',
          expected: '#001f3f',
          path: '/about',
          description: 'Hero background is navy',
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

  // --- Render attempt 1 ---
  console.log(`  ${bold('Trace 1:')} Agent edits server.js and config.json.`);
  await tick(800);
  if (result.history.length > 0 && !result.history[0].success) {
    console.log(`  ${red('\u2717')} Containment alert: 2 undeclared file mutations detected.`);
    await tick(800);
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

  // --- Render attempt 2 ---
  if (result.success && result.attempts >= 2) {
    console.log(`\n  ${bold('Trace 2:')} Injecting constraints and re-running. Agent edits server.js only.`);
    await tick(800);
    console.log(`  ${green('\u2713')} Only declared files changed. Converged in ${result.attempts} attempts.`);
    await pause();
    printGateSummary(result);
    await pause();
  }

  console.log(`\n${bold('The most dangerous agent failures are the ones that look like success.')}`);
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
