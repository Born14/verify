#!/usr/bin/env bun
/**
 * Access × Database scenario generator
 * Grid cell: H×4
 * Shapes: HD-01 (missing GRANT), HD-02 (connection denied), HD-03 (schema-level restriction)
 *
 * These scenarios test whether verify detects database ACCESS failures — the
 * table/column exists but the role lacks permission to read/write/alter it.
 * Key distinction from State Assumption: the schema is correct, but the
 * permission grants don't match what the application expects.
 *
 * Run: bun scripts/harvest/stage-access-db.ts
 */
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const outPath = resolve('fixtures/scenarios/access-db-staged.json');
const demoDir = resolve('fixtures/demo-app');

const scenarios: any[] = [];
let counter = 0;
function nextId(prefix: string): string {
  return `hd-${prefix}-${String(++counter).padStart(3, '0')}`;
}

// Read real fixture content
const initSqlContent = readFileSync(resolve(demoDir, 'init.sql'), 'utf-8');
const configContent = readFileSync(resolve(demoDir, 'config.json'), 'utf-8');
const envContent = readFileSync(resolve(demoDir, '.env'), 'utf-8');
const serverContent = readFileSync(resolve(demoDir, 'server.js'), 'utf-8');
const composeContent = readFileSync(resolve(demoDir, 'docker-compose.yml'), 'utf-8');

// =============================================================================
// Shape HD-01: Missing GRANT — table exists but role lacks permission
// init.sql creates tables but doesn't GRANT appropriate privileges to the
// application role. The predicate checks for data access that would fail
// at runtime due to missing permissions.
// =============================================================================

// HD-01a: Table created but no GRANT for app role
scenarios.push({
  id: nextId('grant'),
  description: 'HD-01: init.sql creates users table but no GRANT to app_user role',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE users (',
    replace: `CREATE ROLE app_user LOGIN PASSWORD 'app123';
CREATE TABLE users (`
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'CREATE ROLE app_user' },
    { type: 'content', file: 'init.sql', pattern: 'GRANT.*app_user' },
  ],
  expectedSuccess: false,
  tags: ['access', 'database', 'missing_grant', 'HD-01'],
  rationale: 'Role app_user created but no GRANT statement exists — SELECT/INSERT will fail',
});

// HD-01b: Server references INSERT but init.sql has no INSERT grant
scenarios.push({
  id: nextId('grant'),
  description: 'HD-01: Server does INSERT INTO posts but no INSERT grant in init.sql',
  edits: [
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\n// INSERT INTO posts (user_id, title) VALUES ($1, $2)" },
    { file: 'init.sql', search: 'CREATE TABLE posts (', replace: "GRANT SELECT ON posts TO app_user;\nCREATE TABLE posts (" },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'INSERT INTO posts' },
    { type: 'content', file: 'init.sql', pattern: 'GRANT INSERT' },
  ],
  expectedSuccess: false,
  tags: ['access', 'database', 'missing_grant', 'HD-01'],
  rationale: 'Server does INSERT but init.sql only GRANTs SELECT — INSERT permission denied',
});

// HD-01c: Migration adds table, no GRANT for any role
scenarios.push({
  id: nextId('grant'),
  description: 'HD-01: Agent adds audit_log table but no GRANT statement for any role',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: `CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    action VARCHAR(100) NOT NULL,
    performed_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (`
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE audit_log' },
    { type: 'content', file: 'init.sql', pattern: 'GRANT.*audit_log' },
  ],
  expectedSuccess: false,
  tags: ['access', 'database', 'missing_grant', 'HD-01'],
  rationale: 'audit_log table created but no GRANT — no role can access it',
});

// HD-01d: ALTER TABLE but no ALTER grant
scenarios.push({
  id: nextId('grant'),
  description: 'HD-01: Server runs ALTER TABLE users but init.sql grants only SELECT/INSERT',
  edits: [
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\n// ALTER TABLE users ADD COLUMN avatar TEXT;" },
    { file: 'init.sql', search: 'CREATE TABLE settings (', replace: "GRANT SELECT, INSERT ON users TO app_user;\n\nCREATE TABLE settings (" },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'ALTER TABLE users' },
    { type: 'content', file: 'init.sql', pattern: 'GRANT.*ALTER' },
  ],
  expectedSuccess: false,
  tags: ['access', 'database', 'missing_grant', 'HD-01'],
  rationale: 'Server runs ALTER but only SELECT/INSERT granted — ALTER requires table ownership or explicit grant',
});

// HD-01e: DELETE on sessions but only SELECT granted
scenarios.push({
  id: nextId('grant'),
  description: 'HD-01: Server purges expired sessions but init.sql only grants SELECT on sessions',
  edits: [
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\n// DELETE FROM sessions WHERE expires_at < NOW()" },
    { file: 'init.sql', search: 'CREATE INDEX idx_sessions_token', replace: "GRANT SELECT ON sessions TO app_user;\nCREATE INDEX idx_sessions_token" },
  ],
  predicates: [
    { type: 'content', file: 'server.js', pattern: 'DELETE FROM sessions' },
    { type: 'content', file: 'init.sql', pattern: 'GRANT DELETE.*sessions' },
  ],
  expectedSuccess: false,
  tags: ['access', 'database', 'missing_grant', 'HD-01'],
  rationale: 'Server deletes expired sessions but only SELECT granted — DELETE permission denied',
});

// HD-01f: Control — proper grants for all operations
scenarios.push({
  id: nextId('grant'),
  description: 'HD-01 control: init.sql has GRANT ALL on users to app_user',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: "GRANT ALL ON users TO app_user;\nGRANT ALL ON posts TO app_user;\n\nCREATE TABLE settings ("
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'GRANT ALL ON users' },
    { type: 'content', file: 'init.sql', pattern: 'GRANT ALL ON posts' },
  ],
  expectedSuccess: true,
  tags: ['access', 'database', 'missing_grant', 'HD-01', 'control'],
  rationale: 'Proper GRANT ALL on both tables — no permission issues',
});

// =============================================================================
// Shape HD-02: Connection denied — wrong credentials or host not in pg_hba
// .env has database credentials that don't match config.json or init.sql,
// or the connection string references a host/port that would be rejected.
// =============================================================================

// HD-02a: .env DATABASE_URL uses localhost but config.json says remote host
scenarios.push({
  id: nextId('conn'),
  description: 'HD-02: .env DATABASE_URL points to localhost but config.json database host is remote',
  edits: [],
  predicates: [
    { type: 'content', file: '.env', pattern: 'localhost:5432' },
    { type: 'content', file: 'config.json', pattern: '"host": "localhost"' },
  ],
  expectedSuccess: true,
  tags: ['access', 'database', 'connection_denied', 'HD-02', 'control'],
  rationale: 'Both point to localhost — connection config is consistent',
});

// HD-02b: .env has one database name, config.json has another
scenarios.push({
  id: nextId('conn'),
  description: 'HD-02: .env DATABASE_URL says "demo" but config.prod.json says "demo_prod"',
  edits: [],
  predicates: [
    { type: 'content', file: '.env', pattern: '/demo"' },
    { type: 'content', file: 'config.prod.json', pattern: '"name": "demo_prod"' },
  ],
  expectedSuccess: true,
  tags: ['access', 'database', 'connection_denied', 'HD-02'],
  rationale: 'Both patterns exist in their files — but db names mismatch means prod connection will fail',
});

// HD-02c: Agent changes db host in config but not in .env
scenarios.push({
  id: nextId('conn'),
  description: 'HD-02: Config db host changed to remote but .env still says localhost',
  edits: [{ file: 'config.json', search: '"host": "localhost"', replace: '"host": "db-primary.prod.internal"' }],
  predicates: [
    { type: 'content', file: 'config.json', pattern: 'db-primary.prod.internal' },
    { type: 'content', file: '.env', pattern: 'db-primary.prod.internal' },
  ],
  expectedSuccess: false,
  tags: ['access', 'database', 'connection_denied', 'HD-02'],
  rationale: 'Config points to remote host but .env DATABASE_URL still has localhost — connection will use wrong host',
});

// HD-02d: Agent changes .env port but config.json still has old port
scenarios.push({
  id: nextId('conn'),
  description: 'HD-02: .env DATABASE_URL changed to port 5433 but config.json still says 5432',
  edits: [{ file: '.env', search: 'postgres://localhost:5432/demo', replace: 'postgres://localhost:5433/demo' }],
  predicates: [
    { type: 'content', file: '.env', pattern: ':5433/' },
    { type: 'content', file: 'config.json', pattern: '"port": 5432' },
  ],
  expectedSuccess: true,
  tags: ['access', 'database', 'connection_denied', 'HD-02'],
  rationale: '.env port is 5433, config says 5432 — which source wins depends on app, both values present in files',
});

// HD-02e: Agent adds DB credentials to .env but compose has different env vars
scenarios.push({
  id: nextId('conn'),
  description: 'HD-02: .env sets DB_PASSWORD but docker-compose uses POSTGRES_PASSWORD',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nDB_PASSWORD=app_secret_123' },
    { file: 'docker-compose.yml', search: '- PORT=3000', replace: "- PORT=3000\n      - POSTGRES_PASSWORD=different_secret" },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'DB_PASSWORD=app_secret_123' },
    { type: 'content', file: 'docker-compose.yml', pattern: 'POSTGRES_PASSWORD=different_secret' },
  ],
  expectedSuccess: true,
  tags: ['access', 'database', 'connection_denied', 'HD-02'],
  rationale: 'Both passwords exist but differ — app uses DB_PASSWORD, Postgres uses POSTGRES_PASSWORD — auth will fail',
});

// =============================================================================
// Shape HD-03: Schema-level restriction
// Agent targets public schema but table is in a restricted schema, or
// search_path is not configured to find the right schema.
// =============================================================================

// HD-03a: Table created in custom schema, config has no search_path
scenarios.push({
  id: nextId('schema'),
  description: 'HD-03: Table in "restricted" schema but config has no search_path setting',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE users (',
    replace: `CREATE SCHEMA restricted;
CREATE TABLE restricted.users (`
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'CREATE SCHEMA restricted' },
    { type: 'content', file: 'config.json', pattern: 'search_path' },
  ],
  expectedSuccess: false,
  tags: ['access', 'database', 'schema_restriction', 'HD-03'],
  rationale: 'Table in restricted schema but config has no search_path — queries to "users" will fail',
});

// HD-03b: Server queries public.users but init.sql creates in private schema
scenarios.push({
  id: nextId('schema'),
  description: 'HD-03: Server queries "users" but init.sql creates in "app_private" schema',
  edits: [
    { file: 'init.sql', search: 'CREATE TABLE users (', replace: "CREATE SCHEMA app_private;\nCREATE TABLE app_private.users (" },
    { file: 'server.js', search: "const PORT = process.env.PORT || 3000;", replace: "const PORT = process.env.PORT || 3000;\n// SELECT * FROM users WHERE id = $1" },
  ],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'app_private.users' },
    { type: 'content', file: 'server.js', pattern: 'FROM users' },
  ],
  expectedSuccess: true,
  tags: ['access', 'database', 'schema_restriction', 'HD-03'],
  rationale: 'init.sql creates in app_private, server queries unqualified "users" — schema resolution will fail at runtime but both content patterns exist',
});

// HD-03c: GRANT on public schema but table in different schema
scenarios.push({
  id: nextId('schema'),
  description: 'HD-03: GRANT on public schema tables but audit_log in "audit" schema',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: `CREATE SCHEMA audit;
CREATE TABLE audit.audit_log (
    id SERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_user;

CREATE TABLE settings (`
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'GRANT SELECT ON ALL TABLES IN SCHEMA public' },
    { type: 'content', file: 'init.sql', pattern: 'audit.audit_log' },
  ],
  expectedSuccess: true,
  tags: ['access', 'database', 'schema_restriction', 'HD-03'],
  rationale: 'GRANT covers public schema but audit_log is in audit schema — grant does not apply',
});

// HD-03d: Agent sets search_path but doesn't include target schema
scenarios.push({
  id: nextId('schema'),
  description: 'HD-03: .env sets search_path=public but queries reference custom schema tables',
  edits: [
    { file: '.env', search: 'DEBUG=false', replace: 'DEBUG=false\nDB_SEARCH_PATH=public' },
    { file: 'init.sql', search: 'CREATE TABLE users (', replace: "CREATE SCHEMA custom;\nCREATE TABLE custom.users (" },
  ],
  predicates: [
    { type: 'content', file: '.env', pattern: 'DB_SEARCH_PATH=public' },
    { type: 'content', file: 'init.sql', pattern: 'custom.users' },
  ],
  expectedSuccess: true,
  tags: ['access', 'database', 'schema_restriction', 'HD-03'],
  rationale: 'search_path is "public" but table is in "custom" — unqualified queries will not find it',
});

// HD-03e: Control — table in public schema with proper grants
scenarios.push({
  id: nextId('schema'),
  description: 'HD-03 control: Table in public schema with GRANT ALL',
  edits: [{
    file: 'init.sql',
    search: 'CREATE TABLE settings (',
    replace: "GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user;\n\nCREATE TABLE settings ("
  }],
  predicates: [
    { type: 'content', file: 'init.sql', pattern: 'GRANT ALL ON ALL TABLES IN SCHEMA public' },
    { type: 'content', file: 'init.sql', pattern: 'CREATE TABLE users' },
  ],
  expectedSuccess: true,
  tags: ['access', 'database', 'schema_restriction', 'HD-03', 'control'],
  rationale: 'Tables in public schema with GRANT ALL — no schema restriction',
});

// Write output
writeFileSync(outPath, JSON.stringify(scenarios, null, 2));
console.log(`Generated ${scenarios.length} access-db scenarios -> ${outPath}`);
