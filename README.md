# RetroGemini

[![CI](https://github.com/republique-et-canton-de-geneve/RetroGemini/actions/workflows/ci.yml/badge.svg)](https://github.com/republique-et-canton-de-geneve/RetroGemini/actions/workflows/ci.yml)
[![Docker Pulls](https://img.shields.io/docker/pulls/jpfroud/retrogemini)](https://hub.docker.com/r/jpfroud/retrogemini)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](LICENSE)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/republique-et-canton-de-geneve/RetroGemini)

**Private-by-design, real-time Scrum retrospectives and team health checks for organizations that need to keep their data on their own infrastructure.**

RetroGemini was created at the **State of Geneva** and is already used by around **30 internal teams**. Because candid retrospective feedback can be sensitive, our public administration cannot send it to external cloud services. RetroGemini keeps the complete application and its data under the organization's control.

This makes it a strong fit for public-sector, healthcare, finance, regulated, privacy-conscious, and air-gapped environments — or simply for teams that prefer to own their tools and data.

> No external service is required at runtime. SMTP and OpenAI-compatible AI features are optional and disabled unless you configure them.

If RetroGemini solves a problem for your organization, please [star the repository](https://github.com/republique-et-canton-de-geneve/RetroGemini) so more self-hosting and Agile teams can find it.

## Try it in 60 seconds

You only need Docker:

```bash
docker run -d \
  --name retrogemini \
  -p 8080:8080 \
  -v retro-data:/data \
  jpfroud/retrogemini:latest
```

Open [http://localhost:8080](http://localhost:8080), create a team, and start a retrospective.

The named Docker volume keeps your test data across container restarts. For a production deployment, also set a stable `SESSION_TOKEN_SECRET`, use HTTPS through your reverse proxy, and review the configuration below.

### One-click temporary demo

The **Deploy to Render** button above creates a free personal evaluation instance from the latest published Docker image.

Render's free web services sleep after 15 minutes without traffic and use an ephemeral filesystem. The demo's SQLite data is therefore cleared whenever the service sleeps, restarts, or redeploys. Use this path to explore the product, not for a real team deployment.

## What teams get

| Area | Capabilities |
| --- | --- |
| Retrospectives | Start/Stop/Continue, 4Ls, Mad/Sad/Glad, Sailboat, KALM, DAKI, Starfish, Rose/Thorn/Bud, Hot Air Balloon, Speed Car, Lean Coffee, Three Little Pigs, and custom templates |
| Guided facilitation | Icebreaker, Brainstorm, Group, Vote, Discuss, Review, and Close phases, with contextual tips and timeboxes |
| Live collaboration | Real-time WebSocket sync, participant presence, typing activity, anonymous brainstorming, comments, grouping, and voting |
| Continuous improvement | Action proposals, assignees, carry-over between sessions, ROTI follow-up, reports, and team health trends |
| Team administration | Password-protected workspaces, member management, invitations, favorites, search, feedback hub, backup, and restore |
| Optional AI | OpenAI-compatible ticket grouping, retrospective summaries, and cross-retrospective release analysis |
| Enterprise deployment | SQLite or PostgreSQL, multi-pod Socket.IO adapters, Redis support, rolling-update recovery, proxies, custom CAs, Kubernetes, and OpenShift |
| Privacy | Self-hosted assets, no CDN dependency, offline and air-gapped operation, non-root container, and organization-controlled storage |

## Why RetroGemini

- **Your retrospective data stays with you.** The core application makes no external service calls and can run on an isolated network.
- **It is designed for real facilitation.** Sessions follow a clear workflow rather than presenting an unstructured sticky-note board.
- **It supports the work after the retro.** Actions, decisions, health checks, reports, and follow-up remain visible over time.
- **It starts small and scales.** Use one Docker container with SQLite, or PostgreSQL plus Redis/PostgreSQL adapters for multiple pods.
- **It has real organizational usage.** The product is shaped by feedback from approximately 30 teams at the State of Geneva.
- **It is open source with a permissive public-domain license.** Use, adapt, and redistribute it without vendor lock-in.

## Docker Compose

```bash
git clone https://github.com/republique-et-canton-de-geneve/RetroGemini.git
cd RetroGemini
docker compose up -d app
```

The application is available at [http://localhost:8080](http://localhost:8080), with data persisted in the `retro-data` volume.

## Production example

Generate and keep a stable secret in your secret manager, then run:

```bash
docker run -d \
  --name retrogemini \
  --restart unless-stopped \
  -p 8080:8080 \
  -v /path/to/retrogemini-data:/data \
  -e SESSION_TOKEN_SECRET='replace-with-a-long-random-secret' \
  -e SUPER_ADMIN_PASSWORD='replace-with-a-strong-admin-password' \
  jpfroud/retrogemini:latest
```

Put RetroGemini behind an HTTPS reverse proxy before exposing it outside a trusted network.

## Deployment options

### Docker

Build the image yourself if you do not want to pull the published image:

```bash
docker build -t retrogemini .
docker run -d \
  --name retrogemini \
  -p 8080:8080 \
  -v /path/to/data:/data \
  retrogemini
```

### Kubernetes / OpenShift

See [the Kubernetes and OpenShift guide](k8s/README.md). The container runs as a non-root user and exposes `/health` and `/ready` probes.

### Railway

1. Fork this repository.
2. Create a Railway project from your fork.
3. Add a persistent volume mounted at `/data`.
4. Deploy using the included `Dockerfile` and `railway.toml`.

Without a persistent volume, SQLite data is ephemeral and will be lost during redeployments.

## Configuration

All configuration is provided through environment variables. See [`.env.example`](.env.example) for the complete list.

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | Server port | `3000` (`8080` in Docker) |
| `DATABASE_URL` | PostgreSQL connection URL; PostgreSQL is used instead of SQLite when set | SQLite |
| `DATA_STORE_PATH` | SQLite database path | `/data/data.sqlite` |
| `REDIS_URL` | Redis connection for the multi-pod Socket.IO adapter | Disabled |
| `SMTP_HOST` | SMTP server for invitations and notifications | Disabled |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_SECURE` | Use TLS for SMTP | `false` |
| `SMTP_USER` | SMTP username | None |
| `SMTP_PASS` | SMTP password | None |
| `FROM_EMAIL` | Sender email address | `SMTP_USER` |
| `SUPER_ADMIN_PASSWORD` | Enable the super-admin panel | Disabled |
| `SESSION_TOKEN_SECRET` | Stable HMAC secret for sessions and invitation credentials; use the same value on every pod | Random per process |
| `RESTORE_MAX_BODY_MB` | Maximum compressed restore upload size | `128` |
| `RESTORE_MAX_DECOMPRESSED_MB` | Maximum decompressed restore size | `512` |
| `AUTH_RATE_LIMIT_MAX` | Team-create and restore requests per IP per 15 minutes | `5` |
| `TRUST_PROXY` | Express trust-proxy setting | `1` in production |
| `WIFI_SSID` | Wi-Fi name for an optional offline-network QR code | Disabled |
| `WIFI_PASSWORD` | Wi-Fi password for the optional QR code | Disabled |
| `SOCKET_UPDATE_RATE` | Sustained session updates per second allowed per socket | `0` (disabled) |
| `SOCKET_UPDATE_BURST` | Short update burst allowed above the sustained rate | `2 × rate` |

### Data persistence

RetroGemini supports two database backends:

- **SQLite** for a simple single-container or single-pod deployment.
- **PostgreSQL** for production and multi-pod deployments.

For SQLite, the server tries these locations in order:

1. `DATA_STORE_PATH`
2. `/data/data.sqlite`
3. `/tmp/data.sqlite` — ephemeral
4. `./data.sqlite`

A warning is logged when ephemeral storage is used.

For multiple pods, Socket.IO uses Redis when `REDIS_URL` or `REDIS_HOST` is configured. Otherwise it uses the PostgreSQL adapter when PostgreSQL is the data store.

### Corporate proxy and custom CA

```bash
export HTTP_PROXY=http://proxy.example.com:8080
export HTTPS_PROXY=http://proxy.example.com:8080
export NO_PROXY=localhost,127.0.0.1
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.crt
```

The same variables can be configured in Docker Compose, Kubernetes, or OpenShift.

## Architecture

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS
- **Backend:** Express 5, Socket.IO 4
- **Storage:** SQLite with WAL mode or PostgreSQL
- **Scale-out:** Redis or PostgreSQL Socket.IO adapter
- **Container:** Node 26 Alpine, non-root user

The application is designed to survive rolling updates: session state is persisted, WebSocket clients reconnect automatically, and participants rejoin their active session.

## Quality and security

Every pull request runs linting, TypeScript checks, unit and integration tests, a production build, dependency review, CodeQL analysis, and container vulnerability scanning.

Useful local checks:

```bash
npm run lint
npm run type-check
npm test
npm run build
npm run test:e2e
```

See [MAINTENANCE.md](MAINTENANCE.md), [HARDENING_STATUS.md](HARDENING_STATUS.md), and [SECURITY.md](SECURITY.md) for details.

## Development

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run start
```

In another terminal:

```bash
npm run dev
```

The backend runs on port 3000 and the Vite development server on port 5173.

## Built with AI assistance, not dependent on AI

RetroGemini was developed with extensive assistance from Gemini, Claude, and Codex. That describes the development process, not a runtime dependency: the application works without an internet connection or an AI service.

Administrators can optionally connect an OpenAI-compatible model for grouping suggestions and summaries. Those features remain off until explicitly configured.

## Contributing

Bug reports, feature requests, documentation improvements, translations, and code contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

If you deploy RetroGemini, consider opening a discussion or issue to share your environment and feedback. Real-world deployment notes help other organizations adopt it.

## License

RetroGemini is released into the public domain under [The Unlicense](LICENSE). You may use, copy, modify, and distribute it for any purpose without conditions.
