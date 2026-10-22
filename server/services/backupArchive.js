import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { isTeamShape } from './archiveShape.js';

/**
 * The whole-store archive, built one team at a time through gzip.
 *
 * Every backup, snapshot and the `/api/super-admin/backup` download used to
 * load the whole store, stringify it in one piece and gzip it synchronously:
 * three copies of the store at once on a pod serving live sessions, and an
 * event-loop freeze of a second or more at 25 MB. Here the largest single
 * `JSON.stringify` is one team (or one orphaned feedback), zlib runs
 * asynchronously, and only the compressed bytes accumulate.
 *
 * The bytes are those of `JSON.stringify(await dataStore.loadPersistedData())`
 * for the same clock — same keys, same order, compact — so every reader, old
 * or new, parses it: pods of earlier releases restore a new archive, and this
 * one restores theirs (pretty-printed downloads included, since the parser is
 * untouched). An array element serialises the same way alone as inside its
 * array, and every element here is a parsed JSON value, never `undefined`.
 *
 * Built on `stream/promises.pipeline` on purpose: it attaches the error
 * handlers, so a gzip error while the source awaits the store rejects this
 * call instead of leaving a rejected promise unhandled — which, with no
 * `unhandledRejection` handler in server.js, would exit the pod and every live
 * socket on it. A source error (an unreadable row) destroys the gzip and the
 * source, which ends the PostgreSQL read transaction and releases its client.
 *
 * Throws when any read fails; nothing partial is ever returned.
 *
 * `unrestorable` names the readable team records a whole-store restore would
 * refuse (no id or name, or an id another record already holds —
 * `archiveShapeProblem`), by id, or by position in key order when there is no
 * id — never by content. They are archived anyway: refusing the backup would
 * also take away the single-team restore of every OTHER team in it, which
 * judges only the team chosen. The caller warns about them.
 *
 * @param {{ dataStore: { iterateArchiveTeams: () => AsyncIterable<object>, readArchiveMeta: () => Promise<{ resetTokens: unknown[], orphanedFeedbacks: unknown[] }> }, now?: () => Date }} options
 * @returns {Promise<{ data: Buffer, teamCount: number, unrestorable: string[] }>}
 */
const buildBackupArchive = async ({ dataStore, now = () => new Date() }) => {
  const chunks = [];
  let teamCount = 0;
  const ids = new Set();
  const unrestorable = [];
  await pipeline(
    async function* archiveJson() {
      yield '{"teams":[';
      for await (const team of dataStore.iterateArchiveTeams()) {
        if (!isTeamShape(team)) {
          // The position in key order finds the row without naming content.
          unrestorable.push(typeof team?.id === 'string' && team.id !== ''
            ? `id ${JSON.stringify(team.id)}`
            : `record #${teamCount + 1} in key order (no id)`);
        } else if (ids.has(team.id)) {
          unrestorable.push(`id ${JSON.stringify(team.id)} (held by another record)`);
        } else {
          ids.add(team.id);
        }
        yield (teamCount === 0 ? '' : ',') + JSON.stringify(team);
        teamCount += 1;
      }
      const meta = await dataStore.readArchiveMeta();
      yield `],"meta":${JSON.stringify({ revision: 0, updatedAt: now().toISOString() })}`
        + `,"resetTokens":${JSON.stringify(meta.resetTokens)},"orphanedFeedbacks":[`;
      for (let i = 0; i < meta.orphanedFeedbacks.length; i += 1) {
        yield (i === 0 ? '' : ',') + JSON.stringify(meta.orphanedFeedbacks[i]);
      }
      yield ']}';
    },
    createGzip(),
    async function collect(compressed) {
      for await (const chunk of compressed) chunks.push(chunk);
    }
  );
  return { data: Buffer.concat(chunks), teamCount, unrestorable };
};

export { buildBackupArchive };
