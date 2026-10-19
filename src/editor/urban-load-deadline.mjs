// Reject stale GLTF / IndexedDB work that has stopped settling, rather than
// leaving the full-quality city loader spinning forever. This NEVER returns
// a placeholder mesh or declares an incomplete scene ready.
export function withUrbanLoadDeadline(label, task, timeoutMs = 90000) {
  if (!label || typeof task !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1)
    throw new TypeError('Invalid Urban Photoreal loader deadline');
  let timeout;
  const limit = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(
      label + ': operazione HD non completata entro ' + Math.ceil(timeoutMs / 1000) +
      's; nessun asset sostitutivo utilizzato. Riprova il caricamento.'
    )), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(task), limit]).finally(() => clearTimeout(timeout));
}
