import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function audit(payload) {
  const data = payload.data?.subjects ? payload.data : payload.appData?.subjects ? payload.appData : payload;
  if (!Array.isArray(data.subjects)) throw new Error('No contiene asignaturas: no se considera una copia válida.');
  const references = new Set();
  let embeddedImages = 0;
  const visit = value => {
    if (typeof value === 'string') {
      if (value.startsWith('file_') || value.startsWith('remote:')) references.add(value);
      embeddedImages += (value.match(/data:image\//g) || []).length;
    } else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(data);
  const files = payload.files || [];
  const missingFiles = [...references].filter(id => !files.some(file => file.id === id && file.base64));
  const themes = data.subjects.flatMap(subject => subject.themes || []);
  return {
    subjects: data.subjects.length, themes: themes.length,
    documents: themes.filter(theme => theme.documentHtml).length,
    questions: data.subjects.reduce((n, s) => n + (s.qa?.length || 0), 0),
    notes: themes.reduce((n, t) => n + (t.notes?.length || 0), 0),
    tasks: data.tasks?.length || 0, events: data.events?.length || 0,
    pomodoroSessions: payload.pomodoro?.history?.length ?? null,
    embeddedImages, referencedFiles: references.size, includedFiles: files.length, missingFiles,
    warning: 'Integridad del archivo comprobable; comparar contenido y fecha con cada dispositivo. No demuestra que sea la copia más reciente.',
  };
}

async function verify(path) {
  const bytes = await readFile(path);
  const envelope = JSON.parse(bytes.toString('utf8'));
  const payload = envelope.payload || envelope;
  if (envelope.payload && envelope.sha256 !== sha256(JSON.stringify(payload))) throw new Error('SHA-256 del contenido incorrecto');
  for (const file of payload.files || []) {
    const content = Buffer.from(file.base64, 'base64');
    if (content.length !== file.size || sha256(content) !== file.sha256) throw new Error(`Adjunto corrupto: ${file.id}`);
  }
  const report = { file: resolve(path), bytes: bytes.length, sha256: sha256(bytes), ...audit(payload) };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

async function archiveCheckout() {
  const source = resolve('appstudios-cloud');
  const destination = resolve('backups-private', `checkout-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(destination, { recursive: true });
  const hashes = [];
  async function copyTree(from, to) {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      if (entry.isDirectory()) await copyTree(join(from, entry.name), join(to, entry.name));
      else if (entry.isFile()) {
        await copyFile(join(from, entry.name), join(to, entry.name));
        const a = await readFile(join(from, entry.name));
        const b = await readFile(join(to, entry.name));
        if (sha256(a) !== sha256(b)) throw new Error('La copia no coincide');
        hashes.push({ path: join(to, entry.name).slice(destination.length + 1), bytes: a.length, sha256: sha256(b) });
      }
    }
  }
  await copyTree(source, join(destination, 'raw'));
  const manifest = JSON.parse(await readFile(join(destination, 'raw/data.json'), 'utf8'));
  let payload = manifest.data;
  if (manifest.chunks) {
    const { uploadId, total } = manifest.chunks;
    if (!/^copy-[a-zA-Z0-9-]+$/.test(uploadId) || !Number.isInteger(total) || total < 1) throw new Error('Manifiesto no válido');
    let text = '';
    for (let i = 0; i < total; i++) text += await readFile(join(destination, 'raw/chunks', uploadId, `${i}.txt`), 'utf8');
    payload = JSON.parse(manifest.encoding === 'json-chunked' ? text : gunzipSync(Buffer.from(text, 'base64')).toString('utf8'));
  } else if (manifest.compressedData) payload = JSON.parse(gunzipSync(Buffer.from(manifest.compressedData, 'base64')).toString('utf8'));
  if (!payload) throw new Error('Formato no reconocido');
  const output = join(destination, 'reconstructed.json');
  await writeFile(output, JSON.stringify(payload));
  const report = await verify(output);
  await writeFile(join(destination, 'verification.json'), JSON.stringify({ source: 'Copia del checkout local; NO se ha verificado contra GitHub actual', cloudManifestDate: manifest.updatedAt, rawFiles: hashes, report }, null, 2));
  console.log(`Copia independiente del checkout: ${destination}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(.:\/)/, '$1'))) {
  if (process.argv[2] === '--archive-checkout') await archiveCheckout();
  else if (process.argv[2]) await verify(process.argv[2]);
  else console.log('node tools/backup-audit.mjs --archive-checkout | RUTA_JSON');
}
