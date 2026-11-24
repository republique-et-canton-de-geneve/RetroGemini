# Restoring one team (super-admin)

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


The whole-store restore is a faithful replace: right when everything went
wrong, wrong when one team lost a retrospective, because it also rolls every
other team back. The console's **Backups** tab therefore has a second action
per backup, *Restore a team*: `components/admin/TeamRestoreDialog.tsx` lists the
teams the backup holds and what became of each since (still there, renamed,
deleted), `server/routes/superAdminTeamRestoreRoutes.js` holds the two routes,
and `server/services/teamRestore.js` (pure) decides the record it writes.

- **A file is restored by importing it first.** The Backups tab's *Import a
  backup file* card (`components/admin/BackupImportCard.tsx`) sends it to
  `/api/super-admin/backups/import`, which stores it as one row of the shared
  `backups` table, of type `imported` (a violet "imported" badge, the file name
  as its label). Every backup route then reads that row unchanged — this
  dialog, the whole-store *Restore*, the download, the delete — and the console
  opens this dialog on the new row by itself, unless the file holds no team.
  The row holds the uploaded bytes (gzipped first when they were plain JSON),
  validated once at import by the rule every restore applies
  (`archiveShapeProblem`) and read back by the same parser. Nothing is kept in
  memory between requests, so the calls that follow can land on any pod: the
  row is committed before the import answers. Several teams can be restored
  from one import, and the row is deleted by hand when done. A team from
  another deployment comes back as "deleted since the backup", with the
  archive's password and **no feedbacks** (they are never taken from an
  archive). A pod from before 41.0 answers the import with an HTML 404, which
  the console reads as "not available yet, try again in a few minutes"; it
  lists, restores from, downloads and deletes an imported row like any other.
  The upload limits are `RESTORE_MAX_BODY_MB` / `RESTORE_MAX_DECOMPRESSED_MB`;
  in front of the application, ingress-nginx's 1 MiB default and the
  OpenShift Route's 30 s timeout are the operator's (k8s/README.md → *Upload
  size and timeouts*), and the console tells a proxy's HTML 413 from the
  app's JSON one. A lost answer (a 504 at 30 s while the server still works)
  reads as *uncertain*: the list is read now and again 20 s later, because a
  blind retry would leave a duplicate row.
- **Residuals of restoring from a file, stated on purpose.** *Each team
  restored leaves its own protected "Pre-restore snapshot"*, which retention
  never prunes, so restoring five teams from one import leaves five
  whole-store copies to delete by hand, with the imported row; the card says
  so. *A team from another deployment keeps its actions' Jira keys*
  (`ActionItem.jira` is a key, never a URL): they render against **this**
  deployment's Jira address and read as "already in Jira", which is right only
  when both deployments use the same Jira. No archive records which Jira a key
  belongs to, so this is stated, not detected. *It also keeps its Jira target
  and each session's parent issue* (`jiraParents`: a team from another
  deployment comes back as "deleted since the backup", and that branch of
  `planTeamRestore` takes the archive's map whole). Unlike an action's key, a
  parent key routes: in the mode that gives each session a parent, the next
  sends go as sub-tasks under those keys in **this** deployment's Jira, with no
  lookup first (`destinationOf`), and a key this Jira also holds is accepted
  silently. Before sending, check the parent issues the batch dialog and the
  Review step list; to re-point a session, name a parent and tick the replace
  box (`replaceParents`), or change the target in *Settings → Jira*.

- **The work comes back; how people get in does not.** The restored record is
  the backup's, less what `KEPT_FROM_CURRENT` keeps: its retrospectives,
  health checks, backlog, member rows, archived members, templates and
  impact-rating settings (the switch and the date its notice was dismissed)
  come back. While the team exists, its **name, password, invite epoch,
  recovery address, feedbacks, merge provenance, last connection, Jira target,
  each member's avatar (`memberAvatars`) and the server-only `jiraClaims` and
  `jiraParentClaims`** stay as they are now (`KEPT_FROM_CURRENT`; one the
  current record lacks is dropped, never revived from the archive): rolling a
  password back locks out everyone who knows the current one, rolling the
  invite epoch back revives revoked invite links, and an avatar is each
  person's own dated choice, so a rolled-back one would put an older picture
  on everyone's screen. The current Jira links are carried onto the restored
  actions (`carryJiraLinks`; a current key also
  replaces an archived "may already be in Jira" mark), the session parents too
  (`carryJiraParents`: per session the current key, else the archived key,
  else a mark — the newest routing decision wins, since a session re-pointed
  since must not go back), planned inside the final write so a parent created
  while the restore ran is kept, and the team's Jira token is never touched.
  A team deleted since the backup has no current values, so it returns with
  the archived ones — under its old name, or a name the admin types when another team holds
  it now (`409 team_name_exists` otherwise, with nothing written).
  Its session epoch is rotated before and after the record is written
  (decision D3b), so a token minted before the deletion does not come back to
  life with the archived password; a team that exists keeps its password, and
  therefore its sessions.
- **Feedbacks are never rolled back.** They are a board shared with the super
  admin, not the team's work. A team that exists keeps its own; a deleted one
  gets back the copies its deletion moved to `orphanedFeedbacks` — with every
  reply since — and never the archive's, which may have moved into a merged
  team meanwhile, and are stamped with the name the team comes back under (the
  board shows a feedback's own `teamName`, and the old name may be another
  team's now). The orphans leave `orphanedFeedbacks` after the record is
  written, and only those still exactly as the plan read them: a reply posted
  to one while the restore ran keeps it there too. A duplicate the admin can see
  beats a reply that vanished (`feedbacksStillOrphaned`).
- **Every restored retro and health check lands above every live copy.** A
  full-blob persist is refused only when its `_rev` is *strictly* older, and the
  live `session:{id}` row runs ahead of the record, so each restored entry gets
  `max(archived, stored, live row) + 1`. Without that, the next persist from a
  participant still holding pre-restore state would undo the restore a second
  later. The live revisions are read **after** the snapshot, which dumps the
  whole store and can take seconds while a session moves on. Every restored
  entry that has been run then gets its row through the session
  compare-and-swap: an existing row is overwritten and sent to its room
  (`session-update`), so people in the session see the restore; a missing one
  is **written** (`sessionsSeeded`) — after a whole-store restore none exist,
  and without one a client whose cached team record predates the restore would
  seed the session from that cache at a revision the record accepts. Rows
  people may be in are written first, so a live session never waits behind the
  seeding of every old retro. A row that lands above the record's revision —
  a socket write reached it between the record write and this one, and its
  sender was acked at the record's revision — has the record entry re-stamped
  at the row's revision, or that sender's next persist would pass the record's
  guard with the pre-restore state. A written row is cached and broadcast only
  while it is still the latest: clients apply
  every `session-update` they receive, so publishing it after a participant's
  newer write would take the room back over that write. Other pods' caches need
  no invalidation because a cache read keeps the higher revision. A row that cannot be *read* stops the restore before anything is
  written (`503 session_read_failed`); a row that cannot be *written* afterwards
  is reported (`sessionsNotUpdated`) and the console asks for a reload. A retro
  created after the backup is not in the restored record, but a participant
  still in it keeps saving it — live work is not destroyed silently, and the
  pre-restore snapshot holds the rest. Its actions come back without the Jira
  links they had: no current copy holds them to carry over (see *Jira* →
  residuals). The re-stamp of a lifted entry carries the record's current Jira
  links first, so a key a batch wrote while the rows were written survives it.
- **The usual safety net.** Checked first (archive, the team's current state
  against what the console showed, the name), then a **protected**
  "Pre-restore snapshot", then the live session rows (a row that cannot be read
  deletes the snapshot and answers `503 session_read_failed`), then one
  compare-and-swap write of the record (`atomicTeamUpdate`, or `atomicTeamSave` at revision 0 for a
  deleted team, so a team that reappeared meanwhile is not overwritten:
  `409 team_changed`). A refusal after the snapshot deletes it; an unexpected
  error keeps it, because the write it guards may have landed. Two restores of
  the same deleted team share one name claim, so a failing one gives the name
  back only while **no record** holds it, and a successful one claims it again
  after its save — releasing on the first one's failure is how the second's
  record would lose the name it logs in by. That re-claim is best-effort: the
  team is recreated by then, and an error there must not answer 500 and skip
  what follows.
- **What the console showed is what happens.** The two cases restore different
  credentials, and the dialog explained one of them, so it sends `expected`; a
  team deleted or recreated since its list was read is refused with
  `409 team_changed` and the dialog reads the list again.
- **One restore at a time.** The three restore routes — this one, the stored
  whole-store restore and the uploaded one — share `server/services/restoreGate.js`
  for their whole run and refuse a second with `409 restore_in_progress`;
  overlapping, a whole-store replace and a team write each report success and
  leave a hybrid of two backups. The gate is **per pod**: two requests routed to
  two replicas do not see each other. A shared lock needs a store record with an
  expiry; restores are rare and deliberate, so that residual is accepted and
  stated here rather than built for. **An import is not a restore**: it writes
  one `backups` row and nothing a restore writes, so it takes its own per-pod
  gate (`createImportGateMiddleware`, `409 import_in_progress`), entered before
  the body is read and **held until the handler settles, not until the client
  leaves** — `res` emits `'close'` when the client disconnects (a gateway 504
  included) while the handler is still gunzipping, parsing and inserting, and
  the retry that follows must not stack a second upload on a 384 Mi pod. Each
  entry has one release, called once: by the handler's `finally`, by the
  body-error handler, or by `'close'` only when the handler never started. It
  bounds import against import; an import beside a restore on the same pod is
  the documented memory ceiling (k8s/README.md → *Automated backups*).
- **The console says every partial outcome.** Sessions not updated (ask for a
  reload) and feedbacks left in two places (delete the extra copy in the
  Feedback tab) each have their own notice, and one notice when both happen. The password and
  email passes of the whole-store restore run afterwards, and the action is
  recorded as `team.restore` — its own name, so the trail tells "the store was
  rolled back" from "one team was".
