# Offline / Air-Gapped Deployment

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


**CRITICAL**: This application is deployed on internal networks where devices (especially mobile phones on corporate Wi-Fi) have **no internet access**. All resources must be self-hosted.

### Rules
- **NEVER load resources from external URLs** — no CDNs, no Google Fonts, no external APIs, no remotely hosted images, sounds, or scripts
- **All static assets** (fonts, images, sounds, icons) MUST be placed in the `public/` directory and referenced with absolute local paths (e.g. `/fonts/...`, `/assets/...`)
- **All npm dependencies** used in the frontend are bundled by Vite at build time — this is fine and works offline
- **No external service calls from the frontend** — if a feature needs an external API (e.g. QR code generation), use a client-side library instead

### Current Self-Hosted Assets
| Asset | Location | Purpose |
|-------|----------|---------|
| Material Symbols Rounded | `public/fonts/material-symbols-rounded.woff2` | Icon font for all UI icons (static cut, weight 400, Apache 2.0). 375 kB, where the Outlined cut of 44.x was 253 kB: the whole cut on purpose, not a subset of the icons the screens name, because a column's stored icon is a name chosen from whatever list a past release offered, and a name outside a subset draws as its raw word |
| Material Symbols Outlined | `public/fonts/material-symbols-outlined.woff2` | The icon font of 44.x, kept as the second `src` of the same `@font-face`: font files are not hashed, so during a rolling update a 45.x page can ask a 44.x pod for the Rounded file and get the SPA page instead. Remove it one release after 45.0 |
| Geist | `public/fonts/geist-latin.woff2`, `geist-latin-ext.woff2` | The interface typeface (variable, weights 100 to 900; SIL OFL 1.1) |
| Geist Mono | `public/fonts/geist-mono-latin.woff2`, `geist-mono-latin-ext.woff2` | Digits that change: the timer, counts (variable; SIL OFL 1.1) |
| Typeface licence | `public/fonts/OFL-Geist.txt` | The licence asks that its text travels with the fonts; `__tests__/lookTokens.test.ts` checks it is there |
| Timer alert sound | `public/assets/timer-alert.mp3` | Audio notification when a retrospective or health check timer ends |

The login screen's background texture (`public/assets/cubes.png`) went with
45.0, on purpose and with nothing kept for the rollout: a 44.x login page that
asks a 45.x pod for it during the rolling update is answered the `/assets`
text 404 and shows its plain background until it reloads. Unlike a missing
icon font, nothing is unreadable without it.

### When Adding New Features
1. **Check for external resource dependencies** — if a new library or feature loads something from the internet, find an offline alternative
2. **If you need a new icon** that isn't rendering, the Material Symbols woff2 file may need to be updated — re-download the Rounded static cut (weight 400) from Google Fonts and replace `public/fonts/material-symbols-rounded.woff2`. The class stays `material-symbols-outlined` and the ligature names are the same in every cut: 45.0 changed the drawing, not the markup, so every test that finds an icon by its text kept working.
   **Every name the application can draw is measured.** The icons written in the components (in an element whose class draws the icon font, written out or through one of the look's `…ICON…` recipes: `__tests__/helpers/iconClass.ts`, the rule `__tests__/iconButtonNames.test.tsx` reads too), the picker's list (`components/iconPickerIcons.ts`) and the built-in template icons are each drawn as one 24px glyph in the built app by `e2e-prod/icon-ligatures.spec.ts` (a missing ligature is the raw word, several characters wide: `groups_off` measured 120px), which also checks that the previous cut still draws them when the Rounded file is unreachable. A stored name no cut draws is read as one that draws through `columnIconName` (today only `clarity` → `light_mode`): call it wherever a column's stored icon reaches the screen.
   ⚠️ **That file is a *static* cut with no `FILL` axis**, so it cannot draw a
   filled variant of anything: `star`, `star_border`, `star_outline` and `grade`
   all resolve to the same outlined glyph in it, which is why
   `components/common/StarRating.tsx` is an inline SVG path rather than a
   `<span className="material-symbols-outlined">`. That is the exception, not a
   new convention — an inline path is as offline-safe as the font, but reach for
   it only when the font genuinely cannot draw the thing. Swapping in the
   variable font to recover `FILL` would replace a shared asset every screen
   depends on; check what that costs before proposing it
3. **QR codes** are generated client-side using the `qrcode` npm package — no external API needed
4. **Test with network disabled** — verify that the feature works with no internet access
5. **Size an icon with the important modifier.** `.material-symbols-outlined`
   in `index.css` is declared outside any cascade layer, so it beats every
   Tailwind utility (which live in `@layer utilities`): a plain `text-sm` on an
   icon has no effect and the glyph stays 24px. Write `text-base! leading-none`
   — `leading-none` because the important size otherwise brings its own
   line-height. That is what left the Jira reason note's icon a 24px glyph
   beside 12px text. Most icons in `components/` still carry an inert size
   class; moving the rule into `@layer base` would make all of them take effect
   at once, an app-wide visual change that needs its own review
