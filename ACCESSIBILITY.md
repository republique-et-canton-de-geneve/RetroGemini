# Accessibility statement — RetroGemini

_Last reviewed: 2026-08-25. Audit method and remaining gaps below._

## The standard we work to

**WCAG 2.1 level AA**, which is the standard the Swiss federal accessibility
norm **eCH-0059** builds on and which a Geneva cantonal deployment is expected
to meet.

This is a statement of **what has been tested and what is known to be missing**,
not a conformance certificate. No external accessibility audit has been
commissioned, and no assistive-technology user has tested the product. Both of
those are worth doing and neither has been done — see *What we have not done*.

## How it is tested, and how that stays true

Two automated gates run on **every pull request**, and both are ratchets: the
number they allow can fall, never rise.

| Gate | What it checks | Where |
|---|---|---|
| axe-core, nine screens | Serious/critical WCAG 2.0/2.1 A + AA rules on login, team creation, the dashboard, four retrospective phases (icebreaker, brainstorm, group, close) and two health-check screens (survey, close) — including two **dark** screens, which a light-only sweep cannot check | `e2e/accessibility-audit.spec.ts` |
| `eslint-plugin-jsx-a11y` | Accessibility rules across the whole React tree, inside the repository's two-way lint budget | `eslint.config.js`, `scripts/lint.mjs` |

**Current measurement (2026-08-25): zero axe violations at any severity on all
nine screens.** The lint budget still carries 71 accessibility warnings, listed
by rule in `scripts/lint.mjs`; the largest group is form labels not
programmatically associated with their control.

A gate at zero is what makes the claim durable: a new serious or critical
violation on those screens now fails the pull request instead of being absorbed
by an allowance.

**Automated testing is a floor, not a conformance claim.** axe inspects the
markup that exists; it cannot report an operation that has *no* keyboard path,
because there is no bad markup to find. That is why the audit included a manual
keyboard-and-focus pass, and why the most serious finding came from it.

## What was found, and what was done

Measured 2026-08-24 by an axe-core run over six screens plus a scripted
keyboard-and-focus walk. Remediated 2026-08-25, which added three screens: the
Group phase, where the keyboard work landed, and the two dark close screens,
where a light-screen contrast sweep had made things worse.

| Finding | Standard | State |
|---|---|---|
| **Grouping tickets was pointer-only** — the Group phase card was a `div` with `draggable`, no role and no key handler, so it was unreachable by keyboard | 2.1.1 Keyboard | **Fixed.** Every card, group and column carries a button: pick a card up, then confirm on the target; Escape cancels. It replaces the tap-to-group shortcut rather than sitting beside it, so pointer, touch and keyboard all follow one flow |
| **Modals were not dialogs** — thirteen overlays, one `role="dialog"`, no focus trap, Escape handled in three files | 4.1.2, 2.1.2 No keyboard trap | **Fixed.** One shared shell (`components/common/ModalDialog.tsx`) gives every overlay the role, the accessible name, Escape, a focus trap and focus returned to whatever opened it |
| **Contrast below the floor** on muted labels, the phase bar, and every primary button (white on indigo-500 measured 4.46:1 against 4.5:1) | 1.4.3 Contrast | **Fixed.** Muted text one step darker, the brand primary one step darker. Column titles are painted in a colour the facilitator picks, so they are darkened only as far as the floor requires, keeping the chosen hue |
| **An unlabelled `<select>`** announced as nothing at all | 4.1.2 Name, Role, Value | **Fixed** — for all twelve in the product, not only the two the audit walked past |
| **No focus indicator on the phase bar** | 2.4.7 Focus visible | **Fixed** |
| **Phase titles were plain text**, so a screen reader got no outline | 1.3.1 Info and relationships | **Fixed** — they are headings |
| **Icon-only buttons announced the icon font's ligature** ("arrow_back") | 4.1.2 Name, Role, Value | **Fixed** for the six that had no other name |
| **Ticket text on a coloured card** chose black or white by a brightness average, not by contrast — the default rose "Stop" column got white text at 3.67:1 where near-black gives 4.86:1 | 1.4.3 Contrast | **Fixed** — the choice is made by measured contrast, so it is right for any colour a facilitator picks |
| **The first shape of the keyboard fix broke `nested-interactive`** — a card turned into a `role="button"` around its own reaction buttons | 4.1.2 Name, Role, Value | **Fixed before landing**, and the Group phase was added to the audit: it was the one interactive screen the audit did not walk |

## Known gaps

Stated because a documented gap is honest and silence is not.

1. **Form labels.** 29 form controls have a visible label that is not
   programmatically associated with them. A screen reader announces the control
   without its label unless it can infer the relationship from proximity. This
   is the largest remaining group and the next piece of work.
2. **`autoFocus` on 17 controls.** Moving focus on load is disorienting for
   screen-reader and magnifier users. Each one needs judging individually —
   inside a dialog it is usually right, on a page it usually is not.
3. **Other pointer-only controls remain.** The Group phase was the one this
   audit measured and fixed; it is not the only one. Choosing which dimension
   to discuss during a health check
   (`components/HealthCheckSession.tsx:1029`) is a `div` with a click handler,
   no keyboard path and no role — the same shape, on a facilitator-only
   control. Do not read "grouping is keyboard-accessible" as "the application
   is".
4. **Screens not covered by the automated audit.** The nine audited screens
   are the main flows, and they now include a dark one at each end (both close
   screens). The super-admin panel, the team feedback board, the template
   builders and the Discuss phase are checked by the lint rules but have no axe
   run.
5. **No testing with real assistive technology.** Everything above is measured
   with automated tools and a scripted keyboard walk. Nobody has driven this
   product with a screen reader, a switch device or voice control, and no
   external audit has been commissioned. Automated tools are estimated to catch
   roughly a third of real accessibility barriers.
6. **Colour choices are the facilitator's.** Column colours are user-chosen.
   Titles are darkened automatically until they are readable, but a facilitator
   can still pick two colours that are hard to tell apart from each other.

## Feedback

If something in this application is not usable for you, tell the team that
operates your deployment — they can reach the maintainers through the
repository's issue tracker. Please say which screen, what you were trying to do,
and what assistive technology you use, if any.

## For maintainers

- The remediation plan and its ordering live in `HARDENING_STATUS.md` (finding
  H42).
- **Never raise either ratchet to make a change pass.** Lower `BASELINE` in
  `e2e/accessibility-audit.spec.ts` and `BUDGET` in `scripts/lint.mjs` in the
  same change that removes a finding. A new accessibility violation is a defect
  like any other.
- When adding a modal, use `components/common/ModalDialog.tsx`. Rebuilding the
  overlay by hand is how the product ended up with thirteen of them and one
  `role="dialog"`.
