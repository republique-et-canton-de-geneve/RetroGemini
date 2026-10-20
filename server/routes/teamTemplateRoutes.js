import rateLimit from 'express-rate-limit';
import { valuesEqual } from '../services/sessionGuard.js';

/**
 * Custom retro and health-check templates, one at a time (incident ISS).
 *
 * Both lists used to be written whole through `/api/team/:teamId/update`, which
 * stored whatever the caller had cached with no revision to check against. A
 * tab left open on an old Dashboard that added or deleted a template therefore
 * erased every template added elsewhere since it loaded — the same class as the
 * live retro the incident lost. Each route here names one template and changes
 * that one, under the team record's write lock.
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

// --- whole lists from a client before these routes (rolling update) --------
// The previous release's Dashboard stays open in browser tabs through a
// rolling update, and nothing makes it reload. It saves a template only by
// sending its whole cached list through `/api/team/:teamId/update`, and then
// adopts the team that route answers with. Ignoring the list there discarded
// every template created or edited from such a tab, and the answer wiped it
// from the tab's own cache as well.
//
// So `/update` merges these two lists instead, and only ever grows them. A
// whole list carries no revision, so a missing entry cannot be told apart
// from one the tab never saw: nothing is ever removed, which is what keeps a
// stale tab from erasing a template saved elsewhere since it loaded. An old
// tab's delete therefore does not stick — the safe way to be wrong, and the
// answer gives the tab the template back. Entries are checked with the same
// rules as the routes above; a malformed one is skipped. Both functions are
// pure: they run inside the team's update, under the row lock.

// Appends every incoming retro template whose content no entry of the list
// already has. Matched on the entry as sent first, so a template stored before
// names were validated (blank or untrimmed) and sent back unchanged is
// recognised rather than saved a second time. Checked against the list as it
// grows, so a tab that queued the same save twice adds it once.
const mergeLegacyRetroTemplates = (storedList, incoming) => {
  const list = Array.isArray(storedList) ? [...storedList] : [];
  let added = 0;
  for (const entry of Array.isArray(incoming) ? incoming : []) {
    if (!isRetroTemplateShape(entry) || list.some((stored) => isSameRetroTemplate(stored, entry))) continue;
    const template = toStoredRetroTemplate(entry);
    if (!template || list.some((stored) => isSameRetroTemplate(stored, template))) continue;
    list.push(template);
    added += 1;
  }
  return { list, added };
};

// Upserts by id, which is what the previous release's
// `saveHealthCheckTemplate` always did: an id the list lacks is added, and an
// id it has with different content is that tab's edit and replaces the entry
// in place. The cost is symmetric to the edit it keeps — a tab holding an
// older copy of a template edited elsewhere puts that copy back — and it is
// bounded to the edit; nothing is lost from the list.
const mergeLegacyHealthCheckTemplates = (storedList, incoming) => {
  const list = Array.isArray(storedList) ? [...storedList] : [];
  let added = 0;
  let replaced = 0;
  for (const entry of Array.isArray(incoming) ? incoming : []) {
    const template = toStoredHealthCheckTemplate(entry);
    if (!template) continue;
    const idx = list.findIndex((existing) => existing && existing.id === template.id);
    if (idx === -1) {
      list.push(template);
      added += 1;
    } else if (!valuesEqual(list[idx], entry) && !valuesEqual(list[idx], template)) {
      list[idx] = template;
      replaced += 1;
    }
  }
  return { list, added, replaced };
};

const registerTeamTemplateRoutes = ({ app, authenticateTeam, atomicUpdateTeam }) => {
  // Created here, like every route module's own limiter, rather than passed in:
  // a limiter that arrives as a parameter is invisible to CodeQL's
  // js/missing-rate-limiting, which then flags write routes that are limited.
  // Same budget as teamRoutes' team write limiter.
  const templateWriteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    message: { error: 'too_many_requests', retryAfter: '1 minute' },
    standardHeaders: true,
    legacyHeaders: false
  });

  // Runs one list write for an authenticated team and answers for it. `apply`
  // receives the team as stored, under the row lock (atomicTeamUpdate), and
  // returns false when it found nothing to change. A save always writes, so
  // the saves pass no `notFoundError`.
  const handleListWrite = (validate, apply, notFoundError, logLabel) => async (req, res) => {
    try {
      const { teamId } = req.params;
      const { password, sessionToken } = req.body || {};

      const { error } = await authenticateTeam(teamId, password, sessionToken, { needsTeam: false });

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
  app.post('/api/team/:teamId/template/save', templateWriteLimiter, handleListWrite(
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
  app.post('/api/team/:teamId/template/delete', templateWriteLimiter, handleListWrite(
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
  app.post('/api/team/:teamId/healthcheck-template/save', templateWriteLimiter, handleListWrite(
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

  app.post('/api/team/:teamId/healthcheck-template/delete', templateWriteLimiter, handleListWrite(
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

export { registerTeamTemplateRoutes, mergeLegacyRetroTemplates, mergeLegacyHealthCheckTemplates };
