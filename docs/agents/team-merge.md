# Merging teams (super-admin)

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


A facilitator who could not recover her password created a second team rather
than lose the session (see *Email addresses*), and the team then lived in two
halves. The console's **Teams** tab can merge two teams into a **new, third
one**; the admin checks it, then deletes the two originals from the same tab.
`server/services/teamMerge.js` is the planner (pure: no I/O, no clock, ids
injected), `server/services/mergeSources.js` reads a team as the merge sees it,
`server/routes/superAdminTeamMergeRoutes.js` holds the three routes,
`components/admin/` the two dialogs.

**Three promises, and every rule serves one of them.**

- **The sources are never written.** The merge creates one record and touches
  nothing else, so undoing it is deleting the merged team, and checking it is
  comparing it with two teams still exactly as they were. The sources stay
  usable until they are deleted — and what is written there after the merge is
  *not* in the merged team; deletion is what notices (`source_changed`).
- **Nothing is lost.** Every retrospective, health check, action, member,
  archived member and template of both teams is in the result, and
  `assertMergeInvariants` refuses to return a team whose counts do not add up or
  whose ids repeat. A team collection that is present but not an array
  refuses the merge (`422 source_needs_repair`, naming the field) rather than
  be dropped; a malformed member is carried verbatim. **Feedbacks are
  the one exception**: they *move* when a source is deleted, because a copy
  would show twice on every board under the same id.
- **Nothing is overwritten.** Where the two teams collide — a retro or action
  id, a member id, a map key (votes, ratings, `impactDeferredBy`), a template
  name — both are kept, the second re-minted or renamed, and the report says so.

Rules that look like details and are not:

- **A source is its record plus any live session row ahead of it.** Receivers
  never persist and a closed tab never sends its last persist, so the team
  record lags `session:{id}`. A row counts only when it is bound to the same
  team and its *work* differs — who looked at it and where the phase bar stands
  do not count — so "freshened" in the report means the merged team really holds
  something the record lacked. The record still wins for the
  fields only granular routes write — an action's `done`, `assigneeId`, `text`,
  `closedAt`, `impactRatings`, `impactDeferredBy` — exactly as `Session.tsx`
  reconciles them. A row that cannot be *read* is not "no row": the merge
  refuses (`503 session_read_failed`).
- **Retros and health checks get new ids** in the merged team, with `teamId`
  rewritten: `session:{id}` rows are global keys, and reusing an id would put
  the merged team in the sources' live rooms.
- **Members are unified only when it is unambiguous**: the two facilitator
  seats; the same valid email, held by one member on each side; the same name,
  unique on both sides, with no conflicting email. Anything else is kept as two
  members and listed in the preview ("Same name, kept as two members"), and two
  members left apart with one email are reported, because member emails are
  identities on the client.
- **The admin confirms the plan shown, not a later one.** The preview returns
  `fingerprints` of both teams as planned (roster included). The merge requires
  them (`400 missing_fingerprints`) and refuses with
  `409 sources_changed_since_preview` when either moved; the dialog then reloads
  the preview.
- **A team is never merged with a relative** (`409 related_teams`, the preview
  included): one built from the other, or two merges sharing a source. Either
  way both hold the same work, and the merge would copy it twice. The chain is followed at any depth through
  signed provenance, and each entry records its source's own ancestors
  (`ancestorIds`), so it survives the deletion of a team in the middle. The
  remedy for a source changed since its merge is to merge the **original** teams
  again, which is what the deletion dialog says.
- **The name is free in the index and on every record**
  (`teamNameIndex.js` → `nameHeldByAnotherRecord`), claimed before the record is
  saved and released only if this request added it. Two teams cannot share a
  name, so the merged team needs a new one; once the sources are deleted it can
  be renamed — **before** its invitations go out, since an invite names the team.
- **Provenance is signed, all of it.** The merged team carries `mergedFrom`:
  per source, its id and name, the time, a content digest (`fingerprint`), a
  record-only digest (`recordFingerprint`), per-part digests and counts, the
  source's ancestors, and the digest of the merged team as created
  (`mergedFingerprint`, `mergedParts`). The digest ignores what browsing writes
  (presence, the phase bar, the timer), so a participant opening a closed retro
  is not a change — but **reaching Close is**: a stored `CLOSED` is final, and a
  session closed in a source after the merge would otherwise stay IN PROGRESS
  for good in the merged team. The HMAC (`signMergeProvenance`, keyed by
  `SESSION_TOKEN_SECRET`) covers the merged team's id and **every field** of the
  entry in canonical JSON (PostgreSQL's jsonb reorders keys), so an entry can be
  neither copied onto another team nor edited in place. A team could write
  `mergedFrom` through `/update` before this release, so an unsigned or edited
  entry shows as "(not verified)" in the console, can only *add* a warning, and
  never decides anything. Without a stable `SESSION_TOKEN_SECRET` the signatures
  die with the process: every source deletion then asks for an acknowledgement
  (`merge_unverified`) and the feedbacks are orphaned, which is safe.
- **Jira: links travel, the token does not.** An action's `jira` is
  record-owned like `done` (`RECORD_OWNED_ACTION_FIELDS`), the merged team takes
  the primary's `jiraTarget` by the unknown-key rule, and `jiraClaims` and
  `jiraParentClaims` are known keys that are never carried. The session
  parents (`jiraParents`) are **re-keyed** to the merged team's session ids
  through each source's id maps (`mergedJiraParents`): a parent of a session
  the source no longer holds is dropped, and the dashboard's (`backlog`) is the
  primary's, else the secondary's. Carried as an unknown key, the primary's
  would name ids no session has and the secondary's would read as a conflict.
  The token is a row of its own (`team-secret:{teamId}`) and is not copied:
  the merged team enters one. **An
  action that is not in Jira yet keeps its id in the merged team**, so until the
  sources are deleted the source and the merged team can each create an issue
  for it — a residual, not gated (see *Jira*).

**Deleting from the console** (`/api/super-admin/delete-team`) never relies on
the admin having remembered: it says what the deletion would cost, with a digest
of those facts (`confirmation`), and proceeds only when the admin acknowledges
*those* reasons and sends the digest back. Anything that changed meanwhile — a
reason, a session opened, a source's or merged team's work moving on — changes
the digest and the facts are shown again, with a line saying so; a reason not
acknowledged is never waved through by another. The digest deliberately leaves
out the record's revision: a team with a live session writes its record every
few seconds, and binding to that made it impossible to confirm. Facts are
sorted before hashing, since PostgreSQL returns summaries in storage order.

- `source_changed`: the source's effective content matches no **signed** merge
  that lists it, with *what* changed (a retro by name, the backlog, the
  templates). After a restore every live row is gone, so the record-only digest
  stands in — but only when no live copy is ahead of the record now. A source
  that only *lost* retros since its latest merge is unchanged: they are in the
  merged team.
- `merge_unverified`: the team is listed as a merge source only by unsigned
  provenance, so nothing confirms the merged team holds its work.
- `merged_team_changed`: a merged team was used after its merge, so deleting it
  is no longer just undoing the merge.
- `sources_deleted`: a merged team whose sources are gone holds their only copy.
  Neither of these two is asked of a merged team that is itself an unchanged
  source of a later merge: that later team holds all of it.
- `sessions_open` / `sessions_unknown`: someone is in one of its sessions, or
  that cannot be known. Unknown is a reason too, and so is a failed read of the
  merge targets — that answers `500` and deletes nothing.

A protected "Pre-delete snapshot" is taken before anything is removed, and the
record is **read again after it**: a write that landed while the checks and the
whole-store backup ran answers `409 team_changed` with nothing deleted, and the
snapshot taken for it is removed (what
remains is the width of one read and two deletes, as on the team-side
deletion). These snapshots are protected, so retention never prunes them: each
deleted source leaves one full-store archive, pruned by hand like the
pre-restore ones. Feedbacks move only into the merged team the admin confirmed
and the merge signed (the dialog offers one only when exactly one signed merge
lists the team), re-checked under the lock; the moved copy is stamped
`movedFromTeamId`, a retry adds only the comments it lacks and never replaces
it, a colliding id is re-minted, and the comments **this** source wrote become
the merged team's own (once it is gone nobody could delete them) — in every
merged team the merges signed, even when it had no feedback to move. The other
source's comments stay its own until it is deleted in turn. A source deleted
from its own Dashboard knows nothing of merges: its comments in a merged team
stay under its id, deletable by the super admin. The console says so
when feedbacks it announced would move were kept in the Feedbacks tab after all.

**A team deleting itself is unchanged**: `/api/team/:teamId/delete` is never
refused for a merge, and its feedbacks are orphaned as always. The Dashboard now
waits for the answer and shows a failure instead of logging out as if the team
were gone.

**A merge touches no session**: the merged team has a new id, which no source's
session token names, and the sources' tokens and session epochs stay as they are
(decision D3b).

During a rolling update a pod from before this release does not serve the merge
routes (the console reports a failure) and its `/update` still accepts
`mergedFrom` — which is what the signature is for — and returns it to team
members. A member could then *remove* the signed provenance through such a pod,
after which a source deletion orphans its feedbacks and checks nothing against
that merge: **do not merge while a rollout from a release before 36.0 is in
progress**, and expect the same exposure after a rollback. Both operations are
recorded: `team.merge` (sources, counts, which password opens the merged team —
as `passwordSource`, because the log redactor blanks keys named like a secret —
and where its recovery address came from, `recoveryEmailSource`, never the
address) and `team.delete` (the snapshot id, the reasons acknowledged, where the
feedbacks went). The merged team's password is its own: changing a source's
password later does not reach it, which the dialog says.
