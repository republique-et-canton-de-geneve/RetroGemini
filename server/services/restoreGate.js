// One restore at a time on this pod.
//
// The whole-store restore replaces every team; the single-team restore writes
// one. Overlapping, they report success twice and leave a hybrid of two
// backups: the replace undoes the team write that landed before it, or the team
// write lands on top of the replace. The pre-restore snapshot's own guard
// (`backupInProgress`) protects only the snapshot, not what follows it, so the
// three restore routes share this gate for their whole run and refuse a second
// one with `409 restore_in_progress`.
//
// It is per pod: two requests on two replicas do not see each other. A shared
// lock would need a store record with an expiry, and restores are a rare,
// deliberate super-admin action; the residual is documented in AGENTS.md.

const createRestoreGate = () => {
  let busy = false;
  return {
    /** True when this caller now holds the gate; it must call `leave()`. */
    tryEnter() {
      if (busy) return false;
      busy = true;
      return true;
    },
    leave() {
      busy = false;
    }
  };
};

export const RESTORE_IN_PROGRESS_ERROR = 'restore_in_progress';

export { createRestoreGate };
