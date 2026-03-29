#!/usr/bin/env bun
/**
 * stage-budget-bounds.ts — Budget / Resource Bound Scenario Stager
 *
 * Covers budget predicate failure shapes BUD-01 through BUD-15.
 * Tests cumulative resource consumption against declared bounds.
 * Run: bun scripts/harvest/stage-budget-bounds.ts
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/budget-bounds-staged.json');
const scenarios: any[] = [];
let id = 1;

function push(s: any) {
  scenarios.push({ id: `bud-${String(id++).padStart(3, '0')}`, ...s });
}

// =============================================================================
// BUD-01: Total token budget exceeded
// Patterns: unbounded string concatenation, massive template expansion,
// recursive prompt building without limit
// =============================================================================

push({
  description: 'BUD-01: unbounded while loop concatenating request bodies (budget violation)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
function accumulateAll(stream) {
  let buf = '';
  while (true) { buf += stream.read(); if (buf.length > 1e9) break; }
  return buf;
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'while \\(true\\)', description: 'Unbounded loop should not exist' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'token_cost', 'BUD-01'],
  rationale: 'Unbounded while(true) loop consuming unlimited input is a token budget anti-pattern',
});

push({
  description: 'BUD-01: recursive string expansion without depth limit',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
function expandTemplate(tmpl, data, depth) {
  return tmpl.replace(/\\{\\{(\\w+)\\}\\}/g, (_, k) => expandTemplate(data[k] || '', data, depth));
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'expandTemplate\\(data\\[k\\]', description: 'Recursive expansion without depth guard' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'token_cost', 'BUD-01'],
  rationale: 'Recursive template expansion without depth limit can blow token budgets exponentially',
});

push({
  description: 'BUD-01: bounded accumulation with max size (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const MAX_BODY = 1024 * 1024; // 1MB limit
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > MAX_BODY) { req.destroy(); reject(new Error('Body too large')); } });
    req.on('end', () => resolve(buf));
  });
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'MAX_BODY', description: 'Body size limit constant exists' }],
  expectedSuccess: true,
  tags: ['budget', 'token_cost', 'BUD-01'],
  rationale: 'Bounded body reading with explicit size limit is budget-safe',
});

push({
  description: 'BUD-01: grounding — fabricated claim about token counter',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'tokenBudgetTracker\\.remaining', description: 'Token budget tracker exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['budget', 'token_cost', 'BUD-01'],
  rationale: 'No tokenBudgetTracker exists in demo-app; fabricated predicate fails grounding',
});

// =============================================================================
// BUD-02: Per-model cost exceeded
// Patterns: hardcoded expensive model calls, no cost tracking per provider
// =============================================================================

push({
  description: 'BUD-02: API call with no cost tracking or model selection',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const fetch = require('node-fetch');
async function callAI(prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: prompt }] })
  });
  return res.json();
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "model: 'gpt-4'", description: 'Hardcoded expensive model without cost guard' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'per_model_cost', 'BUD-02'],
  rationale: 'Hardcoded gpt-4 calls with no cost tracking or budget check is a budget violation pattern',
});

push({
  description: 'BUD-02: model call with cost estimation and budget check (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const MODEL_COSTS = { 'gpt-4': 0.03, 'gpt-3.5-turbo': 0.001 };
let spentUsd = 0;
const BUDGET_USD = 10;
function estimateCost(model, tokens) { return (MODEL_COSTS[model] || 0.01) * tokens / 1000; }
function canAfford(model, tokens) { return spentUsd + estimateCost(model, tokens) <= BUDGET_USD; }`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'BUDGET_USD', description: 'Budget limit constant exists' }],
  expectedSuccess: true,
  tags: ['budget', 'per_model_cost', 'BUD-02'],
  rationale: 'Cost estimation with budget check prevents per-model overspend',
});

push({
  description: 'BUD-02: multiple expensive model calls in sequence without aggregate tracking',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function enrichData(items) {
  for (const item of items) {
    await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify({ model: 'claude-3-opus', max_tokens: 4096 }) });
    await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify({ model: 'claude-3-opus', max_tokens: 4096 }) });
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'claude-3-opus.*claude-3-opus', description: 'Multiple expensive model calls without tracking' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'per_model_cost', 'BUD-02'],
  rationale: 'Sequential expensive model calls in a loop with no aggregate cost tracking',
});

push({
  description: 'BUD-02: grounding — fabricated cost tracker module',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'CostTracker\\.perModelSpend', description: 'Per-model cost tracker exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['budget', 'per_model_cost', 'BUD-02'],
  rationale: 'No CostTracker module in demo-app; fabricated predicate fails grounding',
});

// =============================================================================
// BUD-03: Cost projection exceeded before completion
// Patterns: long-running process with no progress check against remaining budget
// =============================================================================

push({
  description: 'BUD-03: batch processing loop with no cost projection',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function processBatch(items) {
  const results = [];
  for (const item of items) {
    const r = await expensiveOperation(item);
    results.push(r);
  }
  return results;
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'for \\(const item of items\\)', description: 'Loop processes items without budget projection check' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'cost_projection', 'BUD-03'],
  rationale: 'Batch loop without checking projected cost before each iteration risks overshoot',
});

push({
  description: 'BUD-03: batch with projected cost check at each step (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function processBatchSafe(items, budget) {
  let spent = 0;
  const costPerItem = 0.05;
  for (const item of items) {
    const projected = spent + costPerItem * (items.length - items.indexOf(item));
    if (projected > budget) { console.log('Budget projection exceeded, stopping early'); break; }
    spent += costPerItem;
    await processItem(item);
  }
  return { spent, stopped: spent < items.length * costPerItem };
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Budget projection exceeded', description: 'Projection-based early stop exists' }],
  expectedSuccess: true,
  tags: ['budget', 'cost_projection', 'BUD-03'],
  rationale: 'Batch processing with projected cost check enables graceful budget-aware stopping',
});

push({
  description: 'BUD-03: grounding — fabricated projection engine',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'projectionEngine\\.forecast', description: 'Cost projection engine exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['budget', 'cost_projection', 'BUD-03'],
  rationale: 'No projectionEngine in demo-app; fabricated predicate fails grounding',
});

// =============================================================================
// BUD-04: Hidden cost from retries/fallbacks
// Patterns: retry without counting cost, silent fallback to expensive provider
// =============================================================================

push({
  description: 'BUD-04: retry loop with no cost accumulation',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function callWithRetry(fn) {
  while (true) {
    try { return await fn(); }
    catch (e) { console.log('Retrying...'); await new Promise(r => setTimeout(r, 1000)); }
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'while \\(true\\).*Retrying', description: 'Unbounded retry without cost tracking' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'hidden_cost', 'BUD-04'],
  rationale: 'Unbounded retry loop accumulates hidden costs with no visibility or limit',
});

push({
  description: 'BUD-04: silent fallback escalation to expensive model',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function callAIWithFallback(prompt) {
  try { return await callModel('gpt-3.5-turbo', prompt); }
  catch { return await callModel('gpt-4', prompt); }
  catch { return await callModel('claude-3-opus', prompt); }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'claude-3-opus.*prompt', description: 'Silent fallback to expensive model' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'hidden_cost', 'BUD-04'],
  rationale: 'Silent fallback chain escalates to most expensive model without operator awareness',
});

push({
  description: 'BUD-04: retry with explicit cost tracking and max attempts (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const MAX_RETRIES = 3;
async function callWithTrackedRetry(fn, costPerCall) {
  let attempts = 0;
  let totalCost = 0;
  while (attempts < MAX_RETRIES) {
    attempts++;
    totalCost += costPerCall;
    try { const r = await fn(); return { result: r, cost: totalCost, attempts }; }
    catch (e) { if (attempts >= MAX_RETRIES) throw new Error(\`Failed after \${attempts} attempts, cost: $\${totalCost}\`); }
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'MAX_RETRIES', description: 'Retry limit constant exists' }],
  expectedSuccess: true,
  tags: ['budget', 'hidden_cost', 'BUD-04'],
  rationale: 'Bounded retries with explicit cost tracking makes hidden costs visible',
});

// =============================================================================
// BUD-05: Cost attribution mismatch
// Patterns: cost billed to wrong app/tenant, shared resource without attribution
// =============================================================================

push({
  description: 'BUD-05: shared API key used across tenants without attribution',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const SHARED_API_KEY = process.env.API_KEY;
async function callForTenant(tenantId, prompt) {
  return fetch('https://api.example.com/v1/complete', {
    headers: { Authorization: SHARED_API_KEY },
    method: 'POST', body: JSON.stringify({ prompt })
  });
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'SHARED_API_KEY', description: 'Shared API key without per-tenant attribution' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'cost_attribution', 'BUD-05'],
  rationale: 'Shared API key across tenants makes cost attribution impossible',
});

push({
  description: 'BUD-05: per-tenant cost tracking with attribution header (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const tenantCosts = new Map();
async function callForTenantTracked(tenantId, prompt, estimatedCost) {
  const current = tenantCosts.get(tenantId) || 0;
  tenantCosts.set(tenantId, current + estimatedCost);
  return fetch('https://api.example.com/v1/complete', {
    headers: { 'X-Tenant-Id': tenantId, 'X-Cost-Center': tenantId },
    method: 'POST', body: JSON.stringify({ prompt })
  });
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'X-Cost-Center', description: 'Per-tenant cost attribution header exists' }],
  expectedSuccess: true,
  tags: ['budget', 'cost_attribution', 'BUD-05'],
  rationale: 'Per-tenant cost tracking and attribution headers enable proper cost allocation',
});

push({
  description: 'BUD-05: grounding — fabricated attribution ledger',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'attributionLedger\\.charge', description: 'Attribution ledger exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['budget', 'cost_attribution', 'BUD-05'],
  rationale: 'No attributionLedger in demo-app; fabricated predicate fails grounding',
});

// =============================================================================
// BUD-06: Total API calls exceeded
// Patterns: loop calling external API with no call counter, fan-out without limit
// =============================================================================

push({
  description: 'BUD-06: N+1 API call pattern in loop',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function loadUserDetails(users) {
  const details = [];
  for (const user of users) {
    const res = await fetch(\`https://api.example.com/users/\${user.id}\`);
    const profile = await fetch(\`https://api.example.com/users/\${user.id}/profile\`);
    details.push({ ...await res.json(), profile: await profile.json() });
  }
  return details;
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'for \\(const user of users\\).*fetch', description: 'N+1 API call pattern in loop' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'api_calls', 'BUD-06'],
  rationale: 'N+1 API pattern: 2 calls per user, unbounded by user count',
});

push({
  description: 'BUD-06: unbounded fan-out to external services',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function notifyAll(subscribers, message) {
  return Promise.all(subscribers.map(s =>
    fetch(s.webhookUrl, { method: 'POST', body: JSON.stringify({ message }) })
  ));
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Promise\\.all\\(subscribers\\.map', description: 'Unbounded fan-out to webhook subscribers' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'api_calls', 'BUD-06'],
  rationale: 'Promise.all on unbounded subscriber list has no call count limit',
});

push({
  description: 'BUD-06: batch API call with concurrency limit (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const MAX_CONCURRENT = 5;
const MAX_TOTAL_CALLS = 100;
async function batchFetch(urls) {
  if (urls.length > MAX_TOTAL_CALLS) throw new Error(\`Too many URLs: \${urls.length} > \${MAX_TOTAL_CALLS}\`);
  const results = [];
  for (let i = 0; i < urls.length; i += MAX_CONCURRENT) {
    const batch = urls.slice(i, i + MAX_CONCURRENT);
    results.push(...await Promise.all(batch.map(u => fetch(u))));
  }
  return results;
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'MAX_TOTAL_CALLS', description: 'Total call limit constant exists' }],
  expectedSuccess: true,
  tags: ['budget', 'api_calls', 'BUD-06'],
  rationale: 'Batch fetching with concurrency and total call limits is budget-safe',
});

push({
  description: 'BUD-06: grounding — fabricated API call counter',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'apiCallBudget\\.remaining', description: 'API call budget tracker exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['budget', 'api_calls', 'BUD-06'],
  rationale: 'No apiCallBudget in demo-app; fabricated predicate fails grounding',
});

// =============================================================================
// BUD-07: Redundant calls (same info fetched multiple times)
// =============================================================================

push({
  description: 'BUD-07: same endpoint called in every request handler',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function handleRequest(req) {
  const config = await fetch('https://api.example.com/config').then(r => r.json());
  const user = await fetch('https://api.example.com/config').then(r => r.json());
  const settings = await fetch('https://api.example.com/config').then(r => r.json());
  return { config, user, settings };
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "api\\.example\\.com/config.*api\\.example\\.com/config", description: 'Same endpoint fetched multiple times' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'redundant_calls', 'BUD-07'],
  rationale: 'Same config endpoint fetched 3 times in one handler wastes API budget',
});

push({
  description: 'BUD-07: result cached with TTL to prevent redundant calls (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const cache = new Map();
const CACHE_TTL = 60000;
async function fetchCached(url) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  const data = await fetch(url).then(r => r.json());
  cache.set(url, { data, ts: Date.now() });
  return data;
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'CACHE_TTL', description: 'TTL-based cache prevents redundant calls' }],
  expectedSuccess: true,
  tags: ['budget', 'redundant_calls', 'BUD-07'],
  rationale: 'Caching with TTL prevents redundant identical API calls',
});

push({
  description: 'BUD-07: repeated database query inside loop',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function renderPage(items) {
  for (const item of items) {
    const settings = await db.query('SELECT * FROM settings WHERE active = true');
    item.formatted = formatWith(item, settings.rows);
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "for \\(const item.*db\\.query\\('SELECT \\* FROM settings", description: 'Repeated query inside loop' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'redundant_calls', 'BUD-07'],
  rationale: 'Same settings query repeated per loop iteration is an N+1 anti-pattern',
});

// =============================================================================
// BUD-08: Cascading calls (one action triggers unbounded downstream)
// =============================================================================

push({
  description: 'BUD-08: recursive webhook triggering',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function onEvent(event) {
  const hooks = await getWebhooks(event.type);
  for (const hook of hooks) {
    await fetch(hook.url, { method: 'POST', body: JSON.stringify(event) });
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'onEvent.*getWebhooks.*fetch\\(hook\\.url', description: 'Event handler triggers unbounded webhook cascade' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'cascading_calls', 'BUD-08'],
  rationale: 'Event handler triggers webhooks which could trigger more events, creating unbounded cascade',
});

push({
  description: 'BUD-08: cascade with depth guard and fan-out limit (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const MAX_CASCADE_DEPTH = 3;
const MAX_FANOUT = 10;
async function onEventSafe(event, depth = 0) {
  if (depth >= MAX_CASCADE_DEPTH) { console.log('Cascade depth limit reached'); return; }
  const hooks = await getWebhooks(event.type);
  const limited = hooks.slice(0, MAX_FANOUT);
  for (const hook of limited) {
    await fetch(hook.url, { method: 'POST', body: JSON.stringify({ ...event, _depth: depth + 1 }) });
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'MAX_CASCADE_DEPTH', description: 'Cascade depth limiter exists' }],
  expectedSuccess: true,
  tags: ['budget', 'cascading_calls', 'BUD-08'],
  rationale: 'Depth guard and fan-out limit prevent unbounded cascading calls',
});

push({
  description: 'BUD-08: message queue consumer that re-enqueues on failure without limit',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function processQueue(queue) {
  while (queue.length > 0) {
    const msg = queue.shift();
    try { await processMessage(msg); }
    catch (e) { queue.push(msg); }
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'catch.*queue\\.push\\(msg\\)', description: 'Failed messages re-enqueued without limit' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'cascading_calls', 'BUD-08'],
  rationale: 'Re-enqueue on failure creates infinite cascade if message always fails',
});

// =============================================================================
// BUD-09: Polling loop budget
// =============================================================================

push({
  description: 'BUD-09: polling loop without timeout or max iterations',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function waitForReady(url) {
  while (true) {
    const res = await fetch(url);
    if (res.status === 200) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'while \\(true\\).*fetch\\(url\\)', description: 'Polling loop without timeout' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'polling_budget', 'BUD-09'],
  rationale: 'Infinite polling loop with no timeout or max attempts consumes unlimited API calls',
});

push({
  description: 'BUD-09: polling with exponential backoff and max attempts (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const MAX_POLL_ATTEMPTS = 30;
async function waitForReadySafe(url) {
  let delay = 1000;
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const res = await fetch(url);
    if (res.status === 200) return true;
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 30000);
  }
  throw new Error(\`Not ready after \${MAX_POLL_ATTEMPTS} attempts\`);
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'MAX_POLL_ATTEMPTS', description: 'Poll attempt limit constant exists' }],
  expectedSuccess: true,
  tags: ['budget', 'polling_budget', 'BUD-09'],
  rationale: 'Bounded polling with exponential backoff conserves API call budget',
});

push({
  description: 'BUD-09: setInterval polling that never clears',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
function startMonitoring(url) {
  setInterval(async () => {
    const res = await fetch(url);
    console.log('Status:', res.status);
  }, 5000);
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'setInterval.*fetch', description: 'setInterval polling never cleared' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'polling_budget', 'BUD-09'],
  rationale: 'setInterval without clearInterval runs forever, consuming unbounded API calls',
});

push({
  description: 'BUD-09: grounding — fabricated polling budget manager',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'pollingBudget\\.consume', description: 'Polling budget manager exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['budget', 'polling_budget', 'BUD-09'],
  rationale: 'No pollingBudget in demo-app; fabricated predicate fails grounding',
});

// =============================================================================
// BUD-10: Wall-clock time exceeded
// =============================================================================

push({
  description: 'BUD-10: synchronous sleep in request handler',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
function heavyComputation(n) {
  const start = Date.now();
  while (Date.now() - start < n) { Math.random(); }
  return 'done';
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'while \\(Date\\.now\\(\\) - start < n\\)', description: 'Busy-wait loop blocks event loop' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'wall_clock', 'BUD-10'],
  rationale: 'Synchronous busy-wait consumes wall-clock time and blocks the entire event loop',
});

push({
  description: 'BUD-10: long-running computation without timeout',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'fibonacci\\(n - 1\\) \\+ fibonacci\\(n - 2\\)', description: 'Exponential recursion without memoization or limit' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'wall_clock', 'BUD-10'],
  rationale: 'Naive recursive fibonacci is O(2^n), will exceed any wall-clock budget for large n',
});

push({
  description: 'BUD-10: operation with AbortController timeout (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const OPERATION_TIMEOUT = 30000;
async function timedOperation(fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPERATION_TIMEOUT);
  try { return await fn(controller.signal); }
  finally { clearTimeout(timer); }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'OPERATION_TIMEOUT', description: 'Operation timeout constant exists' }],
  expectedSuccess: true,
  tags: ['budget', 'wall_clock', 'BUD-10'],
  rationale: 'AbortController with timeout ensures wall-clock budget is enforced',
});

push({
  description: 'BUD-10: eval of user input can run indefinitely',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
function executeUserCode(code) {
  return eval(code);
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'eval\\(code\\)', description: 'eval of user code can run forever' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'wall_clock', 'BUD-10'],
  rationale: 'eval of user input has no time bound; can execute arbitrary infinite loops',
});

// =============================================================================
// BUD-11: Idle time dominance
// =============================================================================

push({
  description: 'BUD-11: sequential awaits with no parallelization',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function loadDashboard() {
  const users = await fetch('https://api.example.com/users').then(r => r.json());
  const orders = await fetch('https://api.example.com/orders').then(r => r.json());
  const products = await fetch('https://api.example.com/products').then(r => r.json());
  const analytics = await fetch('https://api.example.com/analytics').then(r => r.json());
  const notifications = await fetch('https://api.example.com/notifications').then(r => r.json());
  return { users, orders, products, analytics, notifications };
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'await fetch.*await fetch.*await fetch', description: 'Sequential awaits waste idle time' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'idle_time', 'BUD-11'],
  rationale: '5 sequential await calls waste 4x idle time vs parallel Promise.all',
});

push({
  description: 'BUD-11: parallel fetching with Promise.all (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function loadDashboardFast() {
  const [users, orders, products] = await Promise.all([
    fetch('https://api.example.com/users').then(r => r.json()),
    fetch('https://api.example.com/orders').then(r => r.json()),
    fetch('https://api.example.com/products').then(r => r.json()),
  ]);
  return { users, orders, products };
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Promise\\.all', description: 'Parallel fetching reduces idle time' }],
  expectedSuccess: true,
  tags: ['budget', 'idle_time', 'BUD-11'],
  rationale: 'Promise.all eliminates idle time waste from sequential independent fetches',
});

push({
  description: 'BUD-11: sleep-based synchronization instead of event-driven',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function waitForData(key) {
  while (!globalStore[key]) {
    await new Promise(r => setTimeout(r, 500));
  }
  return globalStore[key];
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'while \\(!globalStore.*setTimeout', description: 'Sleep-based polling instead of event-driven' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'idle_time', 'BUD-11'],
  rationale: 'Sleep-based polling wastes wall-clock budget; should use event emitter or pub/sub',
});

// =============================================================================
// BUD-12: Time budget consumed by retries
// =============================================================================

push({
  description: 'BUD-12: retry with fixed delay consuming majority of timeout',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function fetchWithRetry(url, retries = 10) {
  for (let i = 0; i < retries; i++) {
    try { return await fetch(url); }
    catch (e) { await new Promise(r => setTimeout(r, 5000)); }
  }
  throw new Error('All retries exhausted');
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'setTimeout\\(r, 5000\\)', description: 'Fixed 5s delay between retries (50s total for 10 retries)' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'retry_time', 'BUD-12'],
  rationale: '10 retries * 5s delay = 50s consumed just in retry delays',
});

push({
  description: 'BUD-12: retry with same failing parameters (no jitter, no change)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function retryIdentical(fn, maxRetries = 20) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 3000)); }
  }
  throw lastErr;
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'maxRetries = 20', description: '20 retries with 3s each = 60s wasted on identical failure' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'retry_time', 'BUD-12'],
  rationale: 'Retrying the same operation 20 times with no variation wastes 60s of time budget',
});

push({
  description: 'BUD-12: adaptive retry with deadline-awareness (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function retryWithDeadline(fn, deadlineMs = 10000) {
  const deadline = Date.now() + deadlineMs;
  let delay = 100;
  let attempts = 0;
  while (Date.now() + delay < deadline) {
    attempts++;
    try { return await fn(); }
    catch (e) { await new Promise(r => setTimeout(r, delay)); delay = Math.min(delay * 2, 5000); }
  }
  throw new Error(\`Deadline exceeded after \${attempts} attempts\`);
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'deadlineMs', description: 'Deadline-aware retry respects time budget' }],
  expectedSuccess: true,
  tags: ['budget', 'retry_time', 'BUD-12'],
  rationale: 'Deadline-aware retry with exponential backoff respects overall time budget',
});

// =============================================================================
// BUD-13: Max iterations exceeded
// =============================================================================

push({
  description: 'BUD-13: recursive function without base case limit',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
function processTree(node) {
  if (!node) return;
  process(node.value);
  node.children.forEach(c => processTree(c));
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'processTree\\(c\\)', description: 'Recursive tree traversal without depth limit' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'max_iterations', 'BUD-13'],
  rationale: 'Unbounded recursive tree traversal can blow stack and exceed iteration budget',
});

push({
  description: 'BUD-13: generator that yields indefinitely',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
function* infiniteStream() {
  let i = 0;
  while (true) { yield i++; }
}
function consumeAll(gen) {
  const results = [];
  for (const val of gen) { results.push(val); }
  return results;
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'while \\(true\\).*yield', description: 'Infinite generator consumed without limit' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'max_iterations', 'BUD-13'],
  rationale: 'consumeAll on infinite generator creates infinite iteration',
});

push({
  description: 'BUD-13: iteration with explicit counter and max (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const MAX_ITERATIONS = 10000;
function processWithLimit(items) {
  let count = 0;
  for (const item of items) {
    if (++count > MAX_ITERATIONS) throw new Error(\`Iteration limit exceeded: \${MAX_ITERATIONS}\`);
    transform(item);
  }
  return count;
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'MAX_ITERATIONS', description: 'Iteration limit constant exists' }],
  expectedSuccess: true,
  tags: ['budget', 'max_iterations', 'BUD-13'],
  rationale: 'Explicit iteration counter with hard limit prevents budget overrun',
});

push({
  description: 'BUD-13: depth-limited tree traversal (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const MAX_DEPTH = 20;
function processTreeSafe(node, depth = 0) {
  if (!node || depth > MAX_DEPTH) return;
  process(node.value);
  node.children.forEach(c => processTreeSafe(c, depth + 1));
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'MAX_DEPTH', description: 'Recursion depth limit exists' }],
  expectedSuccess: true,
  tags: ['budget', 'max_iterations', 'BUD-13'],
  rationale: 'Depth parameter with MAX_DEPTH guard prevents unbounded recursion',
});

push({
  description: 'BUD-13: grounding — fabricated iteration budget tracker',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'iterationBudget\\.check', description: 'Iteration budget tracker exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['budget', 'max_iterations', 'BUD-13'],
  rationale: 'No iterationBudget in demo-app; fabricated predicate fails grounding',
});

// =============================================================================
// BUD-14: Retry budget consumed by same failure class
// =============================================================================

push({
  description: 'BUD-14: retrying on connection error without changing strategy',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function connectWithRetry(host, port) {
  for (let i = 0; i < 100; i++) {
    try { return await connect(host, port); }
    catch (e) { console.log(\`Connection failed (attempt \${i})\`); await sleep(1000); }
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'i < 100.*Connection failed', description: '100 retries for same connection error' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'retry_same_failure', 'BUD-14'],
  rationale: '100 retries on same connection error without strategy change wastes entire retry budget',
});

push({
  description: 'BUD-14: retry without classifying error type',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function submitForm(data) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { return await postToAPI(data); }
    catch (e) { await new Promise(r => setTimeout(r, 2000)); }
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'attempt < 50.*catch \\(e\\)', description: 'Retry without error classification' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'retry_same_failure', 'BUD-14'],
  rationale: 'Generic catch without classifying 4xx vs 5xx wastes retries on non-retryable errors',
});

push({
  description: 'BUD-14: error-classified retry with per-class limits (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const RETRY_LIMITS = { 'ECONNREFUSED': 3, 'ETIMEOUT': 5, 'HTTP_429': 3, 'HTTP_500': 2 };
async function smartRetry(fn) {
  const errorCounts = {};
  for (let i = 0; i < 10; i++) {
    try { return await fn(); }
    catch (e) {
      const cls = classifyError(e);
      errorCounts[cls] = (errorCounts[cls] || 0) + 1;
      if (errorCounts[cls] >= (RETRY_LIMITS[cls] || 1)) throw new Error(\`Retry budget for \${cls} exhausted\`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'RETRY_LIMITS', description: 'Per-error-class retry limits exist' }],
  expectedSuccess: true,
  tags: ['budget', 'retry_same_failure', 'BUD-14'],
  rationale: 'Per-error-class retry limits prevent one failure class from consuming entire budget',
});

push({
  description: 'BUD-14: retry that keeps hitting 401 without checking auth',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function fetchProtected(url, token) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(url, { headers: { Authorization: token } });
    if (res.ok) return res.json();
    await new Promise(r => setTimeout(r, 2000));
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'i < 30.*Authorization.*res\\.ok', description: '30 retries ignoring 401 status' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'retry_same_failure', 'BUD-14'],
  rationale: 'Retrying 401 responses 30 times wastes budget; auth errors are not transient',
});

// =============================================================================
// BUD-15: Compound budget (multiple dimensions near limit)
// =============================================================================

push({
  description: 'BUD-15: expensive model in unbounded retry with no timeout',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function analyze(data) {
  while (true) {
    try {
      return await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: JSON.stringify(data) }] })
      });
    } catch (e) { await new Promise(r => setTimeout(r, 1000)); }
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "while \\(true\\).*gpt-4", description: 'Unbounded retry of expensive model call' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'compound_budget', 'BUD-15'],
  rationale: 'Compound violation: token cost (gpt-4) + API calls (unbounded) + time (no timeout)',
});

push({
  description: 'BUD-15: N+1 queries inside polling loop',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function syncAll() {
  while (true) {
    const items = await db.query('SELECT * FROM items');
    for (const item of items.rows) {
      await fetch(\`https://api.example.com/sync/\${item.id}\`, { method: 'POST' });
    }
    await new Promise(r => setTimeout(r, 10000));
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'while \\(true\\).*SELECT \\* FROM items.*fetch', description: 'N+1 API calls inside infinite polling loop' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'compound_budget', 'BUD-15'],
  rationale: 'Compound: iterations (infinite poll) + API calls (N per iteration) + time (forever)',
});

push({
  description: 'BUD-15: circuit breaker with all dimensions bounded (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
class CircuitBreaker {
  constructor(maxCalls = 100, maxCostUsd = 5, timeoutMs = 60000, maxRetries = 3) {
    this.maxCalls = maxCalls; this.maxCostUsd = maxCostUsd;
    this.timeoutMs = timeoutMs; this.maxRetries = maxRetries;
    this.calls = 0; this.costUsd = 0; this.state = 'closed';
  }
  canProceed() {
    return this.state === 'closed' && this.calls < this.maxCalls && this.costUsd < this.maxCostUsd;
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'CircuitBreaker', description: 'Circuit breaker guards all budget dimensions' }],
  expectedSuccess: true,
  tags: ['budget', 'compound_budget', 'BUD-15'],
  rationale: 'Circuit breaker pattern bounds calls, cost, time, and retries simultaneously',
});

push({
  description: 'BUD-15: grounding — fabricated compound budget manager',
  edits: [],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'CompoundBudgetManager\\.checkAll', description: 'Compound budget manager exists' }],
  expectedSuccess: false,
  expectedFailedGate: 'grounding',
  tags: ['budget', 'compound_budget', 'BUD-15'],
  rationale: 'No CompoundBudgetManager in demo-app; fabricated predicate fails grounding',
});

// =============================================================================
// Performance predicate scenarios — resource waste detection
// =============================================================================

push({
  description: 'BUD-10/perf: response time threshold for heavy computation endpoint',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
function heavySync() { for (let i = 0; i < 1e8; i++) Math.sqrt(i); return 'done'; }`,
  }],
  predicates: [{ type: 'performance', perfCheck: 'response_time', threshold: 100 }],
  expectedSuccess: false,
  tags: ['budget', 'wall_clock', 'BUD-10'],
  rationale: 'Heavy synchronous computation will exceed 100ms response time threshold',
});

push({
  description: 'BUD-10/perf: demo-app health endpoint should be fast',
  edits: [],
  predicates: [{ type: 'performance', perfCheck: 'response_time', threshold: 5000 }],
  expectedSuccess: true,
  tags: ['budget', 'wall_clock', 'BUD-10'],
  rationale: 'Static demo-app responses are fast, well under 5s threshold',
});

push({
  description: 'BUD-06/perf: large unoptimized image wastes bandwidth budget',
  edits: [],
  predicates: [{ type: 'performance', perfCheck: 'image_optimization' }],
  expectedSuccess: true,
  tags: ['budget', 'api_calls', 'BUD-06'],
  rationale: 'Demo-app has no actual image files to check; passes by absence',
});

// =============================================================================
// HTTP predicate scenarios — rate limiting detection
// =============================================================================

push({
  description: 'BUD-09/http: health endpoint responds 200 (not rate limited)',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/health',
    expect: { status: 200 },
  }],
  expectedSuccess: true,
  tags: ['budget', 'polling_budget', 'BUD-09'],
  rationale: 'Health endpoint should respond 200 when not under excessive load',
});

push({
  description: 'BUD-06/http: API endpoint responds to single call',
  edits: [],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/api/items',
    expect: { status: 200, bodyContains: 'Alpha' },
  }],
  expectedSuccess: true,
  tags: ['budget', 'api_calls', 'BUD-06'],
  rationale: 'Single API call within budget returns expected data',
});

push({
  description: 'BUD-09/http: rate limiter returns 429 when implemented',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/health') {",
    replace: `if (req.url === '/rate-test') {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'Too Many Requests', retryAfter: 60 }));
    return;
  }

  if (req.url === '/health') {`,
  }],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/rate-test',
    expect: { status: 429, bodyContains: 'Too Many Requests' },
  }],
  expectedSuccess: true,
  tags: ['budget', 'polling_budget', 'BUD-09'],
  rationale: 'Rate limiter endpoint correctly returns 429 with Retry-After header',
});

push({
  description: 'BUD-09/http: rate limiter with proper headers (safe pattern)',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/health') {",
    replace: `if (req.url === '/limited') {
    const remaining = 10;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600)
    });
    res.end(JSON.stringify({ data: 'ok', rateLimit: { remaining } }));
    return;
  }

  if (req.url === '/health') {`,
  }],
  predicates: [{
    type: 'http',
    method: 'GET',
    path: '/limited',
    expect: { status: 200, bodyContains: 'rateLimit' },
  }],
  expectedSuccess: true,
  tags: ['budget', 'polling_budget', 'BUD-09'],
  rationale: 'Endpoint exposes rate limit headers allowing callers to self-throttle',
});

// =============================================================================
// Additional BUD-01 through BUD-05 edge cases
// =============================================================================

push({
  description: 'BUD-01: string builder in hot path with no size cap',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
function buildReport(entries) {
  let report = '';
  for (const e of entries) {
    report += JSON.stringify(e) + '\\n';
  }
  return report;
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "report \\+= JSON\\.stringify", description: 'Unbounded string concatenation in loop' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'token_cost', 'BUD-01'],
  rationale: 'String concatenation in loop with no size check can produce multi-GB strings',
});

push({
  description: 'BUD-02: model selection defaults to most expensive',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
function selectModel(task) {
  return 'claude-3-opus';
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "return 'claude-3-opus'", description: 'Always selects most expensive model' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'per_model_cost', 'BUD-02'],
  rationale: 'Hardcoded selection of most expensive model regardless of task complexity',
});

push({
  description: 'BUD-03: map/reduce over unbounded collection without sampling',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function analyzeAll(collection) {
  return Promise.all(collection.map(item => callExpensiveAPI(item)));
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Promise\\.all\\(collection\\.map.*callExpensiveAPI', description: 'Unbounded parallel expensive calls' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'cost_projection', 'BUD-03'],
  rationale: 'Promise.all on unbounded collection with expensive per-item API calls has no cost projection',
});

push({
  description: 'BUD-04: fallback chain with no cost tracking between steps',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function resilientCall(prompt) {
  const providers = ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo', 'claude-3-opus'];
  for (const model of providers) {
    try { return await callModel(model, prompt); }
    catch (e) { continue; }
  }
  throw new Error('All providers failed');
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "gpt-3\\.5-turbo.*gpt-4.*claude-3-opus", description: 'Escalating fallback without cost tracking' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'hidden_cost', 'BUD-04'],
  rationale: 'Each fallback step is more expensive; total cost hidden from caller',
});

push({
  description: 'BUD-05: global API key with no per-request attribution',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const API_KEY = process.env.OPENAI_KEY;
async function callOpenAI(messages) {
  return fetch('https://api.openai.com/v1/chat/completions', {
    headers: { Authorization: \`Bearer \${API_KEY}\` },
    method: 'POST', body: JSON.stringify({ model: 'gpt-4', messages })
  });
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'Bearer.*API_KEY', description: 'Single API key without per-request attribution' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'cost_attribution', 'BUD-05'],
  rationale: 'Single global API key makes per-request cost attribution impossible',
});

// =============================================================================
// Additional BUD-06 through BUD-09 edge cases
// =============================================================================

push({
  description: 'BUD-06: GraphQL query with no depth/complexity limit',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function executeGraphQL(query) {
  return fetch('https://api.example.com/graphql', {
    method: 'POST', body: JSON.stringify({ query })
  });
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'executeGraphQL.*query\\)', description: 'GraphQL execution with no complexity limit' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'api_calls', 'BUD-06'],
  rationale: 'Nested GraphQL queries can cause exponential backend API calls with no depth limit',
});

push({
  description: 'BUD-07: config fetched on every request instead of startup',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function handleEveryRequest(req, res) {
  const config = await fetch('https://config.example.com/app.json').then(r => r.json());
  const features = await fetch('https://config.example.com/features.json').then(r => r.json());
  return { config, features };
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'handleEveryRequest.*config\\.example\\.com', description: 'Config fetched on every request' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'redundant_calls', 'BUD-07'],
  rationale: 'Fetching config on every request instead of once at startup wastes API budget',
});

push({
  description: 'BUD-08: webhook that triggers itself',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function handleWebhook(event) {
  await processEvent(event);
  await fetch('http://localhost:3000/webhook', {
    method: 'POST', body: JSON.stringify({ type: 'processed', source: event.id })
  });
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "localhost:3000/webhook.*POST", description: 'Webhook calls back to itself' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'cascading_calls', 'BUD-08'],
  rationale: 'Webhook handler posting to its own endpoint creates infinite cascade',
});

push({
  description: 'BUD-09: long-polling with no keepalive timeout',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
function longPoll(url, callback) {
  async function poll() {
    const res = await fetch(url);
    callback(await res.json());
    poll();
  }
  poll();
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'function poll\\(\\).*poll\\(\\)', description: 'Recursive long-poll without timeout' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'polling_budget', 'BUD-09'],
  rationale: 'Recursive long-polling without delay or timeout exhausts call stack and API budget',
});

// =============================================================================
// Additional BUD-10 through BUD-12 edge cases
// =============================================================================

push({
  description: 'BUD-10: RegExp backtracking on user input',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
function validateEmail(input) {
  return /^([a-zA-Z0-9]+\\.)*[a-zA-Z0-9]+@([a-zA-Z0-9]+\\.)*[a-zA-Z0-9]+$/.test(input);
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: '\\([a-zA-Z0-9\\]\\+\\\\\\.\\)\\*', description: 'Catastrophic backtracking regex on user input' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'wall_clock', 'BUD-10'],
  rationale: 'Nested quantifiers in regex cause exponential backtracking on crafted input',
});

push({
  description: 'BUD-11: database query waiting on lock instead of timeout',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function updateWithLock(id, data) {
  await db.query('SELECT * FROM items WHERE id = $1 FOR UPDATE', [id]);
  await db.query('UPDATE items SET data = $1 WHERE id = $2', [data, id]);
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'FOR UPDATE', description: 'SELECT FOR UPDATE without statement timeout' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'idle_time', 'BUD-11'],
  rationale: 'FOR UPDATE lock wait can idle indefinitely if another transaction holds the lock',
});

push({
  description: 'BUD-11: connection pool exhaustion from leaked connections',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function leakyQuery(sql) {
  const client = await pool.connect();
  const result = await client.query(sql);
  return result.rows;
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'pool\\.connect\\(\\).*return result\\.rows', description: 'Database connection never released' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'idle_time', 'BUD-11'],
  rationale: 'Connection acquired but never released; pool exhausts, all subsequent queries idle waiting',
});

push({
  description: 'BUD-12: retries with linear backoff consuming 80% of deadline',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function retryLinear(fn) {
  for (let i = 1; i <= 10; i++) {
    try { return await fn(); }
    catch (e) { await new Promise(r => setTimeout(r, i * 3000)); }
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'i \\* 3000', description: 'Linear backoff: sum(3k..30k) = 165s total delay' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'retry_time', 'BUD-12'],
  rationale: 'Linear backoff (3s, 6s, ..., 30s) totals 165s of delay time across retries',
});

// =============================================================================
// Additional BUD-13 through BUD-15 edge cases
// =============================================================================

push({
  description: 'BUD-13: recursive JSON traversal on user-supplied data',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
function deepClone(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  const clone = Array.isArray(obj) ? [] : {};
  for (const key in obj) clone[key] = deepClone(obj[key]);
  return clone;
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'deepClone\\(obj\\[key\\]\\)', description: 'Recursive clone on untrusted input without depth limit' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'max_iterations', 'BUD-13'],
  rationale: 'Recursive deep clone on user JSON with circular refs or extreme depth blows stack',
});

push({
  description: 'BUD-13: pagination loop without max page guard',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function fetchAllPages(url) {
  let page = 1;
  const all = [];
  while (true) {
    const res = await fetch(\`\${url}?page=\${page}\`);
    const data = await res.json();
    if (data.items.length === 0) break;
    all.push(...data.items);
    page++;
  }
  return all;
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'while \\(true\\).*page\\+\\+', description: 'Pagination loop without max page guard' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'max_iterations', 'BUD-13'],
  rationale: 'Pagination loop depends on API returning empty; misbehaving API causes infinite iteration',
});

push({
  description: 'BUD-14: retry same malformed request body',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function persistData(data) {
  for (let i = 0; i < 15; i++) {
    const res = await fetch('https://api.example.com/data', {
      method: 'POST', body: JSON.stringify(data)
    });
    if (res.status === 400) { await new Promise(r => setTimeout(r, 2000)); continue; }
    return res.json();
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'status === 400.*continue', description: 'Retrying 400 responses (client error, not transient)' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'retry_same_failure', 'BUD-14'],
  rationale: '400 is a client error; retrying the same malformed request 15 times wastes budget',
});

push({
  description: 'BUD-15: streaming endpoint with no backpressure and no timeout',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function consumeStream(url) {
  const res = await fetch(url);
  const reader = res.body.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'while \\(true\\).*reader\\.read', description: 'Stream consumed without size limit or timeout' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'compound_budget', 'BUD-15'],
  rationale: 'Compound: time (no timeout) + memory (no size limit) + bandwidth (no backpressure)',
});

push({
  description: 'BUD-15: all budget guards in place (safe comprehensive)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const BUDGET = { maxCalls: 50, maxCostUsd: 2, timeoutMs: 30000, maxRetries: 3, maxIterations: 1000 };
class BudgetGuard {
  constructor(budget) { Object.assign(this, budget); this.calls = 0; this.cost = 0; this.start = Date.now(); }
  check() {
    if (this.calls >= this.maxCalls) throw new Error('Call budget exceeded');
    if (this.cost >= this.maxCostUsd) throw new Error('Cost budget exceeded');
    if (Date.now() - this.start > this.timeoutMs) throw new Error('Time budget exceeded');
  }
  record(cost) { this.calls++; this.cost += cost; this.check(); }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'BudgetGuard', description: 'Comprehensive budget guard class exists' }],
  expectedSuccess: true,
  tags: ['budget', 'compound_budget', 'BUD-15'],
  rationale: 'BudgetGuard tracks calls, cost, and time with explicit limits and check-before-proceed',
});

// =============================================================================
// Security predicate overlap — budget-relevant security patterns
// =============================================================================

push({
  description: 'BUD-10/security: eval used for dynamic code execution (cost amplification)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
function runUserScript(code) {
  return new Function('return ' + code)();
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "new Function\\('return '", description: 'Dynamic code execution via Function constructor' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'wall_clock', 'BUD-10'],
  rationale: 'new Function() from user input enables arbitrary computation with no time bound',
});

push({
  description: 'BUD-08/security: user-controlled redirect chain',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function followRedirects(url) {
  let current = url;
  while (true) {
    const res = await fetch(current, { redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    current = res.headers.get('location');
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: "while \\(true\\).*headers\\.get\\('location'\\)", description: 'Unbounded redirect following' }],
  expectedSuccess: false,
  expectedFailedGate: 'content',
  tags: ['budget', 'cascading_calls', 'BUD-08'],
  rationale: 'Following redirects without limit enables infinite redirect loops consuming API budget',
});

// =============================================================================
// HTTP sequence scenarios — budget-aware API flow testing
// =============================================================================

push({
  description: 'BUD-06/http_seq: create + verify round-trip stays within budget',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/health') {",
    replace: `if (req.url === '/api/budget-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ calls: 1, limit: 100, remaining: 99 }));
    return;
  }

  if (req.url === '/health') {`,
  }],
  predicates: [{
    type: 'http_sequence',
    steps: [
      { method: 'GET', path: '/api/budget-status', expect: { status: 200, bodyContains: 'remaining' } },
      { method: 'GET', path: '/health', expect: { status: 200 } },
    ],
  }],
  expectedSuccess: true,
  tags: ['budget', 'api_calls', 'BUD-06'],
  rationale: 'Two-step sequence verifies budget tracking endpoint exists and health is accessible',
});

push({
  description: 'BUD-09/http_seq: rate limit then retry-after flow',
  edits: [{
    file: 'server.js',
    search: "if (req.url === '/health') {",
    replace: `if (req.url === '/api/throttled') {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
    res.end(JSON.stringify({ error: 'rate_limited', retryAfter: 5 }));
    return;
  }

  if (req.url === '/health') {`,
  }],
  predicates: [{
    type: 'http_sequence',
    steps: [
      { method: 'GET', path: '/api/throttled', expect: { status: 429, bodyContains: 'rate_limited' } },
      { method: 'GET', path: '/health', expect: { status: 200 } },
    ],
  }],
  expectedSuccess: true,
  tags: ['budget', 'polling_budget', 'BUD-09'],
  rationale: 'Verifies rate limit response is properly returned and fallback endpoint works',
});

// =============================================================================
// Additional safe pattern scenarios
// =============================================================================

push({
  description: 'BUD-04: tracked fallback with cost visibility (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const FALLBACK_COSTS = { 'gpt-3.5-turbo': 0.001, 'gpt-4': 0.03 };
async function trackedFallback(prompt) {
  let totalCost = 0;
  for (const [model, cost] of Object.entries(FALLBACK_COSTS)) {
    totalCost += cost;
    console.log(\`Trying \${model}, cumulative cost: $\${totalCost}\`);
    try { return { result: await callModel(model, prompt), totalCost }; }
    catch { continue; }
  }
  return { result: null, totalCost };
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'FALLBACK_COSTS', description: 'Fallback chain with cost tracking' }],
  expectedSuccess: true,
  tags: ['budget', 'hidden_cost', 'BUD-04'],
  rationale: 'Fallback chain that logs cumulative cost at each step provides full cost visibility',
});

push({
  description: 'BUD-07: startup-cached config with refresh interval (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
let cachedConfig = null;
let configLastFetched = 0;
const CONFIG_REFRESH_MS = 300000;
async function getConfig() {
  if (cachedConfig && Date.now() - configLastFetched < CONFIG_REFRESH_MS) return cachedConfig;
  cachedConfig = await fetch('https://config.example.com/app.json').then(r => r.json());
  configLastFetched = Date.now();
  return cachedConfig;
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'CONFIG_REFRESH_MS', description: 'Config refresh interval prevents redundant calls' }],
  expectedSuccess: true,
  tags: ['budget', 'redundant_calls', 'BUD-07'],
  rationale: 'Config cached with TTL-based refresh eliminates per-request redundant fetches',
});

push({
  description: 'BUD-08: event handler with idempotency key preventing loops (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const processedEvents = new Set();
async function handleEventSafe(event) {
  if (processedEvents.has(event.id)) return;
  processedEvents.add(event.id);
  await processEvent(event);
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'processedEvents\\.has', description: 'Idempotency guard prevents cascade loops' }],
  expectedSuccess: true,
  tags: ['budget', 'cascading_calls', 'BUD-08'],
  rationale: 'Idempotency key set prevents the same event from being processed twice, breaking loops',
});

push({
  description: 'BUD-11: connection released in finally block (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
async function safeQuery(sql, params) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'client\\.release\\(\\)', description: 'Connection released in finally block' }],
  expectedSuccess: true,
  tags: ['budget', 'idle_time', 'BUD-11'],
  rationale: 'Connection released in finally block prevents pool exhaustion and idle waiting',
});

push({
  description: 'BUD-14: non-retryable errors short-circuited (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const NON_RETRYABLE = [400, 401, 403, 404, 422];
async function retryOnlyTransient(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (e) {
      if (NON_RETRYABLE.includes(e.status)) throw e;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
    }
  }
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'NON_RETRYABLE', description: 'Non-retryable status codes skip retry' }],
  expectedSuccess: true,
  tags: ['budget', 'retry_same_failure', 'BUD-14'],
  rationale: 'Short-circuiting non-retryable errors preserves retry budget for transient failures',
});

push({
  description: 'BUD-13: paginator with max page limit (safe)',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: `const PORT = process.env.PORT || 3000;
const MAX_PAGES = 100;
async function fetchPaginatedSafe(url) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(\`\${url}?page=\${page}\`);
    const data = await res.json();
    if (!data.items || data.items.length === 0) break;
    all.push(...data.items);
  }
  return all;
}`,
  }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'MAX_PAGES', description: 'Pagination loop bounded by max pages' }],
  expectedSuccess: true,
  tags: ['budget', 'max_iterations', 'BUD-13'],
  rationale: 'MAX_PAGES constant prevents infinite pagination even with misbehaving APIs',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Wrote ${scenarios.length} budget-bounds scenarios to ${outPath}`);
