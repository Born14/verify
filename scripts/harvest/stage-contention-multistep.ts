#!/usr/bin/env bun
/**
 * Contention x Multi-Step scenario generator
 * Grid cell: J x 6
 * Shapes: JM-01 (deploy A and deploy B both modify same config), JM-02 (migration A and migration B target same table), JM-03 (build A and build B compete for same output directory)
 *
 * Contention scenarios test whether verify detects COLLISION between concurrent
 * multi-step workflows. Step 2 of workflow A conflicts with step 1 of workflow B.
 * Each workflow is internally consistent but the interleaving produces broken state.
 *
 * All pure-tier (no Docker needed) — tests structural cross-source consistency.
 *
 * Run: bun scripts/harvest/stage-contention-multistep.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/contention-multistep-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `jm-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read fixture files for reference
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const initSQL = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');
const configProd = readFileSync(resolve(demoDir, 'config.prod.json'), 'utf-8');
const configStaging = readFileSync(resolve(demoDir, 'config.staging.json'), 'utf-8');

// =============================================================================
// Shape JM-01: Deploy A and deploy B both modify same config
// Two deploy workflows each have a config update step. When interleaved, step 2
// of deploy A overwrites step 1 of deploy B's config change.
// =============================================================================

// JM-01a: Deploy A changes port in config.json, deploy B changes port in .env — but A also touches .env
scenarios.push({
  id: nextId('deploy'),
  description: 'JM-01: Deploy A changes config.json port AND .env port, deploy B also changes .env port',
  edits: [
    { file: 'config.json', search: '"port": 3000', replace: '"port": 4000' },
    { file: '.env', search: 'PORT=3000', replace: 'PORT=4000' },
    { file: '.env', search: 'PORT=3000', replace: 'PORT=5000' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"port": 4000' },
    { type: 'content', file: '.env', pattern: 'PORT=5000' },
  ],
  expectedSuccess: false,
  tags: ['contention', 'multistep', 'config_deploy', 'JM-01'],
  rationale: 'Deploy A step 2 changes .env to 4000, deploy B tries same line — search "PORT=3000" gone',
});

// JM-01b: Deploy A enables darkMode in config.json, deploy B disables it
scenarios.push({
  id: nextId('deploy'),
  description: 'JM-01: Deploy A enables darkMode, deploy B disables darkMode in same config.json',
  edits: [
    { file: 'config.json', search: '"darkMode": true', replace: '"darkMode": false' },
    { file: 'config.json', search: '"darkMode": true', replace: '"darkMode": true, "theme": "auto"' },
  ],
  predicates: [{ type: 'content', file: 'config.json', pattern: '"theme": "auto"' }],
  expectedSuccess: false,
  tags: ['contention', 'multistep', 'config_deploy', 'JM-01'],
  rationale: 'Deploy A turns off darkMode, deploy B search for darkMode:true gone — interleaving conflict',
});

// JM-01c: Deploy A changes NODE_ENV in .env, deploy B changes SECRET_KEY — but both touch .env.prod
scenarios.push({
  id: nextId('deploy'),
  description: 'JM-01: Two deploys both update SECRET_KEY in .env with different rotation values',
  edits: [
    { file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="rotation-alpha-2026"' },
    { file: '.env', search: 'SECRET_KEY="not-very-secret"', replace: 'SECRET_KEY="rotation-beta-2026"' },
  ],
  predicates: [{ type: 'content', file: '.env', pattern: 'rotation-beta-2026' }],
  expectedSuccess: false,
  tags: ['contention', 'multistep', 'config_deploy', 'JM-01'],
  rationale: 'Both deploys rotate same secret — second search gone after first applies alpha rotation',
});

// JM-01d: Deploy A updates Dockerfile base image, deploy B also updates it
scenarios.push({
  id: nextId('deploy'),
  description: 'JM-01: Two deploys both update Dockerfile base image to different versions',
  edits: [
    { file: 'Dockerfile', search: 'FROM node:20-alpine', replace: 'FROM node:22-alpine' },
    { file: 'Dockerfile', search: 'FROM node:20-alpine', replace: 'FROM node:21-slim' },
  ],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'FROM node:21-slim' }],
  expectedSuccess: false,
  tags: ['contention', 'multistep', 'config_deploy', 'JM-01'],
  rationale: 'Both deploys update base image — second search "node:20-alpine" gone after first edit',
});

// JM-01e: Deploy A and B both change docker-compose ports mapping
scenarios.push({
  id: nextId('deploy'),
  description: 'JM-01: Two deploys both change host port mapping in docker-compose.yml',
  edits: [
    { file: 'docker-compose.yml', search: '"${VERIFY_HOST_PORT:-3000}:3000"', replace: '"${VERIFY_HOST_PORT:-4000}:3000"' },
    { file: 'docker-compose.yml', search: '"${VERIFY_HOST_PORT:-3000}:3000"', replace: '"${VERIFY_HOST_PORT:-5000}:3000"' },
  ],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: 'VERIFY_HOST_PORT:-5000' }],
  expectedSuccess: false,
  tags: ['contention', 'multistep', 'config_deploy', 'JM-01'],
  rationale: 'Both deploys change host port — second search gone after first changes to 4000',
});

// JM-01f: Control — deploy A updates config.json, deploy B updates .env (different files, no overlap)
scenarios.push({
  id: nextId('deploy'),
  description: 'JM-01 control: Deploy A updates config.json features, deploy B updates .env debug (no conflict)',
  edits: [
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": true' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=true' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: '"analytics": true' },
    { type: 'content', file: '.env', pattern: 'DEBUG=true' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'multistep', 'config_deploy', 'JM-01', 'control'],
  rationale: 'Deploys touch different files — no interleaving conflict',
});

// =============================================================================
// Shape JM-02: Migration A and migration B target same table
// Two migration steps both ALTER the same table. The second migration's search
// string references the pre-migration schema that migration A already changed.
// =============================================================================

// JM-02a: Two migrations both add a column to users table after is_active
scenarios.push({
  id: nextId('migrate'),
  description: 'JM-02: Two migrations both add column to users table after is_active line',
  edits: [
    { file: 'init.sql', search: '    is_active BOOLEAN DEFAULT true,', replace: '    is_active BOOLEAN DEFAULT true,\n    last_login TIMESTAMP,' },
    { file: 'init.sql', search: '    is_active BOOLEAN DEFAULT true,', replace: '    is_active BOOLEAN DEFAULT true,\n    avatar_url TEXT,' },
  ],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'avatar_url TEXT' }],
  expectedSuccess: false,
  tags: ['contention', 'multistep', 'migration_conflict', 'JM-02'],
  rationale: 'Both migrations insert after is_active — second search gone after first adds last_login',
});

// JM-02b: Two migrations both modify the sessions table token column
scenarios.push({
  id: nextId('migrate'),
  description: 'JM-02: Two migrations both change sessions.token column definition',
  edits: [
    { file: 'init.sql', search: '    token TEXT NOT NULL UNIQUE,', replace: '    token VARCHAR(512) NOT NULL UNIQUE,' },
    { file: 'init.sql', search: '    token TEXT NOT NULL UNIQUE,', replace: '    token TEXT NOT NULL,' },
  ],
  predicates: [{ type: 'content', file: 'init.sql', pattern: '    token TEXT NOT NULL,' }],
  expectedSuccess: false,
  tags: ['contention', 'multistep', 'migration_conflict', 'JM-02'],
  rationale: 'Both migrations change token column — second search gone after first changes to VARCHAR',
});

// JM-02c: Two migrations both add indexes on sessions table
scenarios.push({
  id: nextId('migrate'),
  description: 'JM-02: Two migrations both add index after existing sessions indexes',
  edits: [
    { file: 'init.sql', search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);', replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\nCREATE INDEX idx_sessions_user ON sessions(user_id);' },
    { file: 'init.sql', search: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);', replace: 'CREATE INDEX idx_sessions_expires ON sessions(expires_at);\nCREATE INDEX idx_sessions_created ON sessions(created_at);' },
  ],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'idx_sessions_created' }],
  expectedSuccess: false,
  tags: ['contention', 'multistep', 'migration_conflict', 'JM-02'],
  rationale: 'Both migrations insert after expires index — second search gone after first adds user index',
});

// JM-02d: Two migrations both change the posts table published column
scenarios.push({
  id: nextId('migrate'),
  description: 'JM-02: Two migrations both change posts.published column default',
  edits: [
    { file: 'init.sql', search: '    published BOOLEAN DEFAULT false,', replace: '    published BOOLEAN DEFAULT true,' },
    { file: 'init.sql', search: '    published BOOLEAN DEFAULT false,', replace: '    published BOOLEAN NOT NULL DEFAULT false,' },
  ],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'published BOOLEAN NOT NULL DEFAULT false' }],
  expectedSuccess: false,
  tags: ['contention', 'multistep', 'migration_conflict', 'JM-02'],
  rationale: 'Both migrations modify published column — second search gone after first changes default',
});

// JM-02e: Two migrations both add a constraint to the settings table
scenarios.push({
  id: nextId('migrate'),
  description: 'JM-02: Two migrations both modify settings table value column',
  edits: [
    { file: 'init.sql', search: '    value JSONB NOT NULL,', replace: '    value JSONB NOT NULL DEFAULT \'{}\'::jsonb,' },
    { file: 'init.sql', search: '    value JSONB NOT NULL,', replace: '    value JSONB NOT NULL CHECK (value IS NOT NULL),' },
  ],
  predicates: [{ type: 'content', file: 'init.sql', pattern: 'CHECK (value IS NOT NULL)' }],
  expectedSuccess: false,
  tags: ['contention', 'multistep', 'migration_conflict', 'JM-02'],
  rationale: 'Both migrations modify value column — second search gone after first adds default',
});

// JM-02f: Control — migration A on users, migration B on posts (different tables)
scenarios.push({
  id: nextId('migrate'),
  description: 'JM-02 control: Migration A adds users column, migration B adds posts column (no conflict)',
  edits: [
    { file: 'init.sql', search: '    is_active BOOLEAN DEFAULT true,', replace: '    is_active BOOLEAN DEFAULT true,\n    bio TEXT,' },
    { file: 'init.sql', search: '    view_count INTEGER DEFAULT 0,', replace: '    view_count INTEGER DEFAULT 0,\n    category VARCHAR(50),' },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'bio TEXT' },
    { type: 'content', file: 'init.sql', pattern: 'category VARCHAR(50)' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'multistep', 'migration_conflict', 'JM-02', 'control'],
  rationale: 'Different tables — no migration conflict, both additions apply cleanly',
});

// =============================================================================
// Shape JM-03: Build A and build B compete for same output directory
// Two build workflows both modify the Dockerfile or docker-compose configuration,
// creating conflicting build artifacts or output paths.
// =============================================================================

// JM-03a: Two builds both change the WORKDIR in Dockerfile
scenarios.push({
  id: nextId('build'),
  description: 'JM-03: Two builds both change WORKDIR in Dockerfile to different directories',
  edits: [
    { file: 'Dockerfile', search: 'WORKDIR /app', replace: 'WORKDIR /opt/app' },
    { file: 'Dockerfile', search: 'WORKDIR /app', replace: 'WORKDIR /srv/demo' },
  ],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'WORKDIR /srv/demo' }],
  expectedSuccess: false,
  tags: ['contention', 'multistep', 'build_conflict', 'JM-03'],
  rationale: 'Both builds change WORKDIR — second search gone after first changes to /opt/app',
});

// JM-03b: Two builds both change COPY source in Dockerfile
scenarios.push({
  id: nextId('build'),
  description: 'JM-03: Two builds both change COPY instruction to different source files',
  edits: [
    { file: 'Dockerfile', search: 'COPY server.js .', replace: 'COPY dist/ .' },
    { file: 'Dockerfile', search: 'COPY server.js .', replace: 'COPY build/ .' },
  ],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'COPY build/ .' }],
  expectedSuccess: false,
  tags: ['contention', 'multistep', 'build_conflict', 'JM-03'],
  rationale: 'Both builds change COPY source — second search gone after first changes to dist/',
});

// JM-03c: Two builds both change the HEALTHCHECK in Dockerfile
scenarios.push({
  id: nextId('build'),
  description: 'JM-03: Two builds both change HEALTHCHECK command in Dockerfile',
  edits: [
    { file: 'Dockerfile', search: 'HEALTHCHECK --interval=5s --timeout=3s CMD wget -q -O- http://localhost:3000/health || exit 1', replace: 'HEALTHCHECK --interval=10s --timeout=5s CMD curl -f http://localhost:3000/health || exit 1' },
    { file: 'Dockerfile', search: 'HEALTHCHECK --interval=5s --timeout=3s CMD wget -q -O- http://localhost:3000/health || exit 1', replace: 'HEALTHCHECK --interval=30s --timeout=10s CMD wget -q -O- http://localhost:3000/ready || exit 1' },
  ],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'interval=30s' }],
  expectedSuccess: false,
  tags: ['contention', 'multistep', 'build_conflict', 'JM-03'],
  rationale: 'Both builds change HEALTHCHECK — second search gone after first changes to curl',
});

// JM-03d: Two builds both change docker-compose build context
scenarios.push({
  id: nextId('build'),
  description: 'JM-03: Two builds both change build context in docker-compose.yml',
  edits: [
    { file: 'docker-compose.yml', search: '    build: .', replace: '    build:\n      context: .\n      dockerfile: Dockerfile.prod' },
    { file: 'docker-compose.yml', search: '    build: .', replace: '    build:\n      context: ./src\n      dockerfile: Dockerfile' },
  ],
  predicates: [{ type: 'content', file: 'docker-compose.yml', pattern: 'context: ./src' }],
  expectedSuccess: false,
  tags: ['contention', 'multistep', 'build_conflict', 'JM-03'],
  rationale: 'Both builds change build context — second search gone after first restructures to multi-line',
});

// JM-03e: Two builds both change EXPOSE port in Dockerfile
scenarios.push({
  id: nextId('build'),
  description: 'JM-03: Two builds both change EXPOSE port in Dockerfile',
  edits: [
    { file: 'Dockerfile', search: 'EXPOSE 3000', replace: 'EXPOSE 4000' },
    { file: 'Dockerfile', search: 'EXPOSE 3000', replace: 'EXPOSE 8080' },
  ],
  predicates: [{ type: 'content', file: 'Dockerfile', pattern: 'EXPOSE 8080' }],
  expectedSuccess: false,
  tags: ['contention', 'multistep', 'build_conflict', 'JM-03'],
  rationale: 'Both builds change EXPOSE — second search gone after first changes to 4000',
});

// JM-03f: Control — build A changes Dockerfile CMD, build B changes compose env (different files)
scenarios.push({
  id: nextId('build'),
  description: 'JM-03 control: Build A changes Dockerfile CMD, build B changes compose env (no conflict)',
  edits: [
    { file: 'Dockerfile', search: 'CMD ["node", "server.js"]', replace: 'CMD ["node", "app.js"]' },
    { file: 'docker-compose.yml', search: '- PORT=3000', replace: '- PORT=4000' },
  ],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'CMD ["node", "app.js"]' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'PORT=4000' },
  ],
  expectedSuccess: true,
  tags: ['contention', 'multistep', 'build_conflict', 'JM-03', 'control'],
  rationale: 'Different files — no build output conflict, both apply cleanly',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} contention-multistep scenarios -> ${outPath}`);
