// Protocolo de referencia para el laboratorio. No conecta con servicios reales.
const clone = value => structuredClone(value);
export class TestServer {
  constructor() { this.accounts = new Map(); this.receipts = new Map(); }
  read(user) { return clone([...this.accounts.get(user)?.values() || []]); }
  push(user, op) {
    if (!user || op.user !== user) throw new Error('Cuenta incorrecta');
    const receiptKey = `${user}:${op.id}`;
    if (this.receipts.has(receiptKey)) return clone(this.receipts.get(receiptKey));
    if (!this.accounts.has(user)) this.accounts.set(user, new Map());
    const records = this.accounts.get(user);
    const old = records.get(op.entity);
    const revision = { id: op.id, parent: op.base, value: clone(op.value), device: op.device };
    const conflict = (old?.head || null) !== op.base;
    const next = {
      entity: op.entity, head: conflict ? old?.head || null : op.id,
      value: conflict ? old?.value ?? null : clone(op.value),
      versions: [...old?.versions || [], revision],
      conflicts: [...old?.conflicts || [], ...(conflict ? [op.id] : [])],
    };
    // A resolution is also a version; earlier content is retained.
    if (!conflict && op.resolves) next.conflicts = next.conflicts.filter(id => !op.resolves.includes(id));
    records.set(op.entity, next);
    const receipt = { conflict, record: next };
    this.receipts.set(receiptKey, clone(receipt));
    return clone(receipt);
  }
}

export class TestDevice {
  constructor(device, disk, server) {
    this.device = device; this.disk = disk; this.server = server; this.online = true; this.user = null;
  }
  login(user) {
    this.user = user;
    this.state = clone(this.disk[user] || { records: [], pending: [] });
    this.persist();
  }
  persist() { this.disk[this.user] = clone(this.state); }
  edit(entity, value, resolves = []) {
    if (!this.user) throw new Error('Inicia sesión');
    const pending = this.state.pending.filter(op => op.entity === entity).at(-1);
    const current = this.state.records.find(row => row.entity === entity);
    this.state.pending.push({ id: crypto.randomUUID(), user: this.user, device: this.device, entity,
      base: pending?.id || current?.head || null, value: clone(value), resolves });
    this.persist(); // Cola antes de cualquier petición.
  }
  sync() {
    if (!this.user || !this.online) return;
    while (this.state.pending.length) {
      const op = this.state.pending[0];
      this.server.push(this.user, op);
      this.state.pending.shift(); this.persist();
    }
    this.state.records = this.server.read(this.user); this.persist();
  }
  view(entity) {
    const pending = this.state.pending.filter(op => op.entity === entity).at(-1);
    return clone(pending ? pending.value : this.state.records.find(row => row.entity === entity)?.value ?? null);
  }
}

export function previewImport(localRecords, accountRecords) {
  return localRecords.map(record => {
    const current = accountRecords.find(row => row.entity === record.entity);
    return { ...clone(record), action: !current ? 'Añadir' : JSON.stringify(current.value) === JSON.stringify(record.value) ? 'Ya existe' : 'Revisar dos versiones' };
  });
}
