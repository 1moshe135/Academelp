#!/usr/bin/env node
/*
 * Academelp local server — serves the app and persists tasks to data.json
 * in this folder, so they survive browser data cleanups. No dependencies.
 *
 * Run: node server.js   (or double-click start.command on macOS)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || ROOT;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const PORT = process.env.PORT || 8642;
const HOST = process.env.HOST || '127.0.0.1';

fs.mkdirSync(DATA_DIR, { recursive: true });
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  if (url === '/api/tasks') {
    if (req.method === 'GET') {
      let body = '[]';
      try { body = fs.readFileSync(DATA_FILE, 'utf8'); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(body);
    }
    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          if (!Array.isArray(JSON.parse(text))) throw new Error('not an array');
          const tmp = DATA_FILE + '.tmp';
          fs.writeFileSync(tmp, text);
          fs.renameSync(tmp, DATA_FILE);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400);
          res.end('invalid tasks payload');
        }
      });
      return;
    }
    res.writeHead(405);
    return res.end();
  }

  const file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  const url = 'http://localhost:' + PORT;
  console.log('Academelp running at ' + url);
  console.log('Tasks are saved to ' + DATA_FILE);
  if (process.platform === 'darwin' && !process.env.NO_OPEN) execFile('open', [url]);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
