export function hasProtectedLocalChanges(snapshot) {
  if (!snapshot?.data) return false;
  // Older snapshots did not include pendingSync. Treat them as pending once so
  // upgrading the app can never discard work saved before this safeguard.
  return snapshot.pendingSync !== false;
}

export function shouldKeepLocalOnOpen(snapshot) {
  return hasProtectedLocalChanges(snapshot);
}

export function canOpenOfflineAccount(snapshot) {
  return Boolean(snapshot?.data);
}

export function shouldResetAccountForSessionChange(currentUserId, nextUserId) {
  return (currentUserId || null) !== (nextUserId || null);
}
