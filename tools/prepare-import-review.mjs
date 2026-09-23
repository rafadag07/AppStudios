import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { audit, sha256 } from './backup-audit.mjs';
const [source, destination] = process.argv.slice(2);
if (!source || !destination || resolve(source) === resolve(destination)) throw new Error('Indica origen y un archivo de revisión NUEVO diferente.');
const bytes = await readFile(source);
const envelope = JSON.parse(bytes.toString('utf8'));
const payload = envelope.payload || envelope;
if (envelope.payload && envelope.sha256 !== sha256(JSON.stringify(payload))) throw new Error('Firma de copia incorrecta');
const data = payload.data?.subjects ? payload.data : payload;
const summary = audit(payload);
const records = [];
const add = (type, value, path) => records.push({ type, sourceId: value?.id || null, sourcePath: path,
  title: value?.name || value?.title || null, bytes: Buffer.byteLength(JSON.stringify(value)),
  sha256: sha256(JSON.stringify(value)), selected: false, proposedAction: 'Revisar antes de añadir; destino todavía no consultado' });
for (const [index, subject] of data.subjects.entries()) {
  add('subject', subject, `data.subjects[${index}]`);
  for (const [i, theme] of (subject.themes || []).entries()) add('theme', theme, `data.subjects[${index}].themes[${i}]`);
  for (const [i, question] of (subject.qa || []).entries()) add('question', question, `data.subjects[${index}].qa[${i}]`);
}
for (const key of ['tasks','resources','events','scheduleBlocks']) for (const [i, record] of (data[key] || []).entries()) add(key, record, `data.${key}[${i}]`);
for (const [i, session] of (payload.pomodoro?.history || []).entries()) add('pomodoro-session', session, `pomodoro.history[${i}]`);
const review = {
  format: 'appstudios-import-review-v1', createdAt: new Date().toISOString(), source: resolve(source),
  sourceSha256: sha256(bytes), targetAccount: null, writesPerformed: 0, importAllowed: false,
  blockers: ['Falta verificar adjuntos y otras copias', 'Falta elegir cuenta y comparar su contenido', 'Falta ensayo real contra Supabase con usuarios de prueba', 'Falta confirmación de selección y plan definitivo'],
  note: 'Inventario de revisión, no instrucciones ejecutables de importación. Las filas padre incluyen hijos en su hash; no sumarlas como tamaños independientes. Se preserva el JSON original entero para no perder campos desconocidos.',
  summary, records,
  unknownTopLevelKeys: Object.keys(data).filter(key => !['subjects','tasks','resources','events','scheduleBlocks'].includes(key)),
  pomodoroKeys: Object.keys(payload.pomodoro || {}),
};
await writeFile(destination, JSON.stringify(review, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ destination: resolve(destination), reviewRows: records.length, importAllowed: false, sourceSha256: review.sourceSha256 }, null, 2));
