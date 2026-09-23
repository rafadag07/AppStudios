import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const routes = { '/': ['../lab/index.html', 'text/html'], '/sync-model.js': ['../lab/sync-model.js', 'text/javascript'] };
createServer(async (req, res) => {
  const route = routes[req.url];
  if (req.method !== 'GET' || !route) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', `${route[1]}; charset=utf-8`);
  res.setHeader('Cache-Control', 'no-store');
  res.end(await readFile(new URL(route[0], import.meta.url)));
}).listen(4178, '127.0.0.1', () => console.log('Ensayo aislado: http://127.0.0.1:4178 (solo sirve los dos archivos del laboratorio)'));
