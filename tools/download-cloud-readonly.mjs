import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { audit, sha256 } from './backup-audit.mjs';

// Solo GET al origen explícito del usuario. Nunca importa ni sobrescribe datos.
const origin = 'https://appstudios.vercel.app';
const destination = resolve('backups-private', `cloud-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(destination, { recursive: true });
async function get(path) {
  const response = await fetch(`${origin}${path}`, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`GET: HTTP ${response.status}`);
  return response.json();
}
const manifest = await get('/api/appstudios-sync');
await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest));
let payload = manifest.data;
if (manifest.chunks) {
  const { uploadId, total } = manifest.chunks;
  if (!Number.isInteger(total) || total < 1 || total > 10000) throw new Error('Número de partes inválido');
  let text = '';
  for (let index = 0; index < total; index++) {
    const part = await get(`/api/appstudios-sync?uploadId=${encodeURIComponent(uploadId)}&chunk=${index}`);
    if (typeof part.chunk !== 'string') throw new Error(`Falta parte ${index}`);
    await writeFile(join(destination, `chunk-${index}.txt`), part.chunk);
    text += part.chunk;
  }
  payload = JSON.parse(manifest.encoding === 'json-chunked' ? text : gunzipSync(Buffer.from(text, 'base64')).toString('utf8'));
} else if (manifest.compressedData) payload = JSON.parse(gunzipSync(Buffer.from(manifest.compressedData, 'base64')).toString('utf8'));
if (!payload) throw new Error('No hay datos en la nube');
const finalManifest = await get('/api/appstudios-sync');
if (manifest.sha !== finalManifest.sha || manifest.updatedAt !== finalManifest.updatedAt) throw new Error('La nube cambió durante la descarga; repetir antes de verificar');
const bytes = JSON.stringify(payload);
await writeFile(join(destination, 'reconstructed.json'), bytes);
const report = { origin, downloadedAt: new Date().toISOString(), cloudDate: manifest.updatedAt, sourceSha: manifest.sha, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes), ...audit(payload) };
await writeFile(join(destination, 'verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ destination, ...report }, null, 2));
