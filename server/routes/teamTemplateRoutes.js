import { valuesEqual } from '../services/sessionGuard.js';

/**
 * Custom retro and health-check templates, one at a time (incident ISS).
 *
 * Both lists used to be written whole through `/api/team/:teamId/update`, which
 * stored whatever the caller had cached with no revision to check against. A
 * tab left open on an old Dashboard that added or deleted a template therefore
 * erased every template added elsewhere since it loaded — the same class as the
 * live retro the incident lost. Each route here names one template and changes
 * that one, inside the team-record compare-and-swap.
 *
 * Success follows the write (audit H34): an updater that finds nothing aborts,
 * which the store reports as "nothing to change", so a delete that matched
 * nothing answers 404 rather than a success for a write that never happened.
 */

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

// The retro template that a save stores, or null when the request does not
// describe one. Only the two fields a `Template` has are kept.
const toStoredRetroTemplate = (template) => {
  if (!isPlainObject(template) || typeof template.name !== 'string') return null;
  const name = template.name.trim();
  if (!name || !Array.isArray(template.cols) || template.cols.length === 0) return null;
  return { name, cols: template.cols };
};

// A delete checks the shape only, not the save rules: a template stored before
// names were validated can carry a blank name and must stay deletable.
const isRetroTemplateShape = (template) =>
  isPlainObject(template) && typeof template.name === 'string' && Array.isArray(template.cols);

// A retro template has no id and its name is not unique, so it is identified by
// its whole content. That is also what keeps a stale caller honest: it can only
// delete a template it has actually seen, never one saved or edited since.
const isSameRetroTemplate = (stored, requested) =>
  isPlainObject(stored) &&
  valuesEqual({ name: stored.name, cols: stored.cols }, { name: requested.name, cols: requested.cols });

const toStoredHealthCheckTemplate = (template) => {
  if (!isPlainObject(template)) return null;
  if (typeof template.id !== 'string' || !template.id) return null;
  if (typeof template.name !== 'string' || !template.name.trim()) return null;
  if (!Array.isArray(template.dimensions)) return null;
  return { ...template, name: template.name.trim() };
};

const registerTeamTemplateRoutes = ({ app, authenticateTeam, atomicUpdateTeam, writeLimiter }) => {
  // Runs one list write for an authenticated team and answers for it. `apply`
  // receives a fresh copy of the team on every compare-and-swap attempt and
  // returns false when it found nothing to change. A save always writes, so
  // the saves pass no `notFoundError`.
  const handleListWrite = (validate, apply, notFoundError, logLabel) => async (req, res) => {
    try {
      const { teamId } = req.params;
      const { password, sessionToken } = req.body || {};

      const { error } = await authenticateTeam(teamId, password, sessionToken);

      if (error) {
        return res.status(401).json({ error });
      }

      const input = validate(req.body || {});
      if (input.error) {
        return res.status(400).json({ error: input.error });
      }

      let found = false;
      const result = await atomicUpdateTeam(teamId, (currentTeam) => {
        found = apply(currentTeam, input.value);
        return found ? currentTeam : null;
      });

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      if (!found) {
        return res.status(404).json({ error: notFoundError });
      }

      res.json({ success: true });
    } catch (err) {
      console.error(`[Server] Failed to ${logLabel}`, err);
      res.status(500).json({ error: 'failed_to_update' });
    }
  };

  const listOf = (team, field) => {
    if (!Array.isArray(team[field])) team[field] = [];
    return team[field];
  };

  // Appends one retro template. Two templates may share a name, as they always
  // could; the Dashboard tells them apart by position.
  app.post('/api/team/:teamId/template/save', writeLimiter, handleListWrite(
    ({ template }) => {
      const stored = toStoredRetroTemplate(template);
      return stored ? { value: stored } : { error: 'invalid_template' };
    },
    (team, stored) => {
      listOf(team, 'customTemplates').push(stored);
      return true;
    },
    null,
    'save template'
  ));

  // Removes the first stored retro template with exactly this content (deep
  // equality, insensitive to key order). Two identical templates are
  // indistinguishable, so removing either is removing "the one clicked".
  app.post('/api/team/:teamId/template/delete', writeLimiter, handleListWrite(
    ({ template }) => (isRetroTemplateShape(template) ? { value: template } : { error: 'invalid_template' }),
    (team, requested) => {
      const list = team.customTemplates;
      if (!Array.isArray(list)) return false;
      const idx = list.findIndex((stored) => isSameRetroTemplate(stored, requested));
      if (idx === -1) return false;
      list.splice(idx, 1);
      return true;
    },
    'template_not_found',
    'delete template'
  ));

  // Health-check templates carry an id, so a save is an upsert by id.
  app.post('/api/team/:teamId/healthcheck-template/save', writeLimiter, handleListWrite(
    ({ template }) => {
      const stored = toStoredHealthCheckTemplate(template);
      return stored ? { value: stored } : { error: 'invalid_template' };
    },
    (team, stored) => {
      const list = listOf(team, 'customHealthCheckTemplates');
      const idx = list.findIndex((existing) => existing && existing.id === stored.id);
      if (idx === -1) list.push(stored);
      else list[idx] = stored;
      return true;
    },
    null,
    'save health-check template'
  ));

  app.post('/api/team/:teamId/healthcheck-template/delete', writeLimiter, handleListWrite(
    ({ templateId }) => (
      typeof templateId === 'string' && templateId ? { value: templateId } : { error: 'missing_template' }
    ),
    (team, templateId) => {
      const list = team.customHealthCheckTemplates;
      if (!Array.isArray(list)) return false;
      const idx = list.findIndex((existing) => existing && existing.id === templateId);
      if (idx === -1) return false;
      list.splice(idx, 1);
      return true;
    },
    'healthcheck_template_not_found',
    'delete health-check template'
  ));
};

export { registerTeamTemplateRoutes };
