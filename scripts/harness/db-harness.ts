/**
 * DB Harness — Ephemeral Postgres for Verification Testing
 * =========================================================
 *
 * Manages a Postgres container lifecycle for DB predicate testing.
 * Uses docker-compose.test.yml which adds a Postgres service alongside
 * the demo app. Provides exec() for running SQL against the live DB.
 *
 * Lifecycle:
 *   start() → runs docker compose up, waits for both app + db healthy
 *   query() → runs psql inside the db container
 *   exec()  → runs arbitrary command in the app container
 *   stop()  → tears down containers and volumes
 *
 * All state is ephemeral — tmpfs for PG data, unique project names.
 */

import { spawn } from 'child_process';
import { join } from 'path';

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class DBHarness {
  private readonly appDir: string;
  private readonly projectName: string;
  private readonly composefile = 'docker-compose.test.yml';
  private hostPort: number;
  private running = false;

  constructor(appDir: string) {
    this.appDir = appDir;
    this.projectName = `verify-db-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.hostPort = 13000 + Math.floor(Math.random() * 1000);
  }

  /** Start both app + db containers. Returns when both are healthy. */
  async start(timeoutMs = 90_000): Promise<void> {
    const result = await this.compose([
      'up', '-d', '--build',
    ], {
      timeoutMs: 120_000,
      env: {
        ...process.env,
        VERIFY_HOST_PORT: String(this.hostPort),
      },
    });

    if (result.exitCode !== 0) {
      throw new Error(`docker compose up failed: ${result.stderr}`);
    }

    // Wait for db to be ready (pg_isready via healthcheck)
    const deadline = Date.now() + timeoutMs;
    let dbReady = false;
    while (Date.now() < deadline) {
      const check = await this.compose(['ps', '--format', 'json'], { timeoutMs: 10_000 });
      // Check if db service is healthy
      if (check.stdout.includes('"Health":"healthy"') || check.stdout.includes('"healthy"')) {
        // Also verify we can actually query
        const ping = await this.query('SELECT 1 AS ok');
        if (ping.exitCode === 0 && ping.stdout.includes('1')) {
          dbReady = true;
          break;
        }
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!dbReady) {
      const logs = await this.compose(['logs', '--tail', '30', 'db'], { timeoutMs: 10_000 });
      await this.stop();
      throw new Error(`Postgres failed to start within ${timeoutMs}ms.\nLogs:\n${logs.stdout}\n${logs.stderr}`);
    }

    // Wait for app to be healthy too
    let appHealthy = false;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`http://localhost:${this.hostPort}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        if (resp.status < 500) { appHealthy = true; break; }
      } catch { /* not ready */ }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!appHealthy) {
      const logs = await this.compose(['logs', '--tail', '30', 'app'], { timeoutMs: 10_000 });
      await this.stop();
      throw new Error(`App failed health check within ${timeoutMs}ms.\nLogs:\n${logs.stdout}\n${logs.stderr}`);
    }

    this.running = true;
  }

  /** Run SQL query against the Postgres instance. */
  async query(sql: string, timeoutMs = 10_000): Promise<CommandResult> {
    return this.run('docker', [
      'exec', '-i', `${this.projectName}-db-1`,
      'psql', '-U', 'verify', '-d', 'verifytest', '-t', '-A', '-c', sql,
    ], { timeoutMs });
  }

  /** Run command inside the app container. */
  async exec(command: string, timeoutMs = 10_000): Promise<CommandResult> {
    return this.run('docker', [
      'exec', `${this.projectName}-app-1`,
      'sh', '-c', command,
    ], { timeoutMs });
  }

  /** Get the app's URL. */
  getAppUrl(): string {
    return `http://localhost:${this.hostPort}`;
  }

  /** Tear down everything. */
  async stop(): Promise<void> {
    if (!this.running) return;
    try {
      await this.compose(['down', '-v', '--remove-orphans'], { timeoutMs: 30_000 });
    } catch { /* best effort */ }
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  // ---------- internals ----------

  private compose(args: string[], opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv }): Promise<CommandResult> {
    return this.run('docker', [
      'compose', '-f', this.composefile, '-p', this.projectName,
      ...args,
    ], { ...opts, cwd: this.appDir });
  }

  private run(
    cmd: string,
    args: string[],
    opts?: { timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv },
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd: opts?.cwd ?? this.appDir,
        env: opts?.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

      const timer = opts?.timeoutMs
        ? setTimeout(() => {
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 5000);
          }, opts.timeoutMs)
        : undefined;

      child.on('close', (code: number | null) => {
        if (timer) clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      child.on('error', (err: Error) => {
        if (timer) clearTimeout(timer);
        resolve({ stdout, stderr: err.message, exitCode: 1 });
      });
    });
  }
}

/** Quick check if Docker + Postgres image is available. */
export async function isDockerWithPostgresAvailable(): Promise<boolean> {
  try {
    const result = await new Promise<{ exitCode: number }>((resolve) => {
      const child = spawn('docker', ['info'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
      child.on('close', (code) => resolve({ exitCode: code ?? 1 }));
      child.on('error', () => resolve({ exitCode: 1 }));
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
