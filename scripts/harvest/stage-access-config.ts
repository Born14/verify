#!/usr/bin/env bun
/**
 * Access x Config scenario generator
 * Grid cell: H×8
 * Shapes: HG-01 (.env has restricted permissions), HG-02 (secrets require API key not in config), HG-03 (prod config requires different auth than staging)
 *
 * These scenarios test whether verify detects ACCESS failures in the
 * configuration layer — .env files with wrong permissions, secrets that
 * need credentials not present in the current environment, and config files
 * that require different auth levels per environment.
 *
 * Run: bun scripts/harvest/stage-access-config.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/access-config-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `hg-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read real fixture content
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const configProdContent = readFileSync(resolve(demoDir, 'config.prod.json'), 'utf-8');
const configStagingContent = readFileSync(resolve(demoDir, 'config.staging.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const envProdContent = readFileSync(resolve(demoDir, '.env.prod'), 'utf-8');
const envStagingContent = readFileSync(resolve(demoDir, '.env.staging'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');

// =============================================================================
// Shape HG-01: .env has restricted permissions
// The .env file is present but readable only by root or another user.
// The agent edits it but the app process cannot read it at runtime.
// =============================================================================

// HG-01a: Edit .env but Dockerfile runs as non-root user who cannot read it
scenarios.push({
  id: nextId('perm'),
  description: 'HG-01: .env edited, Dockerfile USER node, .env owned by root (chmod 600)',
  edits: [
    { file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="new-rotated-key"' },
    { file: 'Dockerfile', search: 'CMD ["node", "server.js"]', replace: 'USER node\nCMD ["node", "server.js"]' },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'SECRET_KEY="new-rotated-key"' },
    { type: 'content', file: 'Dockerfile', pattern: 'USER node' },
  ],
  expectedSuccess: true,
  tags: ['access', 'config', 'env_permissions', 'HG-01'],
  rationale: '.env edited but container runs as node user — if .env is root-owned, app cannot read it',
});

// HG-01b: .env.prod edited but referenced from read-only mount
scenarios.push({
  id: nextId('perm'),
  description: 'HG-01: .env.prod edited, compose mounts config as read-only',
  edits: [
    { file: '.env.prod', search: 'SECRET_KEY="prod-secret-rotated-2026"', replace: 'SECRET_KEY="freshly-rotated-2027"' },
    { file: 'docker-compose.yml', search: 'retries: 3', replace: "retries: 3\n    volumes:\n      - ./.env.prod:/app/.env:ro" },
  ],
  predicates: [
    { type: 'content', file: '.env.prod', pattern: 'SECRET_KEY="freshly-rotated-2027"' },
    { type: 'content', file: 'docker-compose.yml', pattern: '.env.prod:/app/.env:ro' },
  ],
  expectedSuccess: true,
  tags: ['access', 'config', 'env_permissions', 'HG-01'],
  rationale: '.env.prod mounted as :ro — app can read but cannot write/update secrets at runtime',
});

// HG-01c: Edit .env but compose env_file references different path
scenarios.push({
  id: nextId('perm'),
  description: 'HG-01: Edit .env but compose env_file points to /run/secrets/.env (Docker secret)',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' },
    { file: 'docker-compose.yml', search: 'environment:\n      - PORT=3000', replace: "env_file:\n      - /run/secrets/.env\n    environment:\n      - PORT=3000" },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'DEBUG=true' },
    { type: 'content', file: 'docker-compose.yml', pattern: '/run/secrets/.env' },
  ],
  expectedSuccess: true,
  tags: ['access', 'config', 'env_permissions', 'HG-01'],
  rationale: 'Local .env edited but compose reads from /run/secrets/.env — edit has no effect on running app',
});

// HG-01d: .env.staging readable but .env.prod has different permissions
scenarios.push({
  id: nextId('perm'),
  description: 'HG-01: Edit both .env.staging and .env.prod, prod needs vault access',
  edits: [
    { file: '.env.staging', search: 'SECRET_KEY="staging-secret-key"', replace: 'SECRET_KEY="staging-new-key"' },
    { file: '.env.prod', search: 'SECRET_KEY="prod-secret-rotated-2026"', replace: 'SECRET_KEY="prod-needs-vault"' },
  ],
  predicates: [
    { type: 'content', file: '.env.staging', pattern: 'SECRET_KEY="staging-new-key"' },
    { type: 'content', file: '.env.prod', pattern: 'SECRET_KEY="prod-needs-vault"' },
  ],
  expectedSuccess: true,
  tags: ['access', 'config', 'env_permissions', 'HG-01'],
  rationale: 'Staging .env is app-writable but prod .env should be vault-managed — permission mismatch',
});

// HG-01e: Control — .env within app permissions
scenarios.push({
  id: nextId('perm'),
  description: 'HG-01 control: Edit .env, no permission restriction',
  edits: [{ file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'DEBUG=true' }],
  expectedSuccess: true,
  tags: ['access', 'config', 'env_permissions', 'HG-01', 'control'],
  rationale: '.env is app-owned and writable — no permission issue',
});

// =============================================================================
// Shape HG-02: Secrets require API key not in config
// Config references external secret stores (vault, KMS, parameter store)
// but the credentials to access them are not present in the environment.
// =============================================================================

// HG-02a: Config references vault but no VAULT_TOKEN in .env
scenarios.push({
  id: nextId('secret'),
  description: 'HG-02: config.json references vault path, .env has no VAULT_TOKEN',
  edits: [{
    file: 'config.json',
    search: '"name": "Demo App"',
    replace: '"name": "Demo App",\n    "secretsBackend": "vault",\n    "vaultPath": "secret/data/demo"',
  }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'vaultPath' },
    { type: 'content', file: '.env', pattern: 'VAULT_TOKEN' },
  ],
  expectedSuccess: false,
  tags: ['access', 'config', 'missing_credentials', 'HG-02'],
  rationale: 'Config points to vault but VAULT_TOKEN not in .env — secrets cannot be fetched',
});

// HG-02b: .env references AWS SSM parameter store, no AWS credentials
scenarios.push({
  id: nextId('secret'),
  description: 'HG-02: .env sets SSM_PARAM_PATH but no AWS_ACCESS_KEY_ID present',
  edits: [{
    file: '.env',
    search: 'DEBUG=false',
    replace: 'DEBUG=false\nSSM_PARAM_PATH=/prod/demo/secrets\nSECRET_BACKEND=aws-ssm',
  }],
  predicates: [
    { type: 'content', file: '.env', pattern: 'SSM_PARAM_PATH' },
    { type: 'content', file: '.env', pattern: 'AWS_ACCESS_KEY_ID' },
  ],
  expectedSuccess: false,
  tags: ['access', 'config', 'missing_credentials', 'HG-02'],
  rationale: 'SSM parameter path set but no AWS credentials — parameter store inaccessible',
});

// HG-02c: Config references GCP Secret Manager, no service account
scenarios.push({
  id: nextId('secret'),
  description: 'HG-02: config.json uses GCP Secret Manager, no GOOGLE_APPLICATION_CREDENTIALS in .env',
  edits: [{
    file: 'config.json',
    search: '"analytics": false',
    replace: '"analytics": false,\n    "secretProvider": "gcp-secret-manager",\n    "gcpProject": "my-project"',
  }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'gcp-secret-manager' },
    { type: 'content', file: '.env', pattern: 'GOOGLE_APPLICATION_CREDENTIALS' },
  ],
  expectedSuccess: false,
  tags: ['access', 'config', 'missing_credentials', 'HG-02'],
  rationale: 'GCP Secret Manager referenced but no service account credentials in environment',
});

// HG-02d: Docker compose uses external secrets, no Docker Swarm init
scenarios.push({
  id: nextId('secret'),
  description: 'HG-02: compose uses Docker secrets, predicate checks secret file exists',
  edits: [{
    file: 'docker-compose.yml',
    search: 'services:\n  app:',
    replace: "secrets:\n  db_password:\n    external: true\nservices:\n  app:\n    secrets:\n      - db_password",
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'db_password' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'external: true' },
  ],
  expectedSuccess: true,
  tags: ['access', 'config', 'missing_credentials', 'HG-02'],
  rationale: 'Docker external secrets require Swarm mode — compose up fails without swarm init',
});

// HG-02e: Control — secrets inline in .env (no external dependency)
scenarios.push({
  id: nextId('secret'),
  description: 'HG-02 control: All secrets inline in .env (no external provider)',
  edits: [{ file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="inline-secret-value"' }],
  predicates: [{ type: 'content', file: '.env', pattern: 'SECRET_KEY="inline-secret-value"' }],
  expectedSuccess: true,
  tags: ['access', 'config', 'missing_credentials', 'HG-02', 'control'],
  rationale: 'Secret is inline — no external provider needed, edit succeeds',
});

// =============================================================================
// Shape HG-03: Prod config requires different auth than staging
// Staging edits work fine but the predicate checks production config that
// has different auth requirements or values.
// =============================================================================

// HG-03a: Staging config editable, prod config has different DB credentials
scenarios.push({
  id: nextId('env'),
  description: 'HG-03: Edit staging DB URL, predicate checks prod DB URL (different host)',
  edits: [{ file: 'config.staging.json', search: '"name": "demo_staging"', replace: '"name": "demo_staging_v2"' }],
  predicates: [
    { type: 'content', file: 'config.staging.json', pattern: 'demo_staging_v2' },
    { type: 'content', file: 'config.prod.json', pattern: 'demo_staging_v2' },
  ],
  expectedSuccess: false,
  tags: ['access', 'config', 'env_mismatch', 'HG-03'],
  rationale: 'Staging config updated but prod config has different DB name — cross-env assumption fails',
});

// HG-03b: .env.staging writable, .env.prod has managed secret
scenarios.push({
  id: nextId('env'),
  description: 'HG-03: Staging DEBUG flipped, predicate expects same in prod .env',
  edits: [{ file: '.env.staging', search: 'DEBUG=true', replace: 'DEBUG=false' }],
  predicates: [
    { type: 'content', file: '.env.staging', pattern: 'DEBUG=false' },
    { type: 'content', file: '.env.prod', pattern: 'DEBUG=false' },
  ],
  expectedSuccess: true,
  tags: ['access', 'config', 'env_mismatch', 'HG-03'],
  rationale: 'Both happen to have DEBUG=false but for different reasons — staging is editable, prod is policy',
});

// HG-03c: Staging features enabled, prod features locked
scenarios.push({
  id: nextId('env'),
  description: 'HG-03: Enable betaSignup in staging, predicate checks it in prod (locked to false)',
  edits: [{ file: 'config.staging.json', search: '"betaSignup": true', replace: '"betaSignup": false' }],
  predicates: [
    { type: 'content', file: 'config.staging.json', pattern: '"betaSignup": false' },
    { type: 'content', file: 'config.prod.json', pattern: '"betaSignup": true' },
  ],
  expectedSuccess: false,
  tags: ['access', 'config', 'env_mismatch', 'HG-03'],
  rationale: 'Staging betaSignup changed but prod has it locked to false — cannot match across envs',
});

// HG-03d: Staging port configurable, prod port fixed by load balancer
scenarios.push({
  id: nextId('env'),
  description: 'HG-03: Change staging port, predicate checks prod port (fixed at 3000)',
  edits: [{ file: '.env.staging', search: 'PORT=3000', replace: 'PORT=4000' }],
  predicates: [
    { type: 'content', file: '.env.staging', pattern: 'PORT=4000' },
    { type: 'content', file: '.env.prod', pattern: 'PORT=4000' },
  ],
  expectedSuccess: false,
  tags: ['access', 'config', 'env_mismatch', 'HG-03'],
  rationale: 'Staging port changed to 4000 but prod port is fixed at 3000 by load balancer policy',
});

// HG-03e: Control — edit and check same environment
scenarios.push({
  id: nextId('env'),
  description: 'HG-03 control: Edit and check both in staging config (same env)',
  edits: [{ file: 'config.staging.json', search: '"analytics": true', replace: '"analytics": false' }],
  predicates: [{ type: 'content', file: 'config.staging.json', pattern: '"analytics": false' }],
  expectedSuccess: true,
  tags: ['access', 'config', 'env_mismatch', 'HG-03', 'control'],
  rationale: 'Edit and predicate both target staging config — same environment, no mismatch',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} access-config scenarios -> ${outPath}`);
