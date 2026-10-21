/**
 * The error handler mounted at the end of a raw-archive route
 * (`/api/super-admin/restore`, `/api/super-admin/backups/import`), so every
 * answer the console reads is JSON.
 *
 * Without it, Express answers the body-limit case with its own HTML 413, which
 * the console cannot tell from the 413 a proxy in front of the application
 * sends (ingress-nginx's 1 MiB default, see k8s/README.md): the first means
 * "the server's RESTORE_MAX_BODY_MB", the second "ask your operator".
 *
 * Only body-parser errors — the ones carrying `err.type` — are the client's
 * fault. Express 5 also forwards a rejected handler here, and a server fault
 * must never read as "your file is bad":
 *
 *   entity.too.large  → 413 { error: 'backup_file_too_large', maxBytes }
 *   request.aborted   → nothing (the client is gone)
 *   any other type    → 400 { error: 'invalid_backup_format' }
 *   no type           → 500 { error: failedError }, logged
 *
 * `beforeAnswer(req, res)` runs first, whatever the error: the import route
 * releases its per-pod gate there.
 */
export const createArchiveBodyErrorHandler = ({ maxBytes, failedError, logMessage, beforeAnswer = () => {} }) =>
  // Four parameters: that is how Express recognises an error handler.
  (err, req, res, _next) => {
    beforeAnswer(req, res);
    if (err?.type === 'request.aborted') return undefined;
    if (res.headersSent) return undefined;
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'backup_file_too_large', maxBytes });
    }
    if (err?.type) return res.status(400).json({ error: 'invalid_backup_format' });
    console.error(logMessage, err);
    return res.status(500).json({ error: failedError });
  };
