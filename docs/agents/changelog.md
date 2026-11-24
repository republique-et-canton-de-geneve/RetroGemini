# Changelog Management

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


### CHANGELOG.md Format
The changelog follows [Keep a Changelog](https://keepachangelog.com/) format and is **automatically parsed** by the backend to display announcements to users.

Each released version is **one** `## [X.Y]` block with **one** `###` section and
**one** consolidated bullet:

```markdown
## [X.Y] - YYYY-MM-DD

### Added
- One sentence describing everything new in this version, from the user's point of view
```

The only sections to use for new entries are `### Added`, `### Changed` and
`### Removed`. Do **not** create `### Fixed` or `### Security` entries — bug
fixes and security patches are not user-visible, so they bump `Y` only and stay
out of the changelog (see rules below).

### Changelog Rules — the three that matter most

1. **Exactly ONE entry per version, and ONE bullet.** A release is a single
   `## [X.Y] - YYYY-MM-DD` block with a single `###` section containing **one**
   consolidated bullet that summarises *all* the user-visible changes of that
   version. Never write multiple bullets, and never add multiple `###` sections,
   for the same version — the goal is one readable sentence, not a list of
   technical changes.
2. **Never document bug fixes or security patches.** There is **no `### Fixed`
   or `### Security` entry, ever.** Bug fixes, security patches, refactors,
   tests, docs, CI, deps and deployment config are not user-visible: they only
   bump `Y` and stay out of the changelog entirely.
3. **Every entry has its French counterpart in `CHANGELOG.fr.md`, in the same
   change.** See *The French mirror* below; a test fails the pull request that
   forgets it.

Plus the usual style rules:

3. **Only user-visible changes** - the changelog is displayed to end users in the app
4. **Write from the user's perspective, in present tense** - "Add dark mode", not "Added/Implemented dark-mode feature"
5. **Keep it concise** - 1-2 sentences, no technical jargon or implementation detail
6. **Most recent version at the top**
7. **Choose the single section that fits the release** - `### Added` for a new feature (most common), `### Changed` for improvements to existing behaviour, `### Removed` for a removed feature. If a version mixes a feature with smaller tweaks, use `### Added` and fold them into the one bullet.

### The French mirror (`CHANGELOG.fr.md`)

French readers see "What's New" in French, so every `## [X.Y]` block of
`CHANGELOG.md` has a twin in `CHANGELOG.fr.md`:

- **Same version, same date, same section keyword.** The `### Added` /
  `### Changed` / `### Removed` headings stay in English in the French file:
  they are machine keys the parser maps to an announcement type, not text a
  reader sees.
- **Same number of bullets, in the same order**, each one a faithful French
  sentence: formal *vous*, present tense, the user's point of view. A button,
  phase or tab is named exactly as the French screen shows it — look its label
  up in `i18n/locales/fr/`.
- **Write ordinary spaces** before `? ! : ;` and inside « ». The server
  (`server/services/versionService.js`) inserts the French no-break spaces when
  it parses the file, so authors never type an invisible character.

`/api/version` keeps the English `items` on every announcement — what a client
from before this feature reads during a rolling update — and adds
`localized.fr.items` when the French file has that release. A release missing
from the French file therefore never breaks the modal; it shows in English,
marked `lang="en"`. Completeness is the test's job:
`__tests__/changelogTranslationParity.test.ts` fails when an English release has
no French twin, when the dates, sections or bullet counts differ, when a French
bullet is the English one copied over, or when the French file names a release
the English file does not have. Both files ship in the image (`Dockerfile`,
`.dockerignore`).

### What belongs in the CHANGELOG

| ✅ Document it (and bump `X`) | ❌ Never document it (bump `Y` only) |
|------------------------------|--------------------------------------|
| New user-facing features | Bug fixes |
| UI/UX improvements | Security patches / fixes |
| Removed user-facing features | Internal refactoring (no user impact) |
| | Tests, docs, code comments |
| | GitHub workflow / CI-CD changes |
| | Docker / deployment configuration |
| | Code style / linting fixes |
| | Version & changelog bookkeeping |
| | Dependency updates |

### Section Mapping (for announcements)
| CHANGELOG Section | Announcement Type | Icon Color |
|-------------------|-------------------|------------|
| Added | New Feature | Green |
| Changed | Improvement | Blue |
| Removed | Removed | Gray |
| Fixed | Bug Fix | Amber |
| Security | Security Update | Red |

> `Fixed` and `Security` are listed only so the parser keeps rendering any
> legacy entries. **Do not create new `Fixed` or `Security` entries** — per the
> rules above, bug fixes and security patches are not user-visible and are never
> documented.
