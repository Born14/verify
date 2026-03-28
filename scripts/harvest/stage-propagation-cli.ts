#!/usr/bin/env bun
/**
 * Propagation × CLI scenario generator
 * Grid cell: E×5
 * Shapes: PC-01 (Dockerfile changed but image not rebuilt), PC-02 (dependency added but not installed), PC-03 (env var added but process not restarted)
 *
 * These scenarios test whether verify detects propagation gaps in the
 * build→deploy→runtime chain — build artifact changes that don't cascade
 * to the deployed runtime state.
 *
 * All pure-tier (no Docker needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-propagation-cli.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/propagation-cli-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `pc-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const composeTestContent = readFileSync(resolve(demoDir, 'docker-compose.test.yml'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const envProdContent = readFileSync(resolve(demoDir, '.env.prod'), 'utf-8');

// =============================================================================
// Shape PC-01: Dockerfile changed but image not rebuilt
// A Dockerfile change doesn't propagate to the docker-compose or runtime config.
// The build definition and the deploy definition are out of sync.
// =============================================================================

// PC-01a: Dockerfile base image changed, docker-compose doesn't reflect
scenarios.push({
  id: nextId('image'),
  description: 'PC-01: Dockerfile base image changed to node:22-alpine, compose healthcheck still targets port 3000',
  edits: [{ file: 'Dockerfile', search: 'FROM node:20-alpine', replace: 'FROM node:22-alpine' }],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: 'node:22' }],
  expectedSuccess: false,
  tags: ['propagation', 'cli', 'stale_image', 'PC-01'],
  rationale: 'Dockerfile base image updated but compose has no image reference — build→deploy gap',
});

// PC-01b: Dockerfile EXPOSE changed, docker-compose port mapping not updated
scenarios.push({
  id: nextId('image'),
  description: 'PC-01: Dockerfile EXPOSE changed to 8080, docker-compose still maps 3000',
  edits: [{ file: 'Dockerfile', search: 'EXPOSE 3000', replace: 'EXPOSE 8080' }],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: '8080:8080' }],
  expectedSuccess: false,
  tags: ['propagation', 'cli', 'stale_image', 'PC-01'],
  rationale: 'Dockerfile exposes 8080 but compose port mapping still references 3000 — build→deploy port mismatch',
});

// PC-01c: Dockerfile WORKDIR changed, server.js path unchanged
scenarios.push({
  id: nextId('image'),
  description: 'PC-01: Dockerfile WORKDIR changed to /opt/app, COPY still targets relative path',
  edits: [{ file: 'Dockerfile', search: 'WORKDIR /app', replace: 'WORKDIR /opt/app' }],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: '/opt/app' }],
  expectedSuccess: false,
  tags: ['propagation', 'cli', 'stale_image', 'PC-01'],
  rationale: 'WORKDIR changed but compose volumes/config not updated — build artifact path mismatch',
});

// PC-01d: Dockerfile CMD changed to use npm, no package.json exists
scenarios.push({
  id: nextId('image'),
  description: 'PC-01: Dockerfile CMD changed to npm start, but server.js has no npm reference',
  edits: [{ file: 'Dockerfile', search: 'CMD ["node", "server.js"]', replace: 'CMD ["npm", "start"]' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'npm' }],
  expectedSuccess: false,
  tags: ['propagation', 'cli', 'stale_image', 'PC-01'],
  rationale: 'CMD changed to npm start but no package.json with start script — build command gap',
});

// PC-01e: Dockerfile healthcheck URL changed, compose healthcheck not updated
scenarios.push({
  id: nextId('image'),
  description: 'PC-01: Dockerfile healthcheck changed to /ready, docker-compose still checks /health',
  edits: [{ file: 'Dockerfile', search: 'http://localhost:3000/health', replace: 'http://localhost:3000/ready' }],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: '/ready' }],
  expectedSuccess: false,
  tags: ['propagation', 'cli', 'stale_image', 'PC-01'],
  rationale: 'Dockerfile healthcheck path changed but compose healthcheck not updated — dual healthcheck drift',
});

// PC-01f: Control — change Dockerfile and check Dockerfile
scenarios.push({
  id: nextId('image'),
  description: 'PC-01 control: Change Dockerfile EXPOSE, check Dockerfile for new value',
  edits: [{ file: 'Dockerfile', search: 'EXPOSE 3000', replace: 'EXPOSE 9090' }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'EXPOSE 9090' }],
  expectedSuccess: true,
  tags: ['propagation', 'cli', 'stale_image', 'PC-01', 'control'],
  rationale: 'Same-file check — value is present',
});

// =============================================================================
// Shape PC-02: Dependency added but not installed
// A new dependency reference appears in one file but the corresponding
// install/import isn't present in the consuming file.
// =============================================================================

// PC-02a: Add express require to server.js, Dockerfile has no npm install
scenarios.push({
  id: nextId('dep'),
  description: 'PC-02: server.js adds require("express"), Dockerfile has no npm install step',
  edits: [{ file: 'server.js', search: "const http = require('http');", replace: "const http = require('http');\nconst express = require('express');" }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'npm install' }],
  expectedSuccess: false,
  tags: ['propagation', 'cli', 'missing_install', 'PC-02'],
  rationale: 'Express required in code but Dockerfile has no npm install step — dependency not installed',
});

// PC-02b: Add pg require to server.js, no package.json reference
scenarios.push({
  id: nextId('dep'),
  description: 'PC-02: server.js adds require("pg"), config.json has no pg driver reference',
  edits: [{ file: 'server.js', search: "const http = require('http');", replace: "const http = require('http');\nconst { Pool } = require('pg');" }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'pg' }],
  expectedSuccess: false,
  tags: ['propagation', 'cli', 'missing_install', 'PC-02'],
  rationale: 'PG driver required but config has no driver setting — dependency→config propagation gap',
});

// PC-02c: Add redis reference to server.js, docker-compose has no redis service
scenarios.push({
  id: nextId('dep'),
  description: 'PC-02: server.js adds redis require, docker-compose has no redis service',
  edits: [{ file: 'server.js', search: "const http = require('http');", replace: "const http = require('http');\nconst redis = require('redis');" }],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: 'redis' }],
  expectedSuccess: false,
  tags: ['propagation', 'cli', 'missing_install', 'PC-02'],
  rationale: 'Redis required in code but compose has no redis service — runtime dependency missing',
});

// PC-02d: Add dotenv require, Dockerfile has no COPY .env
scenarios.push({
  id: nextId('dep'),
  description: 'PC-02: server.js adds dotenv require, Dockerfile only COPYs server.js',
  edits: [{ file: 'server.js', search: "const http = require('http');", replace: "require('dotenv').config();\nconst http = require('http');" }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'COPY .env' }],
  expectedSuccess: false,
  tags: ['propagation', 'cli', 'missing_install', 'PC-02'],
  rationale: 'dotenv loaded but .env not included in Docker COPY — file not in image',
});

// PC-02e: Control — add require and check server.js for it
scenarios.push({
  id: nextId('dep'),
  description: 'PC-02 control: Add express require, check server.js for express',
  edits: [{ file: 'server.js', search: "const http = require('http');", replace: "const http = require('http');\nconst express = require('express');" }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'express' }],
  expectedSuccess: true,
  tags: ['propagation', 'cli', 'missing_install', 'PC-02', 'control'],
  rationale: 'Same-file check — require is present',
});

// =============================================================================
// Shape PC-03: Env var added but process not restarted
// A new environment variable is added to .env but the docker-compose
// environment section doesn't pass it through, or the server code doesn't read it.
// =============================================================================

// PC-03a: Add LOG_LEVEL to .env, docker-compose doesn't pass it
scenarios.push({
  id: nextId('restart'),
  description: 'PC-03: LOG_LEVEL=debug added to .env, docker-compose env section has no LOG_LEVEL',
  edits: [{ file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nLOG_LEVEL=debug' }],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: 'LOG_LEVEL' }],
  expectedSuccess: false,
  tags: ['propagation', 'cli', 'no_restart', 'PC-03'],
  rationale: 'Env var added but compose env section not updated — process wont see new var',
});

// PC-03b: Add REDIS_URL to .env, server.js doesn't use it
scenarios.push({
  id: nextId('restart'),
  description: 'PC-03: REDIS_URL added to .env, server.js has no redis connection code',
  edits: [{ file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nREDIS_URL=redis://localhost:6379' }],
  predicates: [{ type: 'content', file: 'server.js', pattern: 'REDIS_URL' }],
  expectedSuccess: false,
  tags: ['propagation', 'cli', 'no_restart', 'PC-03'],
  rationale: 'REDIS_URL added but server code never reads it — env→code propagation gap',
});

// PC-03c: Add MAX_CONNECTIONS to .env, config.json has no pool setting
scenarios.push({
  id: nextId('restart'),
  description: 'PC-03: MAX_CONNECTIONS=50 added to .env, config.json has no pool config',
  edits: [{ file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nMAX_CONNECTIONS=50' }],
  predicates: [{ type: 'content', file: 'config.json', pattern: 'MAX_CONNECTIONS' }],
  expectedSuccess: false,
  tags: ['propagation', 'cli', 'no_restart', 'PC-03'],
  rationale: 'Connection limit env var added but config has no pool settings — env→config gap',
});

// PC-03d: Change docker-compose PORT env, Dockerfile EXPOSE unchanged
scenarios.push({
  id: nextId('restart'),
  description: 'PC-03: docker-compose PORT changed to 8080, Dockerfile still EXPOSE 3000',
  edits: [{ file: 'docker-compose.yml', search: '- PORT=3000', replace: '- PORT=8080' }],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'EXPOSE 8080' }],
  expectedSuccess: false,
  tags: ['propagation', 'cli', 'no_restart', 'PC-03'],
  rationale: 'Compose env port changed but Dockerfile EXPOSE not updated — deploy→build propagation gap',
});

// PC-03e: Add CORS_ORIGIN to .env.prod, docker-compose has no CORS env
scenarios.push({
  id: nextId('restart'),
  description: 'PC-03: CORS_ORIGIN added to .env.prod, docker-compose env has no CORS variable',
  edits: [{ file: '.env.prod', search: 'DEBUG=false', replace: 'DEBUG=false\nCORS_ORIGIN=https://app.example.com' }],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: 'CORS' }],
  expectedSuccess: false,
  tags: ['propagation', 'cli', 'no_restart', 'PC-03'],
  rationale: 'CORS env var added to prod config but compose doesnt forward it — env→deploy gap',
});

// PC-03f: Control — add env var and check same .env file
scenarios.push({
  id: nextId('restart'),
  description: 'PC-03 control: Add API_KEY to .env, check .env for it',
  edits: [{ file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nAPI_KEY=test-key-123' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'API_KEY=test-key-123' }],
  expectedSuccess: true,
  tags: ['propagation', 'cli', 'no_restart', 'PC-03', 'control'],
  rationale: 'Same-file check — env var is present',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} propagation-cli scenarios → ${outPath}`);
