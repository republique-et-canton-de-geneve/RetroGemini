# Jira

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


Teams create their actions as Jira issues from the Review step (retrospective
and health check render the same Jira components) and from the Dashboard's
Actions tab. In the Review step one click sends the session's new actions
(`ReviewPhase` passes `newActionsForJira`), and the previous open actions a
retrospective shows are sent one at a time, each from its own row; the
Dashboard's batch sends every open action the tab lists, and each row has its
own control too. The super administrator connects **one** Jira for the
deployment in the console (`components/admin/JiraSettingsCard.tsx`); each team
stores **one** token and a target in *Settings → Jira*
(`components/jira/JiraTeamSettings.tsx`). A target is one of three modes:
`project` (issues in a project), `parent` (sub-tasks of one issue) and
`sessionParent` (sub-tasks of one parent issue per retrospective or health
check, created in a project the first time one of its actions is sent; the
dashboard's actions share one parent for the whole team). The
browser never talks to Jira — the CSP's `connect-src 'self'` forbids it, and
Data Center sends no CORS headers — so every call goes through
`server/routes/jiraRoutes.js` → `server/services/jiraClient.js` →
`server/services/outboundHttp.js`, to the configured address only. The batch is
`server/services/jiraIssues.js`; the browser side is `services/jiraService.ts`
and `components/jira/`. The rules both sides apply — keys, addresses, targets,
what an issue holds — are pure modules in `utils/jira.js` and
`utils/jiraIssueContent.js`. Data Center is served by a personal access token
(Bearer), Cloud by an email and a classic API token (Basic): the scheme follows
the credential, never a stored "deployment" flag. `__tests__/helpers/jiraMock.ts`
is a Jira for tests — mounted under `/jira`, paginated, validating like Jira —
that the unit suites and `e2e/jira.spec.ts` both start.

Rules:

- **A link is a key, never a URL.** `ActionItem.jira` is `{ key, createdAt }`
  or `{ uncertainSince }`. The href is built when rendering, from the
  configured address and a key that passes `JIRA_ISSUE_KEY_PATTERN`
  (`jiraBrowseUrl`); with no known address the screen shows the plain text
  "Jira: KEY", never an `<a>` without href. `actions` is not a protected session
  field, so a stored URL would be a link any participant could plant on the
  facilitator's screen.
- **The token lives in a row of its own, sealed, and bound.**
  `team-secret:{teamId}` holds AES-256-GCM (16-byte tag, checked) under
  `deriveKey('jira-token/v1')` from `SESSION_TOKEN_SECRET`, with the additional
  authenticated data `team-secret:<teamId>|<canonical base URL>`: a row moved
  onto another team, or read after the console changed the address, does not
  open, so a token never travels anywhere but where it was checked
  (`secretBox.js`, `jiraCredentials.js`). Never on the team record, which
  reaches every browser, every merge and every archive. Storing is refused
  without a stable secret (`503 jira_secret_unavailable`): a per-process key
  would die with the pod and differ on every replica — and under the templates'
  example secret, whose key anyone can derive (`tokenService.canSealSecrets`,
  checked before sealing; `hasStableSecret` alone would accept it). No route
  returns it. A dump opens the tokens only together with the secret, so the two
  are kept apart; after a suspected leak of either, teams revoke their token in
  Jira and save a new one, since the old one entered again stays readable from
  every earlier dump.
  Deleting a team deletes its secret **first**; the token route re-checks
  `teamExists` after saving; a startup sweep removes rows whose team is gone.
- **The connection is a key of its own, read strictly.** `jira-settings`, not
  `global-settings`: that blob's writers used to read-modify-write it with a
  read that answers `{}` on error, so one database hiccup would have erased
  Jira. They now go through the strict, locked `updateGlobalSettings` (see
  *Key Design Principles*), and the connection keeps its own key anyway: the
  console writes it whole, and a row nobody else writes cannot lose a
  neighbour's change. A failed
  `loadJiraSettings` answers `500`, never "Jira is off" — which would make every
  team's buttons vanish. Neither key is ever in an archive
  (`__tests__/archiveContract.test.ts`).
- **A stored link always wins, on every path that writes an action.** Only
  `/jira/issues` writes `jira`. `reconcileStoredActions` and
  `mergeActionImpactState` keep the stored value; the retrospective and
  health-check persist handlers drop a link the record does not hold, on new
  actions too (`withoutUnstoredJiraLinks`); `/action` takes it from the record
  (`withRecordedJiraLink`); the client keeps one it knows (`mergeJiraLink`, used
  by `Session.tsx` — the Review-entry snapshot rebuild included — `ReviewPhase`
  and `HealthCheckSession`), and `dataService.updateGlobalAction` never takes
  one from its caller. Both restores carry the current links onto the archived
  copies (`carryJiraLinks`; a current key also replaces an archived uncertain
  mark): the token is not rolled back, so an action restored unlinked would be
  created again. A merge treats `jira` as record-owned. `jiraTarget` and
  `jiraClaims` are kept from the current record in a single-team restore
  (`KEPT_FROM_CURRENT`); `jiraClaims` is server-only (stripped from every
  response, ignored by `/update`, never carried by a merge) and `/update`
  ignores `jiraTarget` too. The session parents follow the same line:
  `jiraParents` (sent to clients) and `jiraParentClaims` (server-only, stripped
  like `jiraClaims`) are on the team record only — never on a retro entry,
  whose persist replaces the whole entry, nor on a session row — written by
  `/jira/issues` alone and ignored by `/update`. The single-team restore keeps
  the current claims and carries the parents, the whole-store restore carries
  them too (`carryJiraParents`), and a merge re-keys them (see *Merging
  teams*).
- **Claim, then call — and a lost answer is "uncertain", never a retry.** Each
  action is claimed inside `atomicTeamUpdate` — the row lock, so the claim is
  exclusive across pods — in `team.jiraClaims[actionId] = { at, requestId }`,
  and that same write links the previous action. Under the lock: a key answers
  `already_linked`, a done action `closed`, a claim younger than
  `JIRA_CLAIM_TTL_MS` (60 s) `in_progress`, and an older claim turns the action
  into `{ uncertainSince }` — its request died mid-creation, and the issue may
  exist. A `201` writes the key on every copy of the action (two retries, then
  `created_not_saved` and the stop `link_not_saved`); when another request
  linked it meanwhile, the key already there wins and the duplicate is logged.
  A definite refusal clears the claim. A `400` belongs to its action and the
  batch goes on — unless Jira named a field the target sets (`labels`,
  `issuetype`, `project`, `parent`): every action would be refused the same
  way, so the batch stops after that one (`jira_target_refused`), and a refusal
  of the labels says where to remove them (plan J-5). A 5xx, or an answer lost once the
  request was sent, marks every copy uncertain, and the screen says "May
  already be in Jira: check it, then create anyway" with a search link; only
  that confirmation sends `force`. An issue is created on a connection of its
  own (`keepAlive: false`): a pooled socket Jira closed at the wrong moment
  would otherwise fake a lost answer.
- **One parent per session, claimed like an action** (`sessionParent` mode).
  An action's scope comes from the very `issueSource` its content is written
  from (`jiraParentScope`): `retro:<id>`, `healthcheck:<id>`, or `backlog` for
  an action no session holds — so an earlier action sent from a later retro's
  Review goes under its own retro's parent. A parent is claimed only for an
  action about to be sent (every skip and refusal is decided first), in
  `team.jiraParentClaims[scope]`, under the same row lock; the action is not
  claimed in that write. The parent's `201` lands in one write that stores
  `jiraParents[scope] = { key, createdAt, subtaskTypeId }`, drops the parent
  claim and claims the action under the key — so each claim spans exactly one
  Jira call, and a key another request stored meanwhile wins (the duplicate is
  logged). Every later send of the scope reuses the key, with no parent call.
  A live foreign claim answers `parent_in_progress`; an expired one marks the
  **scope** `{ uncertainSince }`, dated by the claim, and the action
  `parent_uncertain`. A lost answer marks the scope, never the action (it was
  not sent), keeps an earlier mark, and stops the batch; a marked scope is
  skipped until the facilitator confirms **that scope**
  (`forceParentScopes`), which lifts that skip and nothing else (`force` is
  the action's). A confirmation is for the doubt the dialog showed, never the
  request's: a doubt the server finds during the send — an expired claim,
  which no screen can see, so the dialog previewed that session as "new" — is
  never lifted by it, for the rest of that request (`doubtsFound`), and the
  client stops confirming a scope once an answer reported it in doubt, so the
  next requests of the batch do not lift it either [review F2-1]. The client
  sends with each request only the confirmed scopes of that request's own
  actions, which is what bounds the list to one per action. Any Jira refusal
  of a parent stops the batch (`jira_parent_refused`): the same type, project
  and labels go on every parent — Data Center's required Epic Name is the
  typical case. A parent key that cannot be stored is answered `not_saved` with the key, stops
  `link_not_saved`, and its claim expires into a mark. The sub-task goes in the
  parent's project (`jiraProjectKeyOf`), with the target's sub-task type when
  that is the target's project, else the type recorded with the parent. The
  parent's summary and description are `parentIssueFields`, in the scope's
  content language, labels included; its title is fixed at creation.
- **A parent named at send time is adopted only once Jira took a sub-task
  under it** [R1]. A `parent`-mode one-time target with `adoptParent` sends
  every action under the parent named, and makes it the stored parent of each
  scope with no key (or only a mark, or only an expired claim; with
  `replaceParents`, one with a key too) **in the write that lands the key of a
  sub-task Jira created under it** (`adoptParent` in `jiraIssues.js`) — even
  when that action's copy no longer takes the key (deleted, or a rival key
  kept), and never in the claim write. A refused sub-task, a lost answer or a key that cannot be saved
  changes no scope; a live foreign parent claim is left alone. The adopted key
  is the one Jira's lookup answered, and a parent that cannot hold sub-tasks — a
  sub-task, or on Cloud a type above level 0 (an epic) — is refused once,
  before anything is created (`jira_parent_invalid`, `cannotHoldSubtasks`).
- **A request is short.** At most `JIRA_MAX_ACTIONS_PER_REQUEST` (10) ids; no new
  creation after 10 s (the first always starts, or a slow Jira would answer
  every request with nothing done and the client would loop); 15 s idle and
  15 s wall-clock per Jira call (`outboundHttp`'s `deadlineMs`, not a socket
  idle timeout); nothing new once the caller has gone (`client_gone`) or the pod
  is draining (`server_restarting`, `isShuttingDown`). What was not attempted is
  `remaining`, which the client sends next. In project mode that keeps a batch
  inside an OpenShift Route's 30 s default, where a user would otherwise see an
  error while the server went on creating. With a parent (sub-task) target it
  does not: the parent lookup (up to 15 s) runs inside the budget and the first
  creation always starts, so a slow Jira can push one request past 30 s; the
  Route then answers 504 while the server finishes the call in flight and then
  stops (`client_gone`), and the client reads it as `outcome_unknown`. A
  session's parent counts as one creation: the budget, the caller and the
  drain are read again before the parent's write, to decide whether the
  sub-task that follows a fresh parent may start, and only the caller and the
  drain (not the budget) are read once more after that write [R6], so a
  `SIGTERM` during that write releases the action's claim and starts no call;
  a parent created past the budget is stored and its action waits in
  `remaining`. A Dashboard request of
  ten actions from ten sessions can need twenty calls: the budget cuts it. A
  draining pod is forced out `DEFAULT_SHUTDOWN_TIMEOUT_MS` (20 s) after
  `SIGTERM`: one Jira call (`JIRA_CALL_DEADLINE_MS`) and the write of its key,
  inside the 25 s the manifest's grace period leaves after `preStop`
  (`__tests__/shutdown.test.ts` holds both bounds, and that a claim outlives
  the one call and write it spans).
- **One live-session patch per session per request.** After the loop, each
  session holding an affected action — and the request's `sessionId`, once its
  row's `teamId` matches — is patched once through `createLiveSessionPatch`
  (the rename's compare-and-swap, generalised in `liveSessionRename.js`),
  stamping `jira` on `actions`, `openActionsSnapshot` and
  `historyActionsSnapshot`; a patch with nothing to change writes nothing, and
  a parent, never on a session row, adds nothing to patch. That
  patch is how a participant learns a key: receivers never read the team record
  again, and the previous actions a retro shows exist only in its history
  snapshot. One per issue would move the revision N times and refuse N of the
  facilitator's summary keystrokes; the `reviewSummary` slice of the own-change
  ledger takes care of the one race left.
- **One rule decides what Jira receives, and the dialog previews it.**
  `issueSource` (which copy of an action, in which session) and `issueFields`
  build the summary — one line, at most 255 code points, never half a surrogate
  pair — and the description: session, date, context, requester, every
  interpolated value through `wikiText()` so user text cannot form Jira wiki
  markup. The content language is the session's template language (a retro
  with none reads English), else the team's latest retro's, else the clicker's,
  else English. The server creates with them and the batch dialog previews with
  them, so what the facilitator confirms is what is sent. The context is quoted
  in anonymous sessions too (maintainer decision D2). The description quotes
  the linked card in full, or for an action on a group names the group and
  lists the full text of each of its cards, one `* ` item each, in board order
  (`retro.tickets` order), never an author (maintainer decision 2026-10-22,
  "never abbreviate"; `actionGroupCards`). It derives the card from the
  record, and uses a stored `contextText` only when the card or group no
  longer exists — that value is whatever a screen stored, which may be cut at
  50 characters or written in the reader's language. Jira's limits are the
  only cuts to what the action and its cards say: the summary at 255, and the
  description at 32,767 (`DESCRIPTION_MAX_LENGTH`, line breaks counted
  twice), where whole cards are dropped from the end and counted in a closing
  line (a first paragraph that nearly fills the limit leaves them
  unmentioned), and a quote too long to fit is replaced by a sentence saying
  so — only when that sentence fits: a session name close to the limit keeps
  the real quote, overflows, and Jira refuses that one action. The requester's
  display name is cut at 80 (`REQUESTED_BY_MAX_LENGTH`), RetroGemini's own
  limit. `wikiText` escapes each item, and
  the list is the one construct the template writes (nothing interpolated can
  start a line). The guard is linear, because it runs under the team's row
  lock (the claim step) and in the dialog on every live update. The dialog
  renders the description with its line breaks and the list's bullets
  (`descriptionAsJiraShowsIt`, `whitespace-pre-wrap`). The dialog sends the
  target it shows — the stored one as last read, or the one-time change — with
  every request of the batch, never "whatever is stored now": any team session
  may save another target meanwhile (D1), and a batch longer than one request
  would otherwise land in two places. It names the stored target's issue type,
  read once when it opens (its id until Jira answers, or when it cannot) — and
  in `sessionParent` mode the parent issue's type too, from the same read.
  In `sessionParent` mode it also lists the parent issue of each session the
  send touches (`jiraParentPreviews`, built from the same `issueSource` →
  `jiraParentScope` → `parentIssueFields` as the server): the existing key, the
  new parent's title (in its own language, marked with `lang`), or a parent in
  doubt with a search for its title and the one box that confirms the rows it
  shows in doubt — those scopes, with the actions listed under each
  (`forceParents` → `forceParentScopes`), never a row it shows as new.
  It reads this browser's copy of the team, so a row can say "new" where the
  server reuses a parent created meanwhile — never the reverse — and the
  confirm button counts the actions plus the new parents [R9]: high by one
  for each session whose parent another window created since this browser read
  the team (several on a Dashboard batch, which spans sessions), never low. A parent a one-time `sessionParent` change creates is stored for its
  session like any other [R3], and the dialog says so whenever a row is new.
- **The parent issue can always be named, and only through the dialog.** In
  both sub-task modes the dialog shows "Parent issue (optional)"
  (`JiraParentField`), never behind "Change the target": checked with Jira on
  leaving the field (`/jira/issue-types {parentKey}`, which refuses a sub-task
  or a Cloud epic), with a required "Sub-task type in …" list when the
  parent's project does not offer the target's type; Create sends nothing for
  a key not checked or without a type, and says so on the field — an error
  that goes once the check it asked for answers, or when the field is left or
  Enter pressed, since a click on Create leaves the field first and can land
  while that check runs [review F2-2]. It is sent as
  the one-time `parent`-mode target, plus `adoptParent` in `sessionParent`
  mode (and `replaceParents` when "Also use … for their later actions" is
  ticked, offered only when a session of the send already has a parent). So in
  the sub-task modes one action's control is "Create in Jira…"
  (`aria-haspopup="dialog"`) and opens the dialog with that one action — "Create
  anyway" too, with `force` — and when it closes after a key landed the
  keyboard goes to the new link. Project mode keeps the one click, and that
  click sends the target its status shows [R2], as the dialog does: a screen
  whose status went stale while someone saved another target creates where it
  said it would, never a session parent with no chance to name it.
- **The discovery note shows once per browser and person, and only where Jira
  exists.** `JiraDiscoveryNote` remembers who dismissed it in `localStorage`
  (`retro-jira-note-seen`, a list of user ids, every access in try/catch) and
  renders nothing until the status says Jira is on: a deployment without Jira
  must never advertise it. That list is the one-time notes' shared seen list
  (`components/common/seenOnce.ts`, the avatar hint's too: the fifty most
  recent people, and where the keyboard goes when a key dismisses a note,
  the next control drawn after it, nowhere after a pointer), pinned by
  `__tests__/seenOnce.test.ts`. The Jira note has no place of its own to fall
  back on, as the avatar hint has its opener: with no drawn control after
  it, a key's dismissal leaves the keyboard to the page. Its last sentence
  follows the reader's role and the token's state. The Settings card follows
  the same rule (nothing where Jira is off, unless a token is still stored,
  which it then offers to remove).
- **The client sends again only what proves nothing ran.**
  `jiraService.createIssues` retries a `404` whose body is not JSON — an older
  pod during a rollout — with the rollout backoff (about 7 s), and nothing
  else: any 5xx or 408 (even with a JSON code), a gateway's page or a network
  error ends the batch as `outcome_unknown`. Whenever an outcome is unknown the
  service then reads the team once (`settleUnknown`, after `whenPersisted`):
  an action the record shows linked comes back `already_linked` with its key,
  and the links go into the cache with `applyJiraLinks` — never the whole
  record — so only what the record cannot explain is left for the facilitator
  to check in Jira. It waits for `dataService.whenPersisted()` first
  (an action typed a moment ago must have reached the record), follows
  `remaining` chunk by chunk, with the same target and flags, and writes what
  came back into every cached copy with `applyJiraLinks` (no persist). The
  parents of `sessionParent` mode follow the same path: each answer's
  `parents` is read (an entry whose scope or key is not one is dropped) and
  kept with its last status per scope; a request that only created a parent
  is progress, never an idle round; `applyJiraParents` caches each `created`
  or `adopted` key and each dated mark — a reported key replaces the cached
  one (a scope's parent can be replaced, unlike an action's issue), a mark
  never replaces a key or an earlier mark, and a `not_saved` key is not cached
  — and `settleUnknown` caches the record's `jiraParents` too. The status is
  read on Review entry, on each reconnect and after a settings save — never
  from `dataService` while rendering (`useJiraStatus`).
- **Who may press is the screens' rule.** The controls show to facilitators,
  on open actions only (the server answers `closed` anyway); a reason note tied
  to an `aria-disabled` control says why a facilitator cannot create (no token,
  enter it again, refused by Jira, no target). At all three sites (the
  Dashboard's Actions tab, where the batch button shares the filters' row, and
  both Review steps) the button is docked to the right edge from `sm` up and
  the note hangs under it as a small bordered amber note, right-aligned with it
  and at most 24rem wide, so it never moves the button (`JiraBatchButton`,
  `JiraReasonLine`; a left-aligned stack on a phone). With nothing to send the
  note stands alone in the button's place: per-action controls render nothing
  while creation is blocked. The health-check Review closes
  and assigns actions through `toggleGlobalAction` / `updateGlobalAction`, as
  the retro's does: it used to write only the session row, so the Dashboard —
  and the batch — saw closed actions as open. In `sessionParent` mode both
  Review steps show the facilitator the session's parent ("Parent issue in
  Jira:" and its key-only link, or the doubt and a search, `JiraParentLine`);
  never a participant, whose cache never learns a parent created after their
  login. A row's dialog that reported a parent refreshes the step even when
  the action itself is unchanged — a fresh parent whose first sub-task Jira
  refused, a parent left in doubt [review F2-3]. An action held back by its
  parent (`parent_uncertain`, `parent_in_progress`, `parent_refused`) is said as "not sent", in its own
  words, and never as "may already be in Jira" (`jiraBatchResults`,
  `JiraActionControl`): it was not sent.
- **An invalid field is rose on every Jira screen.** The team-side forms
  (`JiraTeamSettings`, `JiraTargetFields`, `JiraParentField`) and the batch
  dialog's line under its target fields mark an invalid field and say what is
  wrong with it as the console's card does: `aria-invalid:border-rose-600`
  (4.51:1 on the white field) and `text-rose-700` on the white card or dialog.
  They drew it in red until 45.3, beside the console's rose
  (`__tests__/jiraInvalidState.test.ts`, which reads every string of those
  files with the TypeScript parser and measures both colours). The batch
  dialog's results keep their own colours: a refused or not-saved outcome is
  not an invalid field.

Residuals, stated on purpose:

- **Facilitator-only is a UI rule** (D1). Any team credential — an
  invitation-link login included — can set, replace and remove the token and
  the team's target, create issues through the routes in any project its
  account reaches, with any requester name in the description (the browser's,
  unverified), and look up through `/jira/issue-types` whether a project or an
  issue key exists, an issue's project and a project's issue types — metadata
  of anything the account can see, never issue content. It can also create one parent issue per session or for the dashboard, send
  under a parent of its choosing anywhere the account reaches, and re-point a
  session's later actions (`adoptParent` with `replaceParents`).
  `SECURITY.md` says so; a technical account limited to the team's projects is
  the mitigation.
- **A Jira request already past authentication finishes when the team's
  password is changed** (decision D3b revokes every session token, the Jira
  routes included): a batch chunk in flight completes, and its next chunk is
  answered `401 session_revoked`.
- **Merge sources keep their unlinked action ids** (see *Merging teams*): until
  the sources are deleted, a source and the merged team can each create an
  issue for the same action.
- **A team deleted since the backup, brought back by either restore, loses its
  token for good**: the secret went with the deletion, the replace keeps a
  secret only for a team in the archive that existed before it, and the
  single-team restore removes any leftover row.
- **A restore to an older state can bring an action back unlinked.**
  `carryJiraLinks` needs a current record that holds the link, and only covers
  the actions the archive holds. An application archive restored into a new
  database, a team deleted since the backup, a `pg_dump` of an older state, or
  a restore that removed the action while a client still holding it (a
  participant in a retro created after the backup, a client connected during a
  whole-store restore, a stale tab) saves it again: the action reads as not in
  Jira, and its next creation makes a second issue — at once after a `pg_dump`
  restored with the same secret. The runbooks say to check Jira first, and a
  team deleted from the console has its "Pre-delete snapshot", which holds
  every link. A server-side ledger of created keys would close this; it is not
  built.
- **A base URL change means the same Jira at a new address.** Links are
  key-only and re-point; tokens are bound to the address and are entered again.
  Switching to an unrelated Jira is "several instances", out of scope.
- **Older pods during the rollout** answer the Jira routes with an HTML 404
  (retried), do not guard `jira` in their persist handlers — a stale
  whole-session write through one can drop a link written meanwhile; the issue
  still exists and a second click would create another — delete a team without
  its secret (the startup sweep removes it), and restore without links or
  secrets: do not restore while they run.
- **Data Center can lock Basic logins behind a CAPTCHA** after repeated
  failures and then answer `403` (`X-Seraph-LoginReason:
  AUTHENTICATION_DENIED`), which reads as `jira_forbidden`, not as a refused
  token. A personal access token (Bearer) and Cloud are not affected.
- **A key planted on a live session's action** (a participant's write can set
  it: `actions` is not a protected field) shows as that action's link in the
  Review step and hides its button there. No write path stores it on the
  record, the Dashboard still offers the action, and a value that is not a key
  renders nothing.
- **Pods from before 41.0 and `sessionParent`.** They refuse the mode
  everywhere and create nothing (`/jira/target` and an override answer
  `invalid_jira_target`, the stored target reads as `jira_target_missing`,
  the status as no target); they ignore `adoptParent`, so a session sent
  under a named parent through one creates its own parent next time; their
  `/update` accepts `jiraParents` and `jiraParentClaims` (no client sends
  them); their merge carries the primary's parents with stale ids and their
  restores do not carry the current ones, so a second parent follows — do
  not merge or restore during the rollout; their `/jira/issue-types` answers
  no sub-task type for a project and no `subtasksIncluded` (the form then says
  the sub-task types cannot be read yet). A screen of that release whose
  status went stale before a `sessionParent` target was saved still offers its
  one-click, which sends no target: on a new pod it runs the stored target and
  creates the session's parent with no dialog (or reads a `parent_*` status as
  "may already be in Jira"). Nothing is created twice, and a screen of this
  release cannot do it: its one-click sends the target it shows [R2].
- **Empty parent issues can stay in Jira**, always logged with their key: a
  fresh parent whose first sub-task Jira refuses (a type that cannot hold
  sub-tasks, on a Jira that gives no hierarchy level), one whose key could not
  be stored (`not_saved`, also answered), one created by two requests on pods
  whose clocks disagree by more than the claim lifetime (the scope keeps the
  first key), one the facilitator confirmed with `forceParentScopes`.
- **A stored parent deleted or moved in Jira** has every default send of its
  session refused (`jira_target_refused`, Jira names `parent`): the remedy is to
  name a parent and replace (`replaceParents`). A parent Jira refuses
  sub-tasks under never becomes a stored parent in the first place.
- **A deleted session's parent stays on the record**: its unsent actions become
  backlog actions and go under the team's parent, and a single-team restore
  that brings the session back finds its parent again. A merge source keeps
  its parents: a parent a source creates after the merge is not in the merged
  team, which creates its own for that session.

The guards: `__tests__/jiraRouteAuth.test.ts` (every team Jira route, derived
from the router: a forged or foreign credential gets `401`, Jira untouched, no
secret read, no audit row), `jiraIssues.test.ts` and `jiraRoutes.test.ts` (the
batch and the routes against the mock), `secretBox.test.ts` and
`teamSecretStore.test.ts`, `jiraTeamRecordGuards.test.ts` and
`actionJiraLinks.test.ts` (every write path, the session parents included),
`jiraParentsCarry.test.ts` (the parents' carry rule), the `sessionParent`
cases of `jiraUtils.test.ts`, `jiraIssueContent.test.ts`, `jiraIssues.test.ts`
(one parent per session, claimed like an action, adopted only once a sub-task
landed under it), `teamMerge.test.ts` / `superAdminTeamMergeRoutes.test.ts`
(re-keyed parents) and `teamRestore.test.ts` / `superAdminTeamRestoreRoutes.test.ts`
(carried parents), `archiveContract.test.ts`, on the screens
`jiraBatchDialogParents.test.tsx` (the parent field, the parents preview and
their results, the request bodies), `jiraActionControl.test.tsx` (the
one-click's target, the dialog of the sub-task modes, the `parent_*`
outcomes), `jiraTargetFields.test.tsx` (the third mode, and a project form
that never offers a sub-task type from the route's full list),
`jiraService.test.ts` / `dataServiceJira.test.ts` (parents read, cached and
counted as progress), `jiraIssueContent.test.ts` (the full quote, a group's
cards, each escaped, and the 32,767 guard: whole cards only, linear),
`jiraMock.test.ts` (the mock refuses a description over 32,767 as Jira does),
`jiraIssuePreview.test.ts` and `jiraIssues.test.ts` → *the preview and the
server agree* (a group's cards, a huge card over a cut stored context, an
overflowing group) and *the parent preview and the server agree*, `reviewPhaseJira.test.tsx`,
`healthCheckReviewJira.test.tsx` and `dashboardJira.test.tsx` (the reason note
docked under the button, with `jiraBatchButton.test.tsx`,
`dashboardActionsTab.test.tsx` and `jiraReasonLine.test.tsx`; the parent line
and the rows' dialog), `i18nJira.test.tsx`,
`jiraBatchSessionConvergence.test.ts`, `jiraErrorCodes.test.ts` (every code
the routes answer reads as a sentence in both languages), `shutdown.test.ts`
(the forced exit outlasts one Jira call and ends inside the grace period),
and `e2e/jira.spec.ts` — the whole flow with two browsers, one parent issue
per retrospective reused for its later actions, the dashboard's own parent and
a parent named for one send, a ~300-character card reaching Jira whole, the
Dashboard's reason note measured under its button at 1280 and 320px, and the
axe audit of the seven Jira screens. A local PostgreSQL run of several of the suites that
read `TEST_DATABASE_URL` shares global rows between files: run it with
`--no-file-parallelism`.
