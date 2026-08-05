import { hashPassword, isHashedPassword } from './passwordHashing.js';

/**
 * Decision D1 / hardening stage 7d — leave no legacy plaintext record behind.
 *
 * Team records created before password hashing shipped still store the password
 * in clear text. `teamService.verifyTeamPassword` authenticates them through a
 * constant-time plaintext compare and upgrades them on the way past
 * (rehash-on-auth), which covers every team that logs in — and no others. A team
 * dormant since the hashing release keeps a readable password in the database
 * for as long as it stays dormant, and the fallback that serves it cannot be
 * removed while such a record may exist.
 *
 * D1 was framed as a choice between announcing a deprecation window and keeping
 * the fallback forever. It is neither: a legacy record *contains its own
 * plaintext*, so it can be hashed with no user interaction, no window, and no
 * invite link broken (invite links carry the password, which authenticates
 * against a hash just as well). This pass runs at startup and does exactly that.
 *
 * Two properties matter more than completeness here:
 *
 *  - **It never throws.** Boot must not fail because a password-format upgrade
 *    could not run. A failed team is left legacy and retried on the next boot;
 *    until the fallback is removed it still authenticates normally.
 *  - **It re-checks under the lock.** Several pods boot at once, so the updater
 *    aborts if the record it is handed is already hashed rather than
 *    overwriting a fresh hash with one derived from stale plaintext.
 *
 * Removing the plaintext fallback (`passwordHashing.js`'s `constantTimeEqual`
 * branch and `teamService.js`'s rehash-on-auth) is the *next* step, and needs
 * two things first: this pass reporting `upgraded: 0, failed: 0` on production
 * boots, and the same pass wired into the restore path — a backup taken before
 * hashing can put plaintext records back, and after the fallback is gone those
 * records would no longer authenticate at all.
 */
const migrateLegacyPasswords = async ({ dataStore }) => {
  let teams;
  try {
    teams = await dataStore.loadAllTeams();
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
      const result = await dataStore.atomicTeamUpdate(team.id, (currentTeam) => {
        // Another pod may have upgraded this record between the scan and the
        // lock, and the password may have been changed outright. Either way the
        // stored value is no longer the plaintext this hash was derived from.
        if (!currentTeam || isHashedPassword(currentTeam.passwordHash) || currentTeam.passwordHash !== team.passwordHash) {
          return null;
        }
        return { ...currentTeam, passwordHash: hashed };
      });

      if (result?.success) {
        upgraded += 1;
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
