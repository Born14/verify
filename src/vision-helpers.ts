/**
 * Vision Helpers — Pre-built LLM callers for common providers
 * ============================================================
 *
 * Verify is provider-agnostic — the vision gate accepts any callback.
 * These helpers are convenience functions for common providers.
 *
 * Usage:
 *   import { geminiVision } from '@sovereign-labs/verify';
 *
 *   const result = await verify(edits, predicates, {
 *     appDir: './my-app',
 *     vision: { call: geminiVision(process.env.GEMINI_API_KEY) },
 *   });
 */

const DEFAULT_TIMEOUT = 15_000;

/**
 * Gemini vision caller. Proven fastest + cheapest for verification.
 * Recommended model: gemini-3.1-flash-lite-preview (~$0.0001/check, sub-3s)
 *
 * @param apiKey - Google AI API key
 * @param model - Model ID (default: gemini-2.0-flash)
 */
export function geminiVision(
  apiKey: string,
  model = 'gemini-2.0-flash',
): (image: Buffer, prompt: string) => Promise<string> {
  return async (image: Buffer, prompt: string): Promise<string> => {
    const base64 = image.toString('base64');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/png', data: base64 } },
          ],
        }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0 },
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini ${res.status}: ${text.substring(0, 200)}`);
    }

    const json: any = await res.json();
    const parts = json?.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p: any) => p.text ?? '').join('');
  };
}

/**
 * OpenAI vision caller (GPT-4o, GPT-4o-mini, etc.)
 *
 * @param apiKey - OpenAI API key
 * @param model - Model ID (default: gpt-4o)
 */
export function openaiVision(
  apiKey: string,
  model = 'gpt-4o',
): (image: Buffer, prompt: string) => Promise<string> {
  return async (image: Buffer, prompt: string): Promise<string> => {
    const base64 = image.toString('base64');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        }],
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI ${res.status}: ${text.substring(0, 200)}`);
    }

    const json: any = await res.json();
    return json?.choices?.[0]?.message?.content ?? '';
  };
}

/**
 * Anthropic vision caller (Claude Sonnet, etc.)
 *
 * @param apiKey - Anthropic API key
 * @param model - Model ID (default: claude-sonnet-4-20250514)
 */
export function anthropicVision(
  apiKey: string,
  model = 'claude-sonnet-4-20250514',
): (image: Buffer, prompt: string) => Promise<string> {
  return async (image: Buffer, prompt: string): Promise<string> => {
    const base64 = image.toString('base64');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic ${res.status}: ${text.substring(0, 200)}`);
    }

    const json: any = await res.json();
    return json?.content?.[0]?.text ?? '';
  };
}
