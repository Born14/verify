import { describe, expect, test } from 'bun:test';
import {
  loadDirective,
  formatDirectiveForPrompt,
  applyDirectiveToBundles,
} from '../../scripts/harness/improve-directive.js';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('improve-directive', () => {
  const testDir = join(tmpdir(), `verify-directive-test-${Date.now()}`);

  test('returns default when no directive file exists', () => {
    const directive = loadDirective('/nonexistent/path');
    expect(directive.raw).toBe('');
    expect(directive.priorityGates).toEqual([]);
    expect(directive.focus).toBe('all');
    expect(directive.editStyle).toBe('minimal');
    expect(directive.customInstructions).toBe('');
  });

  test('parses structured fields from directive file', () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'improve-directive.md'), `# Improve Directive

priority-gates: security, grounding, http
focus: false_positives
edit-style: aggressive

## Custom Instructions

Prefer tightening regexes over adding special cases.
`);

    const directive = loadDirective(testDir);
    expect(directive.priorityGates).toEqual(['security', 'grounding', 'http']);
    expect(directive.focus).toBe('false_positives');
    expect(directive.editStyle).toBe('aggressive');
    expect(directive.customInstructions).toBe('Prefer tightening regexes over adding special cases.');

    rmSync(testDir, { recursive: true, force: true });
  });

  test('formats directive for prompt injection', () => {
    const directive = {
      raw: 'something',
      priorityGates: ['security'],
      focus: 'false_positives' as const,
      editStyle: 'minimal' as const,
      customInstructions: 'Be strict about XSS detection.',
    };

    const result = formatDirectiveForPrompt(directive);
    expect(result).toContain('OPERATOR DIRECTIVE');
    expect(result).toContain('Priority gates: security');
    expect(result).toContain('Reduce false positives');
    expect(result).toContain('Be strict about XSS detection');
  });

  test('returns empty string when no directive loaded', () => {
    const directive = {
      raw: '',
      priorityGates: [],
      focus: 'all' as const,
      editStyle: 'minimal' as const,
      customInstructions: '',
    };

    expect(formatDirectiveForPrompt(directive)).toBe('');
  });

  test('applyDirectiveToBundles sorts priority gates first', () => {
    const bundles = [
      { id: 'a', triage: { targetFile: 'src/gates/grounding.ts' } },
      { id: 'b', triage: { targetFile: 'src/gates/security.ts' } },
      { id: 'c', triage: { targetFile: 'src/gates/http.ts' } },
    ];

    const directive = {
      raw: 'x',
      priorityGates: ['security'],
      focus: 'all' as const,
      editStyle: 'minimal' as const,
      customInstructions: '',
    };

    const sorted = applyDirectiveToBundles(bundles, directive);
    expect(sorted[0].id).toBe('b'); // security first
    expect(sorted[1].id).toBe('a');
    expect(sorted[2].id).toBe('c');
  });
});
