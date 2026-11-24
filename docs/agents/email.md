# Email addresses

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


**One rule, in `utils/emailAddress.js`, for every address the product stores or
mails.** A facilitator stored her team's recovery address as
`elisabeth.trolliet@etat.ge.ch;` — the semicolon Outlook leaves on a copied
recipient. Nothing refused it, `/api/send-password-reset` compared
`trim().toLowerCase()` of both sides, never found a match, and answered its
deliberately silent `204`; she waited for a mail that could never come and
created a second team. Every write path had its own idea of an address (a
permissive regex in two routes, none in the others, trim-and-lowercase on the
client), which is how a value one path accepts becomes one another can never
match. The module is plain JS in `utils/` for the reason `passwordPolicy.js` is:
the routes and the React forms both import it.

- **Clean, then judge.** `cleanEmail` removes what a paste leaves around *one*
  address (a display name and its `<…>`, `mailto:` and its query, quotes and
  brackets, a trailing `;` `,` `.` `:`, no-break and zero-width characters) and
  lowercases it; it never picks one address out of several. `isValidEmail` is
  strict: ASCII, one `@`, no empty or doubled dots, a top-level domain of
  letters (or `xn--`), at most 254 characters — so `a@b` is refused, which
  reverses the "internal single-label domain" an invite test used to accept.
  `parseEmailInput` chains them: `undefined`, `null` or a blank string is a
  **clear**, anything else that is not one valid address is refused.
  `sameEmail` compares two values through the cleaning; the reset route uses it.
- **The server enforces it; the screens only explain it.** `/api/team/create`,
  `/api/team/:teamId/update` (before the name claim), `/api/super-admin/update-email`,
  `/api/super-admin/update-admin-email` and `/api/send-invite` answer
  `400 invalid_email` and store or mail the cleaned address.
  `/api/team/:teamId/members` cleans but **never refuses** — a roster write
  carries joins — and never cleans one member into an address another member
  holds, because member emails are identities on the client. `dataService`
  checks first and throws `INVALID_EMAIL_MESSAGE` (English, translated through
  `i18n/errorMessages.ts` → `errors.invalidEmail`); the client's identity
  matching (`dataService`, `TeamLogin`) goes through `cleanEmail`, a superset of
  the trim-and-lowercase it replaced.
- **A team is created with a recovery address or not at all** (37.0). A team
  without one has no way back from a forgotten password — the facilitator above
  created a second team instead. `/api/team/create` answers
  `400 recovery_email_required` for an absent or blank value
  (`RECOVERY_EMAIL_REQUIRED_ERROR` in `utils/emailAddress.js`, with its English
  sentence for `dataService` and `errors.recoveryEmailRequired` on screen), and
  the create form marks the field `required`. `parseEmailInput` still reads a
  blank value as a clear: creation refuses that clear itself, so every other
  route keeps letting a team remove its address. During a rolling update a
  create form from before this release can omit the address and is refused with
  the raw code — the safe way to be wrong. The rule binds the *team-side*
  creation only: the console's merge takes the address the admin chooses
  (possibly none), and a team deleted since a backup comes back with whatever
  the archive held. Both are super-admin operations on teams that already
  existed, and the console can set the address afterwards.
- **The reset comparison cleans both sides.** Typed and stored values are both
  parsed and must be equal and non-empty; the mail goes to the *stored* cleaned
  address under the stored team name, never to the caller's strings. A stored
  value holding two addresses never matches, on purpose.
- **Stored values are healed, not just new ones.**
  `server/services/emailMigration.js` → `healStoredEmails` cleans each team's
  `facilitatorEmail`, member and archived-member emails, and
  `global-settings.adminEmail`. It runs at startup right after the password
  migration and after both restore routes (an older archive puts dirty values
  back), scans the summaries projection (`loadTeamSummaries({ withArchivedMembers: true })`)
  rather than full records, and follows `passwordMigration.js`: it never throws, re-decides inside
  `atomicTeamUpdate` so a newer edit is never overwritten, prints one summary
  line on every run, and names a value it cannot clean by **team id, never by
  address**. It does not touch `session:*` rows or the participant and invitee
  copies inside retros and health checks: the client compares those through
  `cleanEmail` on both sides, and rewriting a live session row from a startup
  pass would race every client writing it.
- **The Dashboard field commits, it does not stream.**
  `components/dashboard/RecoveryEmailSetting.tsx` keeps a draft, commits on blur
  or Enter, says "saved" or "removed", and ties its error to the field
  (`aria-invalid`, `aria-describedby`). It used to save every keystroke, which
  is how the pasted value was stored as typed. "Saved" means the server stored
  it: `updateFacilitatorEmail` awaits the write (still behind the persist queue)
  and a refusal shows on the field. A Dashboard from the previous
  release still saves every keystroke during a rolling update: its partial values are refused and
  only logged there, and the last valid one lands — the safe way to be wrong.
- **A legacy roster address is kept, not refused, on edits that do not touch
  it.** `updateMember` judges the address only when it changed, so a member
  stored as `jdoe@corp` can still be renamed. Identity lookups prefer the exact
  stored spelling before the cleaned form, because the server keeps
  `a@x.ch;` and `a@x.ch` apart as two members. Inviting by email checks each
  address against the rule first, so an address the server would refuse gets no
  member and no link.
