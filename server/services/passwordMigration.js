import { hashPassword, isHashedPassword } from './passwordHashing.js';

/**
 * Decision D1 / hardening stage 7d — leave no legacy plaintext record behind.
 *
 * Team records created before password hashing shipped stored the password in
 * clear text. Such a record no longer authenticates (`verifyPassword` has no
 * plaintext-compare branch any more, invariant 7), so this pass is what keeps
 * them usable: a legacy record *contains its own plaintext*, so it can be hashed
 * with no user interaction, no window, and no invite link broken (invite links
 * carry the password, which authenticates against a hash just as well). It runs
 * at startup and after both restore routes, since a backup taken before hashing
 * can put plaintext records back.
 *
 * It reads only each team's `id` and `passwordHash` (`loadTeamPasswordHashes`,
 * one projection in SQL): Node parses no full record, at boot or after a
 * restore, whatever the teams' histories weigh. That read is never cached and
 * has no other caller — it carries hashes.
 *
 * Two properties matter more than completeness here:
 *
 *  - **It never throws.** Boot must not fail because a password-format upgrade
 *    could not run. A failed team is left legacy and retried on the next boot.
 *  - **It re-checks under the lock.** Several pods boot at once, so the updater
 *    aborts if the record it is handed is already hashed rather than
 *    overwriting a fresh hash with one derived from stale plaintext. Only a
 *    record the updater actually rewrote counts as hashed: a declined update
 *    reports success too, and the summary line is H23's evidence.
 */
const migrateLegacyPasswords = async ({ dataStore }) => {
  let teams;
  try {
    teams = await dataStore.loadTeamPasswordHashes();
  } catch (err) {
    console.warn('[Server] Legacy password migration could not read the teams', err);
    return { scanned: 0, upgraded: 0, failed: 0, error: true };
  }

  let upgraded = 0;
  let failed = 0;
  const legacy = (teams || []).filter(
    (team) => typeof team?.passwordHash === 'string' && team.passwordHash && !isHashedPassword(team.passwordHash)
  );

  for (const team of legacy) {
    try {
      const hashed = await hashPassword(team.passwordHash);
      let wrote = false;
      const result = await dataStore.atomicTeamUpdate(team.id, (currentTeam) => {
        // Another pod may have upgraded this record between the scan and the
        // lock, and the password may have been changed outright. Either way the
        // stored value is no longer the plaintext this hash was derived from.
        if (!currentTeam || isHashedPassword(currentTeam.passwordHash) || currentTeam.passwordHash !== team.passwordHash) {
          return null;
        }
        wrote = true;
        return { ...currentTeam, passwordHash: hashed };
      });

      // A declined update answers success as well: it is neither hashed here
      // nor failed — someone else already dealt with the record.
      if (result?.success) {
        if (wrote) upgraded += 1;
      } else {
        failed += 1;
      }
    } catch (err) {
      failed += 1;
      console.warn(`[Server] Failed to upgrade the stored password for team ${team.id}`, err);
    }
  }

  // Reported on every boot, including the clean one. Removing the plaintext
  // fallback (H23) waits on evidence that this pass has nothing left to do, and
  // logging only when it *did* something made that evidence be silence — which
  // is indistinguishable from the pass never having run, from the store read
  // above having failed, and from reading the wrong pod's logs. `console.info`
  // is mirrored into the super-admin log ring (`logService.attachConsole`), so
  // the clean line lands in the admin panel rather than only in `oc logs`.
  //
  // The early return on a failed store read deliberately does *not* reach here:
  // a scan that never happened must never print "0 hashed, 0 failed".
  console.info(
    `[Server] Legacy password migration: ${upgraded} record(s) hashed, ${failed} failed, ` +
    `${(teams || []).length} team(s) scanned`
  );

  return { scanned: (teams || []).length, upgraded, failed, error: false };
};

export { migrateLegacyPasswords };
