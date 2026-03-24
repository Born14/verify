/**
 * HTTP Server Mock — Test fixture for P-family scenarios
 * ======================================================
 *
 * A lightweight HTTP server that mimics the demo-app's routes.
 * Starts on a random available port, returns deterministic responses.
 * Used by the self-test harness so P-family scenarios run without Docker.
 *
 * Usage:
 *   const server = await startMockServer();
 *   // server.url is e.g. 'http://localhost:54321'
 *   await stopMockServer(server);
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';

export interface MockServer {
  server: Server;
  url: string;
  port: number;
}

// In-memory state for stateful routes
let items = [
  { id: 1, name: 'Alpha' },
  { id: 2, name: 'Beta' },
];
let nextId = 3;

function resetState() {
  items = [
    { id: 1, name: 'Alpha' },
    { id: 2, name: 'Beta' },
  ];
  nextId = 3;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

function parseUrl(raw: string | undefined): { pathname: string; query: Record<string, string> } {
  const full = raw ?? '/';
  const [pathname, qs] = full.split('?');
  const query: Record<string, string> = {};
  if (qs) {
    for (const pair of qs.split('&')) {
      const [k, v] = pair.split('=');
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
  }
  return { pathname, query };
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void | Promise<void> {
  const { pathname, query } = parseUrl(req.url);
  const method = (req.method ?? 'GET').toUpperCase();

  // =========================================================================
  // Health endpoint
  // =========================================================================
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // =========================================================================
  // GET /api/items — list items (supports ?limit=N)
  // =========================================================================
  if (pathname === '/api/items' && method === 'GET') {
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    const result = limit ? items.slice(0, limit) : items;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // =========================================================================
  // POST /api/items — create item
  // =========================================================================
  if (pathname === '/api/items' && method === 'POST') {
    return (async () => {
      const body = await readBody(req);
      try {
        const data = JSON.parse(body);
        if (!data.name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'name is required' }));
          return;
        }
        const item = { id: nextId++, name: data.name };
        items.push(item);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(item));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    })();
  }

  // =========================================================================
  // PUT /api/items/:id — update item
  // =========================================================================
  const putMatch = pathname.match(/^\/api\/items\/(\d+)$/);
  if (putMatch && method === 'PUT') {
    return (async () => {
      const id = parseInt(putMatch[1], 10);
      const idx = items.findIndex(i => i.id === id);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      const body = await readBody(req);
      try {
        const data = JSON.parse(body);
        items[idx] = { ...items[idx], ...data };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(items[idx]));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    })();
  }

  // =========================================================================
  // DELETE /api/items/:id — delete item
  // =========================================================================
  const deleteMatch = pathname.match(/^\/api\/items\/(\d+)$/);
  if (deleteMatch && method === 'DELETE') {
    const id = parseInt(deleteMatch[1], 10);
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    items.splice(idx, 1);
    res.writeHead(204);
    res.end();
    return;
  }

  // =========================================================================
  // POST /api/echo — echo back the request body
  // =========================================================================
  if (pathname === '/api/echo' && method === 'POST') {
    return (async () => {
      const body = await readBody(req);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ echo: body, timestamp: Date.now() }));
    })();
  }

  // =========================================================================
  // GET /api/slow — delayed response (for timeout testing)
  // =========================================================================
  if (pathname === '/api/slow') {
    const delay = query.delay ? parseInt(query.delay, 10) : 5000;
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'slow', delayMs: delay }));
    }, delay);
    return;
  }

  // =========================================================================
  // GET /redirect — 301 redirect to /health
  // =========================================================================
  if (pathname === '/redirect') {
    res.writeHead(301, { 'Location': '/health' });
    res.end();
    return;
  }

  // =========================================================================
  // GET /redirect-temp — 302 redirect to /api/items
  // =========================================================================
  if (pathname === '/redirect-temp') {
    res.writeHead(302, { 'Location': '/api/items' });
    res.end();
    return;
  }

  // =========================================================================
  // GET /error-page — 500 error with HTML error page
  // =========================================================================
  if (pathname === '/error-page') {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end('<html><body><h1>Internal Server Error</h1><p>Something went wrong</p></body></html>');
    return;
  }

  // =========================================================================
  // GET /text-plain — plain text response
  // =========================================================================
  if (pathname === '/text-plain') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Hello plain text');
    return;
  }

  // =========================================================================
  // GET /headers — returns request headers as JSON
  // =========================================================================
  if (pathname === '/headers') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ headers: req.headers }));
    return;
  }

  // =========================================================================
  // GET /set-cookie — sets a cookie and returns JSON
  // =========================================================================
  if (pathname === '/set-cookie') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'session=abc123; Path=/; HttpOnly',
    });
    res.end(JSON.stringify({ cookieSet: true }));
    return;
  }

  // =========================================================================
  // GET /cache-test — returns with cache headers
  // =========================================================================
  if (pathname === '/cache-test') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
      'ETag': '"v1"',
    });
    res.end(JSON.stringify({ cached: true }));
    return;
  }

  // =========================================================================
  // POST /api/validate — validates input fields
  // =========================================================================
  if (pathname === '/api/validate' && method === 'POST') {
    return (async () => {
      const body = await readBody(req);
      try {
        const data = JSON.parse(body);
        const errors: string[] = [];
        if (!data.email || !data.email.includes('@')) errors.push('invalid email');
        if (!data.name || data.name.length < 2) errors.push('name too short');
        if (errors.length > 0) {
          res.writeHead(422, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ errors }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ valid: true }));
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    })();
  }

  // =========================================================================
  // OPTIONS /api/items — CORS preflight
  // =========================================================================
  if (method === 'OPTIONS' && pathname.startsWith('/api/')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  // =========================================================================
  // GET /admin — protected route (always 401)
  // =========================================================================
  if (pathname === '/admin') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // =========================================================================
  // POST /api/reset — reset server state (for test isolation)
  // =========================================================================
  if (pathname === '/api/reset' && method === 'POST') {
    resetState();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ reset: true }));
    return;
  }

  // =========================================================================
  // Homepage
  // =========================================================================
  if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html><head><title>Demo App</title></head>
<body>
  <h1>Demo App</h1>
  <nav><a href="/">Home</a> <a href="/api/items">API</a></nav>
  <ul><li>Item Alpha</li><li>Item Beta</li></ul>
</body></html>`);
    return;
  }

  // =========================================================================
  // 404 fallback
  // =========================================================================
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', path: pathname }));
}

export function startMockServer(): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    resetState();
    const server = createServer((req, res) => {
      const result = handleRequest(req, res);
      if (result instanceof Promise) {
        result.catch((err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }
      const port = addr.port;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        port,
      });
    });

    server.on('error', reject);
  });
}

export function stopMockServer(mock: MockServer): Promise<void> {
  return new Promise((resolve) => {
    mock.server.close(() => resolve());
    // Force-close after 2s
    setTimeout(() => resolve(), 2000);
  });
}
