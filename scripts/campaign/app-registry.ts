/**
 * App Registry — Which Apps to Test
 * ==================================
 *
 * Discovers apps available for campaign testing. Auto-detects stack type,
 * Docker support, and complexity from filesystem inspection.
 *
 * Two modes:
 *   1. Auto-discovery: scan a directory for app subdirectories
 *   2. Manual manifest: load from apps-registry.json
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import type { AppEntry } from './types.js';

// =============================================================================
// AUTO-DETECTION
// =============================================================================

/**
 * Detect stack type from files present in the app directory.
 */
function detectStackType(appDir: string): AppEntry['stackType'] {
  const has = (file: string) => existsSync(join(appDir, file));

  // Check for framework-specific files first
  if (has('next.config.js') || has('next.config.ts') || has('next.config.mjs')) return 'nextjs';
  if (has('requirements.txt') || has('Pipfile') || has('pyproject.toml')) {
    if (has('app.py') || has('wsgi.py')) return 'flask';
    return 'python';
  }

  // Node.js variants
  if (has('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps?.['react'] || deps?.['react-dom']) return 'react';
      if (deps?.['express']) return 'express';
    } catch { /* ignore */ }
    return 'node';
  }
  // server.js without package.json (simple Node apps like demo-app)
  if (has('server.js') || has('index.js') || has('app.js')) return 'node';

  // Static site (HTML files, no package.json)
  const files = readdirSync(appDir).filter(f => f.endsWith('.html'));
  if (files.length > 0) return 'static';

  return 'unknown';
}

/**
 * Estimate complexity from file count and structure.
 */
function detectComplexity(appDir: string): AppEntry['complexity'] {
  try {
    const entries = readdirSync(appDir, { recursive: true }) as string[];
    const sourceFiles = entries.filter(f => {
      const s = String(f);
      return (
        s.endsWith('.js') || s.endsWith('.ts') || s.endsWith('.jsx') || s.endsWith('.tsx') ||
        s.endsWith('.py') || s.endsWith('.html') || s.endsWith('.css')
      ) && !s.includes('node_modules') && !s.includes('.git');
    });
    const count = sourceFiles.length;
    if (count <= 3) return 'minimal';
    if (count <= 10) return 'simple';
    if (count <= 30) return 'moderate';
    return 'complex';
  } catch {
    return 'minimal';
  }
}

/**
 * Build an AppEntry from auto-detection.
 */
function detectApp(appDir: string): AppEntry {
  return {
    name: basename(appDir),
    appDir,
    hasDocker: existsSync(join(appDir, 'docker-compose.yml')) || existsSync(join(appDir, 'docker-compose.yaml')),
    hasPlaywright: existsSync(join(appDir, 'docker-compose.yml')), // Playwright runs in Docker
    stackType: detectStackType(appDir),
    complexity: detectComplexity(appDir),
  };
}

// =============================================================================
// DISCOVERY
// =============================================================================

/**
 * Discover apps by scanning a parent directory.
 * Each subdirectory with source files is treated as an app.
 */
export function discoverApps(parentDir: string): AppEntry[] {
  if (!existsSync(parentDir)) return [];

  const entries = readdirSync(parentDir, { withFileTypes: true });
  const apps: AppEntry[] = [];

  for (const entry of entries) {
    // Handle symlinks (Bun quirk: isDirectory() returns false for symlinks)
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const appDir = join(parentDir, entry.name);

    // Skip common non-app directories
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    // Must have at least one source file or Dockerfile
    const hasSource = existsSync(join(appDir, 'server.js')) ||
      existsSync(join(appDir, 'index.html')) ||
      existsSync(join(appDir, 'package.json')) ||
      existsSync(join(appDir, 'Dockerfile')) ||
      existsSync(join(appDir, 'app.py'));

    if (hasSource) {
      apps.push(detectApp(appDir));
    }
  }

  return apps;
}

/**
 * Load app registry from a JSON manifest file.
 */
export function loadRegistry(path: string): AppEntry[] {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    return (data.apps ?? data) as AppEntry[];
  } catch {
    return [];
  }
}

/**
 * Save app registry to a JSON manifest file.
 */
export function saveRegistry(path: string, apps: AppEntry[]): void {
  const { writeFileSync, mkdirSync } = require('fs');
  const { dirname } = require('path');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ apps }, null, 2) + '\n');
}

/**
 * Resolve apps from CLI args: comma-separated names matched against discovered + manifest.
 */
export function resolveApps(
  names: string[],
  discovered: AppEntry[],
  manifest: AppEntry[],
): AppEntry[] {
  const all = [...manifest];
  // Merge discovered apps not already in manifest
  for (const d of discovered) {
    if (!all.find(a => a.name === d.name)) {
      all.push(d);
    }
  }

  if (names.length === 0) return all;

  return names
    .map(name => all.find(a => a.name === name))
    .filter((a): a is AppEntry => a !== undefined);
}
