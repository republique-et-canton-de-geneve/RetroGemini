# Accessibility statement — RetroGemini

_Last reviewed: 2026-10-22. Audit method and remaining gaps below._

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
| axe-core, the main flows | Serious/critical WCAG 2.0/2.1 A + AA rules on ten screens — login, team creation, the dashboard, five retrospective phases (icebreaker, open actions with a live impact-rating round, brainstorm, group, close) and two health-check screens (survey, close), including two **dark** screens, which a light-only sweep cannot check — and, since 2026-10-22, four states with more than one person: the Dashboard's Members tab with one member per participant colour (and one colour the palette does not know), the invite link's member picker, a participant's own Group screen, and the Group phase with a participant marked as departed. Every retrospective screen from the icebreaker on is audited with **two participants of different colours** (the facilitator's indigo and a lime participant, the palette's worst case for white initials) | `e2e/accessibility-audit.spec.ts` |
| axe-core, the administration console | The same rules on the whole console page, once per tab: Teams, and a team's inline editor open; the settings cards opened up (the AI fields shown, an info message previewed, a restore file chosen); Feedback, and its comment dialog; Live, with a session running in another browser; Server Logs; Backups, with a protected and an unprotected row. The run cannot change the server: every console call outside the reads and the three backup writes it means to make is aborted and fails the test. The merge, delete and one-team-restore dialogs are audited on their own, over real data, in the specs that open them | `e2e/admin-console-accessibility.spec.ts`, `e2e/admin-team-merge.spec.ts`, `e2e/admin-team-restore.spec.ts` |
| axe-core, seven Jira screens | The same rules, with a Jira connected and a second participant in the session: the Review step with the discovery note, the "Create in Jira" button and a control on every action; the open batch dialog with its preview; the Dashboard's Actions tab with a linked and an unlinked action; the team's *Settings → Jira* card; the console's Jira card; and, since 41.0, two states of the one-parent-issue-per-session mode: the *Settings → Jira* card with its three modes and both issue-type lists loaded, and the batch dialog with its "Parent issue (optional)" field and its list of parent issues. The two cards (in both of the team card's states), the dialogs and the Review step (without the session header and participants panel, which `accessibility-audit.spec.ts` audits on five other phases, with two participants) are audited on their own; the Dashboard's Actions tab is audited whole. The console around its Jira card is audited whole by its own spec, which never turns Jira on; the Dashboard's Settings tab around the team's card is not otherwise audited (gap 2) | `e2e/jira.spec.ts` |
| axe-core, the console's backup import card | The same rules on the Backups tab's *Import a backup file* card, audited on its own with a file chosen, before it is sent: the labelled file input, its hint, and the import button (white on teal-700, 5.39:1 — teal-600 would measure 3.66:1) | `e2e/admin-team-restore.spec.ts` |
| `eslint-plugin-jsx-a11y` | Accessibility rules across the whole React tree, inside the repository's two-way lint budget | `eslint.config.js`, `scripts/lint.mjs` |

**Current measurement (2026-10-22): zero axe violations at any severity on
every audited state — 33 in all: fourteen in the main flows, eight console
states and three console dialogs, seven Jira screens and the backup import
card.** The ten main screens have been at zero since 2026-08-26, the Jira
screens since 2026-10-20 (five, seven since 41.0), the import card since 41.0,
and the four multi-participant states and the console since 2026-10-22. The cap
for every state is one table, `BASELINE` in `e2e/helpers/axe.ts`, and each
`color-contrast` finding is printed with its colour pairs and ratios, so a fix
can be checked against the surface it lands on. The lint budget carries 17 accessibility warnings (2026-10-08), listed by
rule in `scripts/lint.mjs` — down from 71, after every form label was
associated with its control and each `autoFocus` was judged (see below). The
largest remaining group is controls that respond to a click with no keyboard
equivalent.

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
| **Icon-only buttons announced the icon font's ligature** ("arrow_back") | 4.1.2 Name, Role, Value | **Fixed 2026-08-27.** Six were given an `aria-label` in the first pass; the rest were left on the reasoning that a `title` gave them "another name", and that reasoning is **wrong** — in the accessible-name algorithm a button's content wins over its `title`, so `title="Delete Team"` still announced "delete". All **72** now carry an `aria-label` (the earlier counts of 17 and 8 were both measurement errors, not smaller problems — see `HARDENING_STATUS.md`). axe passes them either way: a name existed, it was simply the wrong one, which is why the guard is a source check — `__tests__/iconButtonNames.test.tsx` walks the TypeScript AST and fails the build on the next one. Where a control repeats per row, the name repeats too — accepted, because the row's identifying text precedes its controls. The exception is the column and dimension builders, where the icon and colour buttons come *before* the field naming the column, so those carry the column's index |
| **A switch with no accessible name at all** — the health check's "Anonymous mode" toggle renders only its knob `<span>` and had no `title`, so it announced as "button" and nothing more. Its twin on the New Retrospective dialog has carried a label all along | 4.1.2 Name, Role, Value | **Fixed 2026-08-27.** Found while measuring the row above, not by a tool: axe reports this one, but the dialog it lives in is not among the nine audited screens. The same suite now fails on any button that renders nothing and names nothing |
| **30 labels named nothing** — a visible label sitting above its field, associated with it by proximity alone. A screen reader announced the control without its name, and clicking the label did not focus the field. ESLint reported 29; the 30th was invisible to it, because the rule skips a label whose children are a conditional expression, and only a rendered check found it | 1.3.1 Info and relationships, 3.3.2 Labels or instructions | **Fixed 2026-08-26.** 23 now carry `htmlFor` against their control's `id`. The other **seven** named a *group* of controls rather than one — three column/dimension builders, the invite member picker, the retrospective picker (5 `group`), the feedback type and the analysis style (2 `radiogroup`) — and became real groups with an accessible name instead. The feedback type also gained the `name` attribute it lacked, without which its two radios were **two tab stops** rather than one group entered at the selected option, and a screen reader lost the "1 of 2" position. (An earlier draft of this row said the arrow keys moved nothing without it. Measured in a real browser that was wrong — they work either way here — and the correction is kept rather than quietly dropped, because the browser test asked for in review is what found it) |
| **`autoFocus` on 17 controls** | 3.2.1 On focus (the risk), 2.4.3 Focus order (the reason they stay) | **Judged 2026-08-26, all 17 kept.** Every one follows a user action that destroyed the control the user was on: an inline editor replacing its own trigger (11), a view swapped in by a click (4), a panel that has just opened (2). Removing them would drop focus to the top of the document, which is the defect, not the fix. Each carries its reason at the site and the behaviour is pinned by `__tests__/autofocusJustification.test.tsx` |
| **Ticket text on a coloured card** chose black or white by a brightness average, not by contrast — the default rose "Stop" column got white text at 3.67:1 where near-black gives 4.86:1 | 1.4.3 Contrast | **Fixed** — the choice is made by measured contrast, so it is right for any colour a facilitator picks |
| **Visible text missing from the name** — the language switcher showed "EN"/"FR" but was named "English"/"Français", and the timer showed "7:00" but was named "Set the timer (7:00)". axe-core 4.14 reports both (`label-content-name-mismatch`, now enabled by default and matching whole words, with parentheses ignored), and every audited screen went red on the dependency bump | 2.5.3 Label in Name | **Fixed 2026-10-19.** The names start with what the control shows: "FR, Français", "7:00, set the timer" (the alarm's name too, which the audit never reaches). Review then found five more that the audit never reaches because they appear only while a card is held or the tips panel is open: the board's "Move here", "Group here", "Move selected card here" and "Add selected card to this group" targets, and the tips panel's "Hide". `__tests__/labelInName.test.tsx` applies the 4.14 rule to every one of these pairs in both languages |
| **Action text fields with no name** — on the Review step and the Dashboard's Actions tab, each action's text is an editable field, and none had an accessible name: a screen reader announced an unnamed edit field per row. Neither screen had been audited with actions on it (the dashboard audit runs before any action exists), so the first Jira audit found it, one critical `label` finding per row | 4.1.2 Name, Role, Value, 1.3.1 | **Fixed 2026-10-20.** Each is named "Action text" ("Texte de l'action"), fixed text so the name does not change while typing; the value says which action it is. `__tests__/reviewPhaseActionTextName.test.tsx` and `__tests__/dashboardActionsTab.test.tsx` pin it in both languages |
| **The retrospective chip on a Dashboard action** — the retrospective an action came from, grey on a light grey chip, measured 4.34:1 | 1.4.3 Contrast | **Fixed 2026-10-20**, one step darker; found by the same audit |
| **The first shape of the keyboard fix broke `nested-interactive`** — a card turned into a `role="button"` around its own reaction buttons | 4.1.2 Name, Role, Value | **Fixed before landing**, and the Group phase was added to the audit: it was the one interactive screen the audit did not walk |
| **Avatar initials were white on every participant colour**, and seven of the eight are too light for white: lime measured 1.96:1, emerald 2.46, amber 2.15, cyan 2.36, fuchsia 3.54, pink 3.58, rose 3.76. Only the facilitator's indigo passed (4.58), which is why ten screens walked by one facilitator never saw it. Drawn in ten places: the dashboard and session headers, the Members tab, the participants panel, the invite link's member picker, a card's author, and the comment dialog's three avatars | 1.4.3 Contrast | **Fixed 2026-10-22.** The initials' colour is chosen per colour by measured contrast — black on the seven light colours (5.59:1 to 10.74:1), white kept on indigo — through one module, `utils/participantColors.ts`. A colour the palette does not know is drawn neutral (slate-600, white initials, 7.56:1) instead of being written into the page as a class. `__tests__/participantColors.test.ts` measures every pair from Tailwind's theme with axe-core's own colour engine, so a Tailwind update that moves a colour fails the build, and `__tests__/avatarColorSource.test.ts` refuses a colour read anywhere else |
| **A departed participant's avatar was faded to 50%**, which put its initials below the floor on every colour (1.40:1 on lime) | 1.4.3 Contrast | **Fixed 2026-10-22.** It is drawn in neutral grey, never faded (8.40:1); the "Left the session" chip beside it says why |
| **"no tickets" in near-white** under a participant who has not written anything yet (1.48:1), and the "+N" overflow and rating progress at 4.26:1 on the current user's own tinted row | 1.4.3 Contrast | **Fixed 2026-10-22**, one step darker than the muted grey (6.77:1 on the tinted row) |
| **The comment dialog's author line at 70% opacity**, taking the initials and the name to about 2.9:1 | 1.4.3 Contrast | **Fixed 2026-10-22.** No opacity; the name is muted by colour, which is measured |
| **The administration console**: muted grey on its grey page (4.35:1), mid-tone buttons and badges in white text (2.15:1 to 3.80:1), the active tab's colour on the page (2.93:1 to 3.34:1), and a per-team "Change Password" in amber-600 (3.19:1) — one node per team, most of the 182 measured on 2026-10-20 | 1.4.3 Contrast | **Fixed 2026-10-22, by surface, not by sweep.** `text-slate-500` stays on the console's white cards, where it measures 4.77:1, and goes one step darker only where it lands on the grey page or a tinted panel; each failing hue goes one step darker, and pairs between 4.5:1 and 4.6:1 one more step, so a Tailwind update cannot tip them. The Live tab's count badge no longer pulses (an animated opacity is measured at a random moment) |
| **The health-check score tooltip's digits**, white on the five rating colours (1.94:1 to 3.65:1, and 4.51:1 on the lowest) | 1.4.3 Contrast | **Fixed 2026-10-22.** Black on all five, the better of black and white on each (`utils/healthRatingColors.ts`), measured by the same test. Not reached by the e2e audit: the tooltip shows on hover over a health check that has votes |

## Languages

The interface is available in **English and French**. It opens in the first
of the two the browser prefers and can be switched at any time from the
language control on the login screen, the dashboard header and both session
headers.

- **3.1.1 Language of page.** `<html lang>` follows the interface language, so
  a screen reader reads a French screen with French pronunciation rules rather
  than English ones. Pinned by `__tests__/i18nCore.test.tsx`.
- **3.1.2 Language of parts.** Each option of the language control is written
  in its own language ("English", "Français") and marked with `lang`, so a
  French speaker on an English screen can find the way out without reading the
  screen they want to leave. Content whose language can differ from the
  screen's is marked too: the retrospective template cards, the built-in
  column titles and icebreaker questions of a retro run in its template
  language, the text of "What's New" when a release has no French version
  yet and falls back to English, and the server log lines the administration
  console shows (English machine text). Pinned by
  `__tests__/i18nLanguageOfParts.test.tsx`, `__tests__/i18nShared.test.tsx`
  and `__tests__/i18nSuperAdmin.test.tsx`.
- **Not covered:** text the team writes (tickets, comments, a column title or
  icebreaker question the facilitator types or edits) carries no language
  marking and is read in the screen's language — the application cannot know
  which language a person wrote in, and guessing the template's would be wrong
  as often as right.

## Known gaps

Stated because a documented gap is honest and silence is not.

1. **Controls that answer a click and not a key — now the largest group.** 16
   lint findings across the React tree: click handlers on static elements,
   elements that take a click without being focusable. The Group phase was the
   one this audit measured and fixed; it is not the only one. Choosing which
   dimension to discuss during a health check (the dimension header of the
   Discuss phase in `components/HealthCheckSession.tsx`) is a `div` with a
   click handler, no keyboard path and no role — the same shape, on a
   facilitator-only control. Do not read "grouping is keyboard-accessible" as
   "the application is". (Feedback image thumbnails, on the team board and
   the super-admin console, were four of these findings; since 2026-10-07
   they are buttons opening the image in a dialog. The session timer was four
   more: setting it and silencing its alarm went through clickable `div`s, so
   the keyboard could start it but not set it, and a participant could not
   silence it at all. Since 2026-10-08, in the one timer both session types
   share, the time is a button whenever pressing it does something — setting
   the duration, silencing the alarm — and its name carries the time shown; the
   editor it opens takes focus, saves on Enter and cancels on Escape.)
2. **Screens not covered by the automated audit.** The fourteen states of
   `e2e/accessibility-audit.spec.ts` are the main flows, and they include a
   dark screen at each end (both close screens). `e2e/jira.spec.ts` adds seven
   Jira screens: the Dashboard's Actions tab, audited whole, and six audited
   only within the feature's own area (the console's Jira card, the team's
   *Settings → Jira* card in project mode and in the one-parent-per-session
   mode, the batch dialog without and with its parent-issue field and list,
   and the Review step without the session header and participants panel).
   The administration console is audited whole, once per tab
   (`e2e/admin-console-accessibility.spec.ts`). The team feedback board, the
   template builders, the Dashboard's Retrospectives, Health Checks and
   Settings tabs (apart from the Jira card), the retrospective's Welcome, Vote
   and Discuss phases, its Review step outside the Jira scope, and the health
   check's Discuss and Review phases are checked by the lint rules but have no
   axe run. **This gap has now cost something measurable:** the nameless switch
   in the row above is a defect axe *does* report, sitting on a dialog the audit
   never opens. A source-level guard found it; the run would have, had it gone
   there. (The console was the previous case: measured once on 2026-10-20 at
   182 `color-contrast` nodes and one `label` finding, both fixed — the label in
   41.0, the contrast on 2026-10-22.)
3. **54 buttons announce their icon before their label.** A button with both
   an icon and text — "Save Message", "What's New" — has no `aria-hidden` on
   the icon span, so its name is the ligature *and* the text:
   "auto_awesome What's New". This is not a conformance failure: the name
   exists, it contains the visible label, and the control is identifiable. It
   is noise, on 54 controls. It is not swept here on purpose — several of those
   icons are state-bearing (a spinner while saving, a lock on a protected
   backup), and hiding one loses information a sighted user gets. Like the 17
   `autoFocus` attributes, this needs a judgement per site rather than a
   find-and-replace.
4. **No testing with real assistive technology.** Everything above is measured
   with automated tools and a scripted keyboard walk. Nobody has driven this
   product with a screen reader, a switch device or voice control, and no
   external audit has been commissioned. Automated tools are estimated to catch
   roughly a third of real accessibility barriers.
5. **Colour choices are the facilitator's.** Column colours are user-chosen.
   Titles are darkened automatically until they are readable, but a facilitator
   can still pick two colours that are hard to tell apart from each other.
6. ~~Participants' avatars in a session with more than one person.~~ Closed
   2026-10-22, see *What was found*.
7. **A hidden card is hidden from sight only.** With "Reveal cards" off (the
   default), another participant's card keeps its real text in the page,
   painted transparent under a blur. A screen reader therefore reads every
   hidden card aloud, and axe measures the blur as text at about 1.2:1. The
   audit never walks a participant's Brainstorm with someone else's card on it
   for that reason — it audits the participant in the Group phase, where every
   card is shown. The fix is a placeholder that is not text (with a
   screen-reader-only "Hidden card"), which changes what the reveal feature
   looks like and what it announces, and it is left as a deliberate decision.

## Feedback

If something in this application is not usable for you, tell the team that
operates your deployment — they can reach the maintainers through the
repository's issue tracker. Please say which screen, what you were trying to do,
and what assistive technology you use, if any.

## For maintainers

- The remediation plan and its ordering live in `HARDENING_STATUS.md` (finding
  H42).
- **Never raise either ratchet to make a change pass.** Lower `BASELINE` in
  `e2e/helpers/axe.ts` and `BUDGET` in `scripts/lint.mjs` in the
  same change that removes a finding. A screen joins the audit at zero. A new accessibility violation is a defect
  like any other.
- When adding a modal, use `components/common/ModalDialog.tsx`. Rebuilding the
  overlay by hand is how the product ended up with thirteen of them and one
  `role="dialog"`.
- A participant's colour reaches the screen through
  `utils/participantColors.ts` (`avatarColorClasses` for initials,
  `participantColorClass` for dots), never as a raw class. A colour added to
  the palette needs its initials' colour in that module's table, and the theme
  test will ask for it.
