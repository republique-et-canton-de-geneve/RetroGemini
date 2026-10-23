/**
 * The super-admin credential for the routes whose body is a raw archive
 * (`/api/super-admin/restore`, `/api/super-admin/backups/import`).
 *
 * Their body is not JSON, so the credential travels in headers —
 * `x-super-admin-password` or `x-super-admin-session-token` — and is checked
 * **before** the body parser runs: an unauthenticated caller is answered 401
 * before one byte of a (possibly 128 MB) upload is buffered. Mount it ahead of
 * `express.raw(...)` in the route's middleware chain; that order is what the
 * route suites pin.
 *
 * A factory rather than a `const` in `registerSuperAdminRoutes` because two
 * registrars need it, and one of them is called before that `const` would be
 * defined.
 */
export const createSuperAdminHeaderAuth = (tokenService) => (req, res, next) => {
  const password = req.header('x-super-admin-password');
  const sessionToken = req.header('x-super-admin-session-token');

  if (!tokenService.validateSuperAdminAuth({ password, sessionToken })) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  return next();
};
