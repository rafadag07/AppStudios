import test from "node:test";
import assert from "node:assert/strict";
import {
  canOpenOfflineAccount,
  hasProtectedLocalChanges,
  shouldKeepLocalOnOpen,
  shouldResetAccountForSessionChange,
} from "../src/data/syncSafety.js";

test("una copia local pendiente tiene prioridad al volver a abrir", () => {
  const snapshot = { data: { subjects: [{ id: "local" }] }, pendingSync: true };
  assert.equal(hasProtectedLocalChanges(snapshot), true);
  assert.equal(shouldKeepLocalOnOpen(snapshot), true);
});

test("las copias anteriores a la proteccion se conservan una vez", () => {
  const legacySnapshot = { data: { subjects: [{ id: "existing-work" }] } };
  assert.equal(hasProtectedLocalChanges(legacySnapshot), true);
});

test("la nube solo puede aplicarse si la copia local confirma estar sincronizada", () => {
  const syncedSnapshot = { data: { subjects: [] }, pendingSync: false };
  assert.equal(shouldKeepLocalOnOpen(syncedSnapshot), false);
});

test("un registro sin datos no bloquea la primera descarga", () => {
  assert.equal(hasProtectedLocalChanges({ pendingSync: true }), false);
  assert.equal(hasProtectedLocalChanges(null), false);
});

test("una pausa de Supabase no impide abrir la copia local existente", () => {
  assert.equal(canOpenOfflineAccount({ data: { subjects: [{ id: "offline" }] } }), true);
  assert.equal(canOpenOfflineAccount({}), false);
});

test("renovar el token del mismo usuario no reinicia la cuenta", () => {
  assert.equal(shouldResetAccountForSessionChange("rafa", "rafa"), false);
  assert.equal(shouldResetAccountForSessionChange("rafa", "otro"), true);
  assert.equal(shouldResetAccountForSessionChange("rafa", null), true);
});
