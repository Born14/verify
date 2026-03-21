/**
 * Claude Code Brain — Interactive LLM via Max Subscription
 * =========================================================
 *
 * When you're a $200/month Claude Max subscriber running Claude Code,
 * you ARE the LLM. No API key needed. No HTTP calls. Claude Code
 * is already running, already has context, already has the subscription.
 *
 * This module creates an LLMCallFn that works through interactive
 * prompt/response exchange — the campaign or improve loop writes
 * the prompt to a file, Claude Code reads it, reasons, and writes
 * the response back. Same LLMCallFn interface, zero API cost.
 *
 * Two modes:
 *
 * 1. CALLBACK MODE (programmatic): The caller provides a callback
 *    function that receives (system, user) prompts and returns text.
 *    Used when Claude Code is driving the loop directly.
 *
 * 2. FILE MODE (CLI): Prompts are written to a request file, the
 *    script waits for a response file. Used when running the campaign
 *    CLI and having Claude Code respond in a separate terminal.
 *
 * The callback mode is the primary path. When Claude Code runs
 * `campaign --llm=claude-code`, it spawns the campaign as a subprocess
 * and provides its own reasoning as the LLM callback.
 */

import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { LLMCallFn, LLMCallResult } from './types.js';

// =============================================================================
// CALLBACK MODE — Claude Code IS the LLM
// =============================================================================

/**
 * The callback type that Claude Code provides.
 * Claude Code receives the system + user prompt, reasons, and returns text.
 * No API calls, no tokens counted (Max subscription = unlimited).
 */
export type ClaudeCodeCallback = (
  systemPrompt: string,
  userPrompt: string,
) => Promise<string>;

/**
 * Create an LLMCallFn from a Claude Code callback.
 *
 * This is the primary integration path. When Claude Code drives
 * the campaign/improve loop, it provides its own reasoning as
 * the callback. Token counts are reported as 0 (Max subscription).
 */
export function createClaudeCodeProvider(callback: ClaudeCodeCallback): LLMCallFn {
  return async (systemPrompt: string, userPrompt: string): Promise<LLMCallResult> => {
    const text = await callback(systemPrompt, userPrompt);
    return {
      text,
      inputTokens: 0,   // Max subscription — no per-token cost
      outputTokens: 0,
    };
  };
}

// =============================================================================
// FILE MODE — Interactive prompt/response via filesystem
// =============================================================================

/**
 * Create an LLMCallFn that exchanges prompts via the filesystem.
 *
 * Flow:
 * 1. Script writes { system, user } to .verify/llm-request.json
 * 2. Script polls for .verify/llm-response.json
 * 3. Claude Code (or human) reads the request, writes the response
 * 4. Script reads response, deletes both files, returns text
 *
 * This mode exists for CLI usage where Claude Code isn't the direct
 * caller but can monitor the exchange directory.
 */
export function createClaudeCodeFileProvider(exchangeDir: string): LLMCallFn {
  mkdirSync(exchangeDir, { recursive: true });
  const requestPath = join(exchangeDir, 'llm-request.json');
  const responsePath = join(exchangeDir, 'llm-response.json');

  return async (systemPrompt: string, userPrompt: string): Promise<LLMCallResult> => {
    // Write request
    writeFileSync(requestPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      system: systemPrompt,
      user: userPrompt,
    }, null, 2));

    console.log(`\n  ┌─────────────────────────────────────────────────┐`);
    console.log(`  │  🧠 Claude Code — your turn                     │`);
    console.log(`  │                                                   │`);
    console.log(`  │  Request written to:                              │`);
    console.log(`  │  ${requestPath}`);
    console.log(`  │                                                   │`);
    console.log(`  │  Write your response to:                          │`);
    console.log(`  │  ${responsePath}`);
    console.log(`  │                                                   │`);
    console.log(`  │  Waiting...                                       │`);
    console.log(`  └─────────────────────────────────────────────────┘\n`);

    // Poll for response
    const startTime = Date.now();
    const timeoutMs = 10 * 60 * 1000; // 10 minute timeout

    while (Date.now() - startTime < timeoutMs) {
      if (existsSync(responsePath)) {
        try {
          const raw = readFileSync(responsePath, 'utf-8');
          // Clean up exchange files
          try { unlinkSync(requestPath); } catch {}
          try { unlinkSync(responsePath); } catch {}

          // Support both raw text and JSON { text: "..." }
          let text: string;
          try {
            const parsed = JSON.parse(raw);
            text = typeof parsed === 'string' ? parsed : (parsed.text ?? raw);
          } catch {
            text = raw; // Plain text response
          }

          return { text, inputTokens: 0, outputTokens: 0 };
        } catch (err: any) {
          console.error(`  Error reading response: ${err.message}`);
          return { text: '', inputTokens: 0, outputTokens: 0 };
        }
      }

      // Wait 1 second before polling again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Timeout
    try { unlinkSync(requestPath); } catch {}
    console.error('  Timeout waiting for Claude Code response (10 min)');
    return { text: '', inputTokens: 0, outputTokens: 0 };
  };
}

// =============================================================================
// MCP TOOL MODE — For future use as an MCP tool
// =============================================================================

/**
 * When verify exposes campaign/improve as MCP tools, Claude Code
 * calls those tools and provides its own reasoning inline.
 *
 * The MCP tool handler receives the tool call, runs the loop step,
 * and when the loop needs LLM reasoning, it returns the prompt as
 * a "needs_reasoning" response. Claude Code reasons and calls back
 * with the answer.
 *
 * This is the aspirational architecture — for now, callback mode
 * is sufficient because Claude Code drives the loop directly.
 */

// Exported for use by campaign runner and improve loop
export { createClaudeCodeProvider as default };
