# Language & Code Conventions

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


### Language
- **Code**: All code, comments, variable names, and function names MUST be in **English**
- **UI text**: The interface is **bilingual, English and French** (see *Internationalisation* below). English is the source language: every user-facing string is written in English in `i18n/locales/en/` and translated in `i18n/locales/fr/`, and reaches the screen through `t()` — never as a literal in JSX
- **Documentation**: All documentation (README, CHANGELOG, comments) MUST be in **English** — with two exceptions: `CHANGELOG.fr.md`, the French mirror of `CHANGELOG.md` that French readers see in "What's New" (see *Changelog Management → The French mirror*), and the English/French catalogue descriptions in `publiccode.yml`

### File Size Guidance
- LLMs struggle with very large files; prefer clean decomposition into smaller, focused modules instead of long single files.

### Code Style
- Use TypeScript strict mode
- Follow existing code patterns in the codebase
- Use functional React components with hooks
- Use Tailwind CSS for styling (follow existing class patterns)
- No external UI component libraries - use native HTML + Tailwind

### File Organization
```
/
├── components/          # React components
│   ├── common/         # Shared UI primitives (ModalDialog, Avatar, AvatarPicker, StarRating)
│   │   ├── avatars/    # The avatar pictures, as data, and AvatarArt (see Avatars)
│   │   └── motion/     # playEffect, motionAllowed, fly (see Motion)
│   ├── session/        # The pieces both session screens share, phases, votes, panel, header
│   ├── dashboard/      # Dashboard tabs and dialogs; dashboardLook.ts holds its recipes
│   ├── admin/          # Super-admin console dialogs and cards
│   └── jira/           # Jira controls, settings card and status hook (see Jira)
├── utils/              # Pure rules shared by screens (and server, for the .js ones): cardTones, columnHue, cardHue, avatars…
├── public/fonts/       # Self-hosted Geist, Geist Mono and the icon font (see Offline)
├── i18n/               # EN/FR interface dictionaries, language detection, bilingual retro content
├── services/           # Business logic (dataService, syncService)
├── __tests__/          # Test files
├── loadtest/           # Load-test harness (see loadtest/README.md)
├── .github/workflows/  # CI/CD pipelines
├── k8s/                # Kubernetes manifests
├── server/             # Backend modules (routes, services, config)
├── server.js           # Express backend
├── App.tsx             # Main React app
├── index.css           # The look: theme tokens, person tones, effect classes (see The look)
├── types.ts            # TypeScript interfaces
├── publiccode.yml      # Swiss open-source catalogue metadata (English and French)
├── VERSION             # Current version (X.Y format)
├── CHANGELOG.md        # Release notes (shown in "What's New")
├── CHANGELOG.fr.md     # The same release notes in French
└── ACCESSIBILITY.md    # Public accessibility statement (standard, method, gaps)
```
