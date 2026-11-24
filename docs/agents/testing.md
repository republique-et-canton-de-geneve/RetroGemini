# Testing Requirements

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


- **Always run tests** before committing: `npm run test`
- **`eslint-plugin-jsx-a11y` needs its `overrides` entry to install.** Its
  latest release declares `peer eslint ^3 || … || ^9` while this repo runs
  ESLint 10, so `package.json` carries
  `"overrides": { "eslint-plugin-jsx-a11y": { "eslint": "$eslint" } }` — the
  same pattern `eslint-plugin-react-hooks` already uses. Without it **`npm ci`
  fails**, in CI as well as locally. Do not "fix" that with `--legacy-peer-deps`
  or an `.npmrc`: those disable strict resolution for every dependency and would
  absorb a real conflict silently
- **Add tests** for new functionality in `__tests__/` directory
- **Test naming**: `*.test.ts` or `*.test.tsx`
- **Framework**: Vitest + React Testing Library
- **A test on a fake clock unmounts what it rendered, and runs the clock dry,
  before the real clock comes back.** jsdom starts its own rendering interval
  (it serves `requestAnimationFrame` and the focus it repairs when a focused
  element goes) with whatever `setInterval` is installed at that moment. Left
  waiting on a fake clock that is then removed, it never fires again and jsdom
  never starts another: no animation frame runs for the rest of the file, and
  the next test that waits for one (a dialog's first focus) times out, far
  from its cause. So: `view.unmount()` (or `cleanup()`), then
  `act(() => { vi.runOnlyPendingTimers(); })`, then `vi.useRealTimers()`, in
  that order (`modalDialogEntrance.test.tsx`, `avatarScreensWiring.test.tsx`,
  and the `afterEach` of `useSessionMotion`, `panelMotion`,
  `guidedVoteControl`, `boardVoteControl` and `voteBudgetChip`).

- **`locator.isVisible()` does not wait.** Playwright ignores the `timeout`
  it still accepts, so `isVisible({ timeout })` reads a control drawn a moment
  later as absent and takes the wrong way through a form. A spec waits for one
  of the controls it chooses between (`expect(a.or(b).first()).toBeVisible()`)
  and asks after. `__tests__/e2eVisibilityWaits.test.ts` counts, file by file,
  the specs that still ask the old way (they predate 45.3): a count only goes
  down, and a spec fixed leaves its table in the same change.

- **A guard that follows a class list through constants looks a name up once
  per file.** `__tests__/helpers/sourceDeclarations.ts` parses each file once
  (`sourceOf`) and walks its tree once per file and name (`declarationOf`,
  memoized; the depth it takes bounds the imports followed, never a lookup).
  `fieldEdgeContrast.test.ts` and `filterPillState.test.tsx` carried copies
  that walked the tree on every lookup, and the field-edge guard's slowest
  case took 3.9 s of its 5 s in CI's coverage run
  (`__tests__/sourceDeclarations.test.ts`).

### Regression coverage (leave a durable guard, not a throwaway)

Every bug fix, refactor, or feature MUST leave behind at least one **committed**
automated test that fails without the change — this is the safety net that
shrinks future manual regression testing, so never write a test just to verify a
change and then delete it. (A quick, temporary reproduction harness is fine as a
first step, but promote its assertion into a permanent test before finishing;
don't leave the reproduction as the deliverable.)

- **Pick the cheapest level that catches the regression.** Prefer a fast unit
  test (Vitest) that pins the logic/edge case; only reach for e2e (Playwright)
  when the change alters an integrated user-facing flow. Do not add e2e coverage
  for something a unit test can guard.
- **A test of an order must start from another order.** A fixture already in
  the order a test expects lets a sort that does nothing pass it, and a row with
  no value placed last proves nothing about "unknown last".
  `__tests__/superAdminTeamSorting.test.tsx` sends its teams in an order none of
  its sort tests expects, with the team that has neither a retrospective count
  nor a last activity first. Before trusting a new sort test, run it once
  against a sort that returns its input, and watch it fail.
- **Report, per change, so manual testing stays minimal and non-redundant:**
  1. the **new/updated tests** that prove the change,
  2. the **existing tests** that already cover the touched area (so the human
     does not re-test it by hand),
  3. a short **manual-verification list** — only what automated tests genuinely
     cannot cover (visual/layout, real offline/mobile behaviour, real LLM output
     quality, multi-pod Socket.IO timing).
- **Load / scale validation**: `npm run test:load` (`loadtest/` harness) drives
  many parallel retros with many concurrent users over the real HTTP +
  Socket.IO protocol and audits that no user action is lost. Run it against a
  staging environment before changing the session sync protocol
  (`update-session` / `_rev` CAS) or before a capacity-sensitive rollout —
  see `loadtest/README.md` for the strategy and presets
