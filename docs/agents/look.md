# The look: one set of theme tokens (45.0)

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


The interface's look lives in the `@theme` block of `index.css`, not in the
components. A component keeps its Tailwind classes (`bg-slate-50`,
`text-indigo-600`, `rounded-xl`, `shadow-xs`) and the block gives those names
their values, so every screen changes at once and none can be left behind in
another look. Tailwind builds that stylesheet from the class names of the
files it scans, and the `@source not` lines at the top of `index.css` keep out
of the scan the Markdown and YAML files, the workflow files and the
directories that are not the application (the tests and specs, the scripts,
the load test, `k8s/`, the tooling's): they name classes the screens never
draw, and those had become about a hundred dead rules of the shipped
stylesheet (103 utility classes, counted by building with and without the
exclusions), about 13 kB of 110 kB. A class named only in a Markdown document
is therefore no longer built (`__tests__/tailwindScanScope.test.ts`, which also
refuses an exclusion that reaches a directory of the application). Most files
at the root are still read, its configuration files among them
(`vite.config.ts`, the Vitest and Playwright configs, `package.json`, the
Dockerfiles, `nginx.conf`); its YAML files are not (`docker-compose.yml`,
`render.yaml`), nor `.gitignore` and `.env.example`, which Tailwind never
reads. And `index.css` styles no class
the screens do not apply (`__tests__/lookTokens.test.ts` → *what index.css
styles*; `.drag-over` and `.scrollbar-hide` went in 45.3). Ten rules:

- **`slate` is the neutral scale and `indigo` the brand**, both redefined step
  by step (slate-900 `#171a2b` is the ink, slate-50 the page, indigo-600
  `#4f3ff0` the brand). The other hues keep Tailwind's values. The radii
  (`rounded-sm` 6px to `rounded-3xl` 22px), the shadows (drawn with the ink
  colour) and the fonts (`font-sans` Geist, `font-mono` Geist Mono) are tokens
  too. A radius the steps do not name is written from them, never as pixels:
  an overlay inside a bordered box takes the box's radius less the border
  (`rounded-[calc(var(--radius-2xl)-2px)]`; `__tests__/lookTokens.test.ts` →
  *one source for a radius*, which reads every arbitrary radius of
  `components/` and `App.tsx`).
- **A colour of the look is written once.** Outside `@theme`, `index.css` and
  the components name tokens (a class, `var(--color-indigo-600)`, mixed as
  `color-mix(in srgb, var(--color-…) N%, transparent)` when it must be
  translucent), never a hex or an `rgb()` of the palette: a literal is a
  second source that the next retune misses. `__tests__/lookTokens.test.ts` →
  *one source for a colour* reads `index.css` outside `@theme` and every
  string, template and JSX text of `components/` and `App.tsx` (comments are
  not read), and refuses there a hex, an `rgb()`, `rgba()`, `hsl()` or
  `hsla()` other than pure white and black; it reads no other notation there,
  so an `oklch()` or a named colour would pass it. Colours that are data stay
  data, listed there (`COLOUR_DATA`) with their reason and every value:
  `ColorPicker`'s list and its start for a column with none, the Dashboard's
  `customColor` for a new template's columns and for a column with none and
  the five steps of its health-check trend waves, and the colour of a column
  Edit Layout adds. An inline style names its theme variable whole
  (`'--color-red-500'`, never `--color-${hue}`): Tailwind emits a theme
  variable only where the sources name it (*names every theme variable a
  screen reads whole*). The body paints the page as `var(--color-slate-50)`,
  and `@theme` keeps no `retro-*` alias of the palette. Inside `@theme` a
  value is written once too: no token copies another token's literal value,
  and no value draws a colour another token holds. It names that token
  (`--color-person-neutral-ink: var(--color-slate-700)`, `--radius:
  var(--radius-sm)`, `--shadow: var(--shadow-sm)`), mixed with transparent
  when it is translucent: every shadow draws slate-900 as
  `color-mix(in srgb, var(--color-slate-900) N%, transparent)`, which in srgb
  keeps the ink's channels and sets only the alpha (*writes each value of
  @theme once*, which reads every declaration of the `@theme` blocks,
  comments left out). `utils/participantColors.ts` keeps the person tones as
  hex for an inline `style`, a mirror its test holds equal
  (`__tests__/participantColors.test.ts` → *hands out as hex exactly the tone
  tokens index.css defines*).
- **Each token has a job, stated as a measured pair** in
  `__tests__/lookTokens.test.ts`, with axe-core's engine. Muted text is
  slate-500 on white, the page, the panels and the brand tints; slate-600 and
  darker read on every light surface; white reads on indigo-500 to 800.
  **slate-400 is an edge, not a text colour**: it draws a control's outline
  at 3:1 on white and on the page (3.41:1 on white) and is far under 4.5:1 there
  as text; on the dark screens it fails on their slate-800 panels (4.14:1), so
  their muted text is slate-200 and -300 (no single value does both jobs). It
  is text in two cases only: a placeholder inside a slate-900 field (5.05:1:
  the Icebreaker's question and the ROTI follow-up), and the label of a
  disabled control, which 1.4.3 does not hold to the text floor (3.41:1 on
  white): the phases a participant cannot press, the current one aside, in
  both session headers (`disabled:text-slate-400`;
  `__tests__/sessionHeaderLook.test.tsx` → *shows a participant phases they
  cannot press as disabled, without opacity*), and the timer's +30s and +1m
  while the session is not live.
  Retune a value in that test first, then in the block.
- **The contrast helper measures what is painted.**
  `__tests__/helpers/tailwindTheme.ts` reads Tailwind's `theme.css` and then
  every `@theme` block of `index.css` (the later value wins, `initial` removes
  one), knows every token by name, blends a translucent background over the one
  behind it, and **throws** on a colour it cannot name (an arbitrary value such
  as `text-[#555]`, a gradient, `opacity-*`, `grayscale`) rather than measure
  white. So a measured element takes its colours from token classes, or from an
  inline `style` that its test reads and measures with `contrastRatio`. A
  `style` laid over an element's own fill sets `backgroundImage`, never the
  `background` shorthand, which sets `background-color` too, to transparent: a
  proposal row's votes' wash (`ProposalActionRow.tsx`) lies over the row's
  white on a light surface (Discuss and the health check's rows) and over no
  fill of its own on the dark one (Close's ROTI follow-up, where it lies on
  the card), and with the shorthand a row holding votes showed the panel's
  slate-50 where a row with none showed white
  (`__tests__/phaseScreensLook.test.tsx` → *lays the votes' wash over the
  proposal row's white, with votes or without*).
- **Fonts are served from this deployment and fall back quietly.** Geist is
  declared with `font-display: swap` and a system stack behind it, so a blocked
  font file costs the look and nothing else; the icon font is `block` (a raw
  ligature name must never flash) with the previous cut as its second source.
  `e2e-prod/production-csp.spec.ts` loads the built app under the policy and
  checks that the text font and the icon font are loaded and that no request
  left the origin. The stylesheet names its fonts by an absolute path
  (`/fonts/…`), which the build carries under the public prefix of a
  `PROXY_BASE_URL` mount: `e2e-prod/dual-url.spec.ts` asks for both families
  by name at that mount, and that every font was fetched under the prefix.
- **A token that the look needs and Tailwind lacks is added to `@theme`**
  (`--color-person-*`, `--ease-settle`), never written as an arbitrary value in
  a class: an arbitrary colour is invisible to the helper and to the next
  retune.
- **The screens share recipes, written where their screens are.** A recipe is
  a full class string (Tailwind's scanner reads only whole strings): the
  dashboard's, the Feedback Hub's and the Dashboard's dialogs' in
  `components/dashboard/dashboardLook.ts` (buttons, fields, cards, chips and
  their measured colour helpers, the switch, segmented choices), the login
  screens' as the constants at the top of `components/TeamLogin.tsx`, the
  dialog frame as `DIALOG_OVERLAY_CLASS` / `DIALOG_PANEL_CLASS` in
  `ModalDialog.tsx`; the session's are written inline in its components, and
  both session headers carry the same class set and mark their current
  phase the same way, with `aria-current="step"`
  (`__tests__/healthCheckLook.test.tsx` compares them). The administration
  console draws with the dashboard's recipes, imported and never copied, plus
  the few it needs of its own in `components/admin/adminLook.ts` (card titles,
  its switch, the tab's icon and count, a table header cell, a row button):
  no colour per verb, no gradient and no control faded by an opacity, which
  `__tests__/superAdminConsoleLook.test.tsx` refuses and measures. Reuse the
  recipe of the screen you are on before writing a new one: one primary button
  per area, a secondary or a quiet one beside it. The login screen's team list
  is its one wide view: from `lg`, six teams or more (the search field's
  threshold, read from every team, never from the matches) take the
  Dashboard's width (`max-w-6xl`) as tiles in exactly two columns, in DOM
  order (never `grid-flow-dense` nor `order-*`), in a flex chain capped at
  the viewport so the page never scrolls on top of the list, while every form,
  a phone and a short list keep the narrow card (`WIDE_COLUMN` and its
  siblings; `e2e/login-team-picker.spec.ts` measures it). A team's name takes
  two lines, then an ellipsis, a long word broken, in every list and at every
  width: one rule, `TEAM_NAME` (`line-clamp-2 wrap-break-word`), for a tile, a
  phone's row and a short list's. Cut on one line, a phone showed "Équipe
  Plateforme…" at 390px; the spec measures "Équipe Plateforme Numérique de
  l'État" on two lines there, while the whole name, ending "de Genève", takes
  three and is still cut after the second.
- **A control's edge is slate-400, not slate-300** (3.41:1 on white against
  1.59:1). A text field's, a select's, a textarea's border and a switch's off
  track are often the only thing that shows where the control is (1.4.11); a
  card's hairline (slate-200) is not a control. `__tests__/fieldEdgeContrast.test.ts`
  reads every field of `components/` with the TypeScript parser, follows its
  class list through constants and conditionals, and measures each border
  against each fill it can take. A field that hovers moves its edge, one step
  darker in the recipe (`FIELD_BOX`'s `hover:border-slate-500`), never to the
  colour it rests on: the open board's search and sort and *Colour by* hovered
  to their own slate-400 until 45.3, so hovering them changed nothing (→ *a
  field's hover moves its edge*). A native checkbox or radio stays native and
  its edge is not measured, but it takes the brand's accent,
  `accent-indigo-600`, which the same suite requires of every one (→ *every
  native checkbox and radio takes the brand accent*); that check also refuses
  an input whose `type` is not written as a literal, or that spreads attributes
  it cannot read or that set its `type`, so no checkbox hides from it. A field
  made read-only — its
  `readonly` attribute, which among the fields drawn with `dashboardLook.ts`'s
  recipe only the Feedback Hub's title and description carry, while a send is
  on its way (`readOnly={submitting}`) — takes the page's grey from
  `FIELD_BOX` (and `FIELD`) as `[&[readonly]]:bg-slate-50`, never as
  `read-only:`. That variant is the `:read-only` pseudo-class, which matches
  every element that is not `:read-write`: every select and every file input,
  disabled or not, and, by the HTML standard, a disabled text field. The
  recipe carried its grey under it from 45.0 to 45.2, which drew the Feedback
  Hub's image field and every select drawn with it grey at rest, the look of
  a draft locked while it is sent: two selects in 45.0 (the new health
  check's template and the Actions tab's new-action assignee), and seven once
  the console took the look in 45.1, with the merge dialog's two teams, the
  console's feedback status and its two Logs filters. From 45.3 they are
  white at rest. The recipe has no disabled look of its own: no text field,
  textarea or select drawn with it is disabled today, the image field carries
  its own `disabled:bg-slate-100 disabled:text-slate-600` (5.86:1, which no
  test measures), and a new disabled field needs `disabled:` colours of its
  own, measured where it is drawn (for the Dashboard and the Feedback Hub, in
  `__tests__/dashboardLook.test.tsx`). Three guards hold the fill.
  `__tests__/dashboardLook.test.tsx` → *the fill of a field made read-only*
  matches the recipe's state fills against a text field and a textarea (made
  read-only, plain and disabled) and a select and a file input (disabled or
  not): only the two made read-only take a fill, and the field's text reads
  at 4.5:1 on it. `__tests__/fieldEdgeContrast.test.ts` → *a field that
  cannot be typed in is never styled as read-only* also reads every select
  and every input of a type that takes no text (checkbox, radio, file…),
  through the recipes, and refuses `read-only:` and `not-read-only:`, after a
  variant or not, and `:read-only` inside an arbitrary variant
  (`[&:read-only]:`, `[&:not(:read-only)]:`). `e2e/dashboard-actions-tab.spec.ts`
  → *draws its fields white at rest, its select included* measures what
  Chromium paints on the Actions tab's form (its text field and its select,
  white at rest), and checks that Chromium reads that select as `:read-only`.
- **A strip that scrolls sideways scrolls vertically too, and clips at its
  padding box.** `overflow-x-auto` turns `overflow-y` to `auto`, so an item
  that hangs a pixel past the strip draws a classic scrollbar and is cut off:
  the tabs' `-mb-px` gave the dashboard's and the console's strips a 1px
  vertical scrollbar at every width, a 1px underline and a focus ring with no
  bottom edge. Such a strip's items take no negative margin and draw their ring
  inside (`.dash-tab:focus-visible`, the phase bar's `outline-offset: -2px`).
  `e2e/no-stray-scrollbars.spec.ts` measures `scrollHeight` and `scrollWidth`
  (Playwright's Chromium hides scrollbars): both strips; on a phone the
  Welcome moods; and the Icebreaker at 320 × 568, 360 × 640, 375 × 667,
  390 × 844 and 414 × 896, under the avatar band and without it, with both
  default questions and the three French ones that take the most lines at
  320px (the skill, historical-figure and pets questions: the pets question
  wraps to more lines there than several longer ones), as the facilitator's
  field and as a participant's text: nothing scrolls inside the field,
  nothing reaches past the question's box or the card, the card's top is
  never cut off and its bottom is within reach, nothing scrolls sideways, and
  the facilitator's "Random" stays where it was from one question to the next.
  Below `sm` the Icebreaker's card drops its fixed 600px (`sm:h-[600px]`): it
  is as tall as what it holds, the screen scrolls instead
  (`max-sm:overflow-y-auto`), and the card is centred by `max-sm:my-auto`
  under `max-sm:justify-start`, so a card taller than the screen keeps its top
  (centred by `justify-center`, it lost it where no scroll reaches). The
  facilitator's field is as tall as the tallest built-in question of the
  retro's template language, or its own words (its placeholder while empty)
  when they are taller: invisible, `aria-hidden` copies set in the field's own
  box (`QUESTION_BOX`) share its grid cell, one `minmax(0, 1fr)` column that
  no long word widens. It never scrolls inside itself, and it needs no
  `field-sizing` for that (not every browser has it), only that grid; the
  spec runs in Chromium alone, so Safari and Firefox are not measured.
  "Random" never moves the buttons from under the finger from one built-in
  question to the next (a question the facilitator types taller than every
  built-in one still grows the field, and the next "Random" shrinks it back):
  sized to its own words alone, as a first version of the fix was, the field
  moved them with each question, by 39px at 320 × 568 from the French default
  question to the English one. A participant's question takes the field's
  type size there and breaks a word longer than its box. From `sm` up nothing
  changed.
  `__tests__/icebreakerPhoneLayout.test.tsx` holds what jsdom can, since it
  lays nothing out: the copies' texts, their language and `aria-hidden`, and
  the phone-only classes.
- **What must stay on one line is one item of a row that wraps.** A row of
  the Dashboard's Actions tab (`DashboardActionsTab.tsx`) holds the done
  toggle, the action's text and its assignee, and wraps on a phone so that the
  assignee goes under the text rather than squeeze it. The toggle and the text
  are one flex item that never wraps, at least 16rem wide
  (`min-w-[min(16rem,100%)]`: the 36px toggle and its 12px margin, 12rem of
  text and the text's 16px margin), or the row's whole width on a narrower
  screen. Below `sm` only the assignee wraps, under the text, indented 48px
  (`ml-12 sm:ml-0`); from `sm` (640px) a row is one line (`sm:flex-nowrap`).
  The row wraps since 45.0, and until 45.2 the toggle and the text were two
  of its items: below about 338px the toggle took a line of its own above its
  action (every row did at 320px). `e2e/dashboard-actions-tab.spec.ts` →
  *keeps each done toggle on its action's line, and on a phone puts the
  assignee under the text* measures three rows (one assigned, one done) at
  320, 360, 375, 390, 414, 640 and 1280px, in the default `chromium` project
  only (it is not one of the `motion` project's specs). Residual, stated on
  purpose: from about 490px (up to about 580px when a long member name widens
  the select to its 12rem cap) to 639px, the assignee stays on the text's line
  after its 48px phone indent. The row's content box is the viewport less
  82px, and its first line must hold the 256px item, the indent and the
  select, so the assignee fits there from 386px plus the select's width
  (measured in Chromium: from 490px with the default roster's 104px select).
  That band's layout predates 45.3, and the spec measures no width in it: its
  phones stop at 414px.

### A card's colour

Until 45.0 a card was painted in its column's saturated colour with white or
black text. It is now a **soft tint of a hue**, with dark words, and four pure
modules decide it:

- **`utils/columnHue.ts` → `columnHue(column)`**: the column's stored
  `customColor` when it is a hex (short hex too), else the hue its Tailwind
  classes name through a fixed table (a custom template made by an old release
  stores classes only), else `null`. Nothing is written back to the column.
  Everything a session draws in a column's colour reads it there: the board's
  cards and column head, the comments dialog's card, the Discuss topic, the
  origin chip, and the dots of the column navigator and of the AI suggestions
  dialog, both drawn in the hue's `ink` (until 45.3 the dialog's dot read
  `customColor` raw, and painted nothing for a class-only column).
- **`utils/cardTones.ts` → `cardTones(hue)`**: `tint` (the card's background),
  `tintStrong` (an icon tile, an open control), `line` (the border) and `ink`
  (the hue darkened until it reads on both tints), for **any** colour a
  facilitator can pick. `CARD_INK` (slate-900) is the colour of a card's words.
  `__tests__/cardTones.test.ts` measures hundreds of hues: the words at 7:1, the
  ink at 4.5:1. The three strengths (12, 22 and 36 percent of the hue on white)
  are the one place to retune how strong the board looks. Every card asks at
  every draw, and an answer searches up to a hundred candidate inks, so the
  answer for a colour is computed once and handed out again, frozen (a
  thousand cards cost about 50 ms of each draw before); the memory holds 256
  colours and is emptied when full, since any hex can be picked.
- **The hue's source, `utils/cardHue.ts` → `cardHue(ticket, { columns,
  settings, author, readable })`**: by topic, the default, the column the card
  was written in first (`originColId`, which the "from ..." chip names), else
  the column it is in; by author (`colorBy: 'author'`), the author's tone,
  `participantToneHex(author.color).pop` (`utils/participantColors.ts`), and
  the white card for an author the screen does not list. Never by author
  while the session is anonymous, whatever `colorBy` stores, nor when its
  reader cannot read the card. No hue gives the white card.
  `__tests__/cardHue.test.ts` holds each case.

What the screens do with them: a card's background, border and controls are an
inline `style` (so their tests read the style and use `contrastRatio`, since
`effectivePair` reads classes); the column head's icon tile is `tintStrong`
with the ink, and the column's title is plain slate-900 (it used to be painted
in the column's colour); a Discuss card topic and the comments dialog's card
show the same tint as the board. Three places call `cardHue`: the board's
card, whose `readable` is whether its reader can read it, and the comments
dialog and the Discuss card topic, which pass `readable: true` (the dialog
closes when its card is hidden, and Discuss shows every topic). Each finds
the author in the one list of the people a session lists
(`sessionParticipants`, see *Retrospectives and health checks* → *One list of
the people a session lists*), so a Discuss card topic is painted exactly as
its card on the board. A Discuss group topic takes the tint of the column it
sits in (`cardTones(columnHue(column))`), whatever the board is coloured by:
a group has many authors and no column of origin, and the board draws a group
as a neutral panel (slate-50, a dashed slate-300 border) around its tinted
cards. `__tests__/discussTopicTint.test.tsx` renders the real board and the
real Discuss for one session and compares what they paint for a card topic,
and holds a group topic to its column's tint (*a group topic takes its
column's tint*). Three rules the
old model had and the new one keeps: **an anonymous session is never coloured
by author**, **a card hidden
from its reader takes its topic's tint only, never its author's**, and a hidden
card's filler keeps its shape.
