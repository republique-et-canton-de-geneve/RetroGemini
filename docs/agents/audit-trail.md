# Audit Trail of Privileged Actions (audit H45)

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


Every privileged action writes one row to `security_events`: the action, the
actor, the outcome, the target, the source IP, the timestamp and the
**correlation id** of the request that produced it (H44's id, so a row joins to
the log lines around it). It survives the pod, which the in-memory log ring does
not — that was the whole finding: after a rolling update there was no evidence
a restore had ever happened.

`server/services/securityEvents.js` owns it. Four rules when you touch it:

- **`record(req, event)` takes the request first, on purpose.** The source IP is
  a required field of every row, and a signature that takes the request cannot
  be called in a way that forgets it. Do not "simplify" it to take a plain
  object.
- **Clearing the log viewer is a recorded action** (`logs.clear`), for a reason
  worth keeping: it is the one action whose *purpose* can be to remove evidence.
  The row lands in the database, which the clear does not touch.
- **The action names are a closed set** (`SECURITY_ACTIONS`). A typo writes a
  row nobody will ever find — a hole in the trail that looks exactly like an
  action that never happened — so an unknown name is refused and logged rather
  than stored. Adding a privileged route means adding its action to that set,
  and `__tests__/securityEventAudit.test.ts` fails if a declared action is never
  emitted.
- **Append-only means the *application* has no path that changes or removes a
  row.** `dataStore` exposes exactly `appendSecurityEvent` and
  `listSecurityEvents`, and a test pins that surface. The database does not
  enforce it; say it that way rather than claiming more.
- **A failed audit write never fails the operation it records.** A restore that
  worked must not be reported as failed because an `INSERT` did not.

> ⚠️ **The registrars default `securityEvents` to a no-op, so the load-bearing
> wiring is in `server.js`.** That default is what lets the other 130 test files
> stay unchanged — and it is also what would let a forgotten `server.js`
> argument leave every suite green while production records nothing. The guard
> is a source assertion in `__tests__/securityEventAudit.test.ts` that reads
> `server.js` and checks each registrar receives it. It proves the argument is
> written, not that it runs — the same limit H44's middleware has.

**Reading the trail is `k8s/README.md` → *Reading the audit trail*.** There is
deliberately no endpoint and no super-admin panel: a viewer is a user-visible
feature (bump `X`, one changelog bullet), and this is a hardening change.

**It stores IP addresses.** That is new persistent personal data in a product
whose position is "no retention rule, internal deployment". Documented in
`SECURITY.md`; revisit it if the application ever becomes reachable from
outside.
