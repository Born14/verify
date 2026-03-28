#!/usr/bin/env bun
/**
 * Access × CLI/Process scenario generator
 * Grid cell: H×5
 * Shapes: HC-01 (sudo required), HC-02 (docker socket denied), HC-03 (SSH key rejected)
 *
 * These scenarios test whether verify detects process-level ACCESS failures —
 * the command or operation exists but the executing user lacks the privilege
 * to run it. Dockerfile USER directives, privileged ports, docker group
 * membership, and SSH key mismatches.
 *
 * Run: bun scripts/harvest/stage-access-cli.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/access-cli-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `hc-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read real fixture content
const dockerfileContent = readFileSync(resolve(demoDir, 'Dockerfile'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');

// =============================================================================
// Shape HC-01: Sudo required — command needs root but runs as app user
// Dockerfile uses USER directive to drop privileges, but the process tries
// to perform operations that require root (privileged ports, systemctl, etc.).
// =============================================================================

// HC-01a: Dockerfile sets USER node, compose binds privileged port 80
scenarios.push({
  id: nextId('sudo'),
  description: 'HC-01: Dockerfile USER node but docker-compose binds privileged port 80',
  edits: [
    { file: 'Dockerfile', search: 'CMD ["node", "server.js"]', replace: 'USER node\nCMD ["node", "server.js"]' },
    { file: 'docker-compose.yml', search: '"${VERIFY_HOST_PORT:-3000}:3000"', replace: '"80:3000"' },
  ],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'USER node' },
    { type: 'content', file: 'docker-compose.yml', pattern: '"80:3000"' },
  ],
  expectedSuccess: true,
  tags: ['access', 'cli', 'sudo_required', 'HC-01'],
  rationale: 'Both patterns exist in files. Port 80 binding is on the host side of compose — container user doesnt matter for host port. But inside container, USER node cannot bind <1024.',
});

// HC-01b: Dockerfile USER node, server listens on port 443
scenarios.push({
  id: nextId('sudo'),
  description: 'HC-01: Dockerfile USER node but server.js binds to port 443 (privileged)',
  edits: [
    { file: 'Dockerfile', search: 'EXPOSE 3000', replace: 'EXPOSE 443' },
    { file: 'Dockerfile', search: 'CMD ["node", "server.js"]', replace: 'USER node\nCMD ["node", "server.js"]' },
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 443;" },
  ],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'USER node' },
    { type: 'content', file: 'Dockerfile', pattern: 'EXPOSE 443' },
    { type: 'content', file: 'server.js', pattern: 'PORT || 443' },
  ],
  expectedSuccess: true,
  tags: ['access', 'cli', 'sudo_required', 'HC-01'],
  rationale: 'Non-root user cannot bind port 443 inside container — EACCES at runtime. All content patterns present.',
});

// HC-01c: Server tries to write to /etc/nginx but runs as non-root
scenarios.push({
  id: nextId('sudo'),
  description: 'HC-01: Server writes nginx config but Dockerfile runs as non-root USER',
  edits: [
    { file: 'Dockerfile', search: 'CMD ["node", "server.js"]', replace: 'USER node\nCMD ["node", "server.js"]' },
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\n// fs.writeFileSync('/etc/nginx/conf.d/app.conf', 'upstream ...');" },
  ],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'USER node' },
    { type: 'content', file: 'server.js', pattern: '/etc/nginx/conf.d' },
  ],
  expectedSuccess: true,
  tags: ['access', 'cli', 'sudo_required', 'HC-01'],
  rationale: 'Non-root user cannot write to /etc/nginx — permission denied. Both patterns present in source.',
});

// HC-01d: Agent adds systemctl command but .env shows no sudo
scenarios.push({
  id: nextId('sudo'),
  description: 'HC-01: Server runs systemctl restart but .env has no SUDO configured',
  edits: [
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nconst { execSync } = require('child_process');\n// execSync('systemctl restart nginx');" },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nRUN_AS_USER=app' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'systemctl restart' },
    { type: 'content', file: '.env', pattern: 'RUN_AS_USER=app' },
  ],
  expectedSuccess: true,
  tags: ['access', 'cli', 'sudo_required', 'HC-01'],
  rationale: 'systemctl requires root but process runs as "app" user — permission denied at runtime',
});

// HC-01e: Agent adds apt-get install in Dockerfile after USER directive
scenarios.push({
  id: nextId('sudo'),
  description: 'HC-01: Dockerfile runs apt-get install AFTER USER node (needs root)',
  edits: [{
    file: 'Dockerfile',
    search: 'CMD ["node", "server.js"]',
    replace: 'USER node\nRUN apt-get update && apt-get install -y curl\nCMD ["node", "server.js"]'
  }],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'USER node' },
    { type: 'content', file: 'Dockerfile', pattern: 'apt-get install' },
  ],
  expectedSuccess: true,
  tags: ['access', 'cli', 'sudo_required', 'HC-01'],
  rationale: 'apt-get requires root but USER node is set before RUN — build will fail',
});

// HC-01f: Control — Dockerfile runs as root, no privilege issue
scenarios.push({
  id: nextId('sudo'),
  description: 'HC-01 control: Dockerfile has no USER directive (runs as root by default)',
  edits: [{ file: 'Dockerfile', search: 'EXPOSE 3000', replace: 'EXPOSE 3000\nRUN apt-get update && apt-get install -y curl' }],
  predicates: [
    { type: 'content', file: 'Dockerfile', pattern: 'apt-get install' },
    { type: 'content', file: 'Dockerfile', pattern: 'EXPOSE 3000' },
  ],
  expectedSuccess: true,
  tags: ['access', 'cli', 'sudo_required', 'HC-01', 'control'],
  rationale: 'No USER directive — default root user can run apt-get without issue',
});

// =============================================================================
// Shape HC-02: Docker socket denied
// Agent runs docker commands but the executing user is not in the docker group,
// or compose config references docker socket without proper permissions.
// =============================================================================

// HC-02a: Compose mounts docker socket but Dockerfile runs as non-root
scenarios.push({
  id: nextId('docker'),
  description: 'HC-02: Compose mounts /var/run/docker.sock but Dockerfile USER is node',
  edits: [
    { file: 'docker-compose.yml', search: 'retries: 3', replace: "retries: 3\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock" },
    { file: 'Dockerfile', search: 'CMD ["node", "server.js"]', replace: 'USER node\nCMD ["node", "server.js"]' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'docker.sock' },
    { type: 'content', file: 'Dockerfile', pattern: 'USER node' },
  ],
  expectedSuccess: true,
  tags: ['access', 'cli', 'docker_socket', 'HC-02'],
  rationale: 'Docker socket mounted but USER node is not in docker group — socket access denied',
});

// HC-02b: Server spawns docker exec but runs as unprivileged user
scenarios.push({
  id: nextId('docker'),
  description: 'HC-02: Server runs docker exec command but .env shows non-docker user',
  edits: [
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\nconst { execSync } = require('child_process');\n// execSync('docker exec db pg_dump demo');" },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nDOCKER_GROUP=false' },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'docker exec' },
    { type: 'content', file: '.env', pattern: 'DOCKER_GROUP=false' },
  ],
  expectedSuccess: true,
  tags: ['access', 'cli', 'docker_socket', 'HC-02'],
  rationale: 'Server calls docker exec but user not in docker group — "permission denied" on socket',
});

// HC-02c: Compose uses docker-in-docker but no privileged flag
scenarios.push({
  id: nextId('docker'),
  description: 'HC-02: Compose runs docker:dind image but missing privileged: true',
  edits: [{
    file: 'docker-compose.yml',
    search: 'retries: 3',
    replace: `retries: 3
  dind:
    image: docker:dind
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock`
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'docker:dind' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'privileged: true' },
  ],
  expectedSuccess: false,
  tags: ['access', 'cli', 'docker_socket', 'HC-02'],
  rationale: 'docker:dind requires privileged mode but no privileged: true in compose — daemon will not start',
});

// HC-02d: Agent adds docker compose healthcheck but socket not mounted
scenarios.push({
  id: nextId('docker'),
  description: 'HC-02: Healthcheck uses docker inspect but socket not in volumes',
  edits: [{
    file: 'docker-compose.yml',
    search: 'test: ["CMD", "wget", "-q", "-O-", "http://localhost:3000/health"]',
    replace: 'test: ["CMD", "docker", "inspect", "--format={{.State.Health.Status}}", "app"]'
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'docker.*inspect' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'docker.sock' },
  ],
  expectedSuccess: false,
  tags: ['access', 'cli', 'docker_socket', 'HC-02'],
  rationale: 'Healthcheck runs docker inspect but docker socket is not mounted — command will fail',
});

// HC-02e: Control — compose has socket mounted and runs as root
scenarios.push({
  id: nextId('docker'),
  description: 'HC-02 control: Docker socket mounted and no USER directive (root default)',
  edits: [{
    file: 'docker-compose.yml',
    search: 'retries: 3',
    replace: "retries: 3\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock"
  }],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'docker.sock' },
    { type: 'content', file: 'Dockerfile', pattern: 'FROM node:20-alpine' },
  ],
  expectedSuccess: true,
  tags: ['access', 'cli', 'docker_socket', 'HC-02', 'control'],
  rationale: 'Socket mounted and default root user — docker commands will work',
});

// =============================================================================
// Shape HC-03: SSH key rejected
// Config references one SSH key path, .env or another config has a different
// key path. Cross-source: the key the process will use differs from what
// the target expects.
// =============================================================================

// HC-03a: Config has SSH key path, .env has different path
scenarios.push({
  id: nextId('ssh'),
  description: 'HC-03: config.json SSH key is id_rsa but .env says id_ed25519',
  edits: [
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": false,\n    "sshKey": "~/.ssh/id_rsa"' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nSSH_KEY_PATH=~/.ssh/id_ed25519' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'id_rsa' },
    { type: 'content', file: '.env', pattern: 'id_ed25519' },
  ],
  expectedSuccess: true,
  tags: ['access', 'cli', 'ssh_key_rejected', 'HC-03'],
  rationale: 'Config and .env reference different SSH keys — which one is used depends on code, but theyre inconsistent',
});

// HC-03b: Server references SSH key, Dockerfile doesn't COPY it
scenarios.push({
  id: nextId('ssh'),
  description: 'HC-03: Server uses SSH key at /app/.ssh/deploy_key but Dockerfile doesnt COPY it',
  edits: [{
    file: 'server.js',
    search: "const PORT = process.env.PORT || 3000;",
    replace: "const PORT = process.env.PORT || 3000;\nconst SSH_KEY = '/app/.ssh/deploy_key';"
  }],
  predicates: [
    { type: 'content', file: 'server.js', pattern: '/app/.ssh/deploy_key' },
    { type: 'content', file: 'Dockerfile', pattern: '.ssh/deploy_key' },
  ],
  expectedSuccess: false,
  tags: ['access', 'cli', 'ssh_key_rejected', 'HC-03'],
  rationale: 'Server references SSH key but Dockerfile never COPYs it — file wont exist in container',
});

// HC-03c: Compose SSH agent forwarding but .env has static key path
scenarios.push({
  id: nextId('ssh'),
  description: 'HC-03: Compose forwards SSH_AUTH_SOCK but .env has hardcoded key file',
  edits: [
    { file: 'docker-compose.yml', search: '- PORT=3000', replace: "- PORT=3000\n      - SSH_AUTH_SOCK=/ssh-agent" },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nSSH_KEY_FILE=/home/app/.ssh/id_rsa' },
  ],
  predicates: [
    { type: 'content', file: 'docker-compose.yml', pattern: 'SSH_AUTH_SOCK' },
    { type: 'content', file: '.env', pattern: 'SSH_KEY_FILE' },
  ],
  expectedSuccess: true,
  tags: ['access', 'cli', 'ssh_key_rejected', 'HC-03'],
  rationale: 'Two SSH auth methods configured — agent forwarding AND key file. If agent is empty and key doesnt exist, both fail.',
});

// HC-03d: Config.prod and config.staging have different SSH key references
scenarios.push({
  id: nextId('ssh'),
  description: 'HC-03: config.prod.json and config.staging.json would need different keys',
  edits: [
    { file: 'config.prod.json', search: '"betaSignup": false', replace: '"betaSignup": false,\n    "sshKey": "/secrets/prod_deploy_key"' },
    { file: 'config.staging.json', search: '"betaSignup": true', replace: '"betaSignup": true,\n    "sshKey": "/secrets/staging_deploy_key"' },
  ],
  predicates: [
    { type: 'content', file: 'config.prod.json', pattern: 'prod_deploy_key' },
    { type: 'content', file: 'config.staging.json', pattern: 'staging_deploy_key' },
  ],
  expectedSuccess: true,
  tags: ['access', 'cli', 'ssh_key_rejected', 'HC-03'],
  rationale: 'Different key paths per environment — deploying to prod with staging key will be rejected',
});

// HC-03e: Control — SSH key path consistent across config and env
scenarios.push({
  id: nextId('ssh'),
  description: 'HC-03 control: SSH key path consistent in config.json and .env',
  edits: [
    { file: 'config.json', search: '"analytics": false', replace: '"analytics": false,\n    "sshKey": "~/.ssh/deploy_key"' },
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nSSH_KEY_PATH=~/.ssh/deploy_key' },
  ],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'deploy_key' },
    { type: 'content', file: '.env', pattern: 'deploy_key' },
  ],
  expectedSuccess: true,
  tags: ['access', 'cli', 'ssh_key_rejected', 'HC-03', 'control'],
  rationale: 'Same SSH key path in both sources — no access mismatch',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} access-cli scenarios -> ${outPath}`);
