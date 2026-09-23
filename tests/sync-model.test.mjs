import test from 'node:test';
import assert from 'node:assert/strict';
import { TestServer, TestDevice, previewImport } from '../lab/sync-model.js';
import { audit } from '../tools/backup-audit.mjs';
const setup = () => {
  const server = new TestServer();
  const a = new TestDevice('pc', {}, server), b = new TestDevice('tablet', {}, server);
  a.login('ana'); b.login('ana');
  return { server, a, b };
};
test('sin conexión, reinicio y llegada al otro dispositivo', () => {
  const { server, a, b } = setup(); a.online = false; a.edit('theme:1', 'Apunte sin red'); a.sync();
  assert.equal(server.read('ana').length, 0);
  const reopened = new TestDevice('pc', a.disk, server); reopened.login('ana'); reopened.sync(); b.sync();
  assert.equal(b.view('theme:1'), 'Apunte sin red');
});
test('ediciones simultáneas conservan ambas versiones y resolución recuperable', () => {
  const { a, b } = setup(); a.edit('theme:1', 'Original'); a.sync(); b.sync();
  a.edit('theme:1', 'PC'); b.edit('theme:1', 'Tablet'); a.sync(); b.sync();
  let row = b.state.records[0];
  assert.equal(row.versions.length, 3); assert.equal(row.conflicts.length, 1);
  assert.deepEqual(row.versions.map(v => v.value), ['Original', 'PC', 'Tablet']);
  b.edit('theme:1', 'Tablet', row.conflicts); b.sync(); a.sync(); row = a.state.records[0];
  assert.equal(row.conflicts.length, 0); assert.equal(row.versions.length, 4); assert.equal(row.value, 'Tablet');
});
test('reintento después de perder respuesta no duplica una versión', () => {
  const { server, a } = setup(); a.edit('task:1', { done: true });
  const op = a.state.pending[0]; server.push('ana', op); a.sync();
  assert.equal(server.read('ana')[0].versions.length, 1);
});
test('cambio de cuenta preserva cola y evita subir los datos de otra', () => {
  const { server, a } = setup(); a.edit('theme:1', 'Privado'); const op = a.state.pending[0];
  a.login('bea'); a.sync(); assert.equal(a.view('theme:1'), null);
  assert.throws(() => server.push('bea', op)); assert.equal(server.read('bea').length, 0);
  a.login('ana'); a.sync(); assert.equal(a.view('theme:1'), 'Privado');
});
test('registro/inicio de sesión no importa ni modifica el legado', () => {
  const { a } = setup(); const legacy = [{ entity: 'theme:1', value: 'Legado' }];
  const before = JSON.stringify(legacy); const preview = previewImport(legacy, []);
  assert.equal(preview[0].action, 'Añadir'); assert.equal(a.state.pending.length, 0);
  assert.equal(JSON.stringify(legacy), before);
});
test('borrar es una versión y compite de forma segura con editar', () => {
  const { a, b } = setup(); a.edit('task:1', { title: 'Ejemplo' }); a.sync(); b.sync();
  a.edit('task:1', null); b.edit('task:1', { title: 'Editada' }); a.sync(); b.sync();
  assert.equal(b.state.records[0].conflicts.length, 1);
  assert.equal(b.state.records[0].versions[1].value, null);
});
test('asignaturas, preguntas, tareas y Pomodoro usan el mismo protocolo', () => {
  const { a, b } = setup();
  for (const entity of ['subject:1', 'question:1', 'task:1', 'pomodoro:1', 'settings:pomodoro']) a.edit(entity, { test: entity });
  a.sync(); b.sync(); assert.equal(b.state.records.length, 5);
});
test('una copia sin adjuntos no se presenta como completa', () => {
  const report = audit({ subjects: [{ themes: [{ media: [{ fileId: 'file_missing' }] }] }] });
  assert.deepEqual(report.missingFiles, ['file_missing']); assert.equal(report.pomodoroSessions, null);
});
