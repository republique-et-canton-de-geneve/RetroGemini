# RetroGemini

Self-hosted, real-time collaborative retrospectives and team health checks. No external SaaS dependencies - all data stays on your server.

## Features

- **Team Workspaces**: Password-protected team spaces with member management
- **Retrospective Templates**: Start/Stop/Continue, 4Ls, Mad/Sad/Glad, Sailboat, and custom templates
- **Guided Sessions**: Icebreaker, Brainstorm, Group, Vote, Discuss, Review, and Close phases
- **Health Checks**: Track team health metrics over time with customizable categories
- **Real-time Collaboration**: Live sync via WebSockets - see updates instantly
- **Action Items**: Track action items with assignment and carry-over between sessions
- **Anonymous Brainstorming**: Optional anonymous mode during brainstorming phase
- **Email Invitations**: Optional SMTP integration for sending invite links

## Quick Start

### One-Command Docker Deployment

```bash
docker run -d -p 8080:8080 -v retro-data:/data ghcr.io/your-org/retrogemini:latest
```

Then open http://localhost:8080 in your browser.

### Docker Compose

```bash
# Clone the repository
git clone https://github.com/your-org/retrogemini.git
cd retrogemini

# Start the application
docker-compose up app
```

The application will be available at http://localhost:8080.

## Deployment Options

### Railway

1. Fork this repository
2. Create a new project in Railway from your fork
3. **Important**: Add a persistent volume mounted at `/data` to prevent data loss
4. Deploy - Railway will use the included `Dockerfile`

> Without a persistent volume, data is stored in `/tmp` and will be lost on each deploy!

### Docker

```bash
# Build the image
docker build -t retrogemini .

# Run with persistent storage
docker run -d \
  --name retrogemini \
  -p 8080:8080 \
  -v /path/to/data:/data \
  retrogemini
```

### Docker Compose (Production)

```bash
docker-compose up -d app
```

Data is automatically persisted in a Docker volume named `retro-data`.

### GitHub Actions (Docker Hub Manual Deploy)

To publish a Docker image to Docker Hub from GitHub Actions, configure the following
repository secrets and manually run the workflow:

1. Add secrets in **Settings → Secrets and variables → Actions**:
   - `DOCKERHUB_USERNAME`: your Docker Hub username
   - `DOCKERHUB_TOKEN`: a Docker Hub access token
   - `DOCKERHUB_REPOSITORY`: the full repository name (e.g. `your-org/retrogemini`)
2. Update `app-version.json` with the next release version (format `x.y`).
3. Open **Actions → Deploy Docker Image → Run workflow**.

The workflow builds from `Dockerfile` and pushes the image to Docker Hub under
`DOCKERHUB_REPOSITORY:<app-version>` and `DOCKERHUB_REPOSITORY:latest`.

### Kubernetes / OpenShift

The `k8s/` directory contains Kustomize manifests with automatic PVC creation:

```bash
# OpenShift
oc new-project retrogemini
oc apply -k k8s/overlays/prod

# Kubernetes
kubectl create namespace retrogemini
kubectl apply -k k8s/overlays/prod -n retrogemini
```

The manifests include:
- Deployment with resource limits and health checks
- Service (ClusterIP)
- PersistentVolumeClaim (1Gi)
- Route/Ingress (OpenShift)

## Configuration

All configuration is via environment variables. See [`.env.example`](.env.example) for the complete list.

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8080` |
| `DATA_STORE_PATH` | SQLite database path | `/data/data.sqlite` |
| `SMTP_HOST` | SMTP server hostname | _(disabled)_ |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_SECURE` | Use TLS for SMTP | `false` |
| `SMTP_USER` | SMTP username | _(none)_ |
| `SMTP_PASS` | SMTP password | _(none)_ |
| `FROM_EMAIL` | Sender email address | `SMTP_USER` |
| `SUPER_ADMIN_PASSWORD` | Enables the super admin panel when set | _(disabled)_ |

### Super Admin Panel

Set `SUPER_ADMIN_PASSWORD` to enable the super admin panel and API endpoints. This is disabled by default.

**Docker run example:**

```bash
docker run -d \
  --name retrogemini \
  -p 8080:8080 \
  -v /path/to/data:/data \
  -e SUPER_ADMIN_PASSWORD='change-me' \
  retrogemini
```

**Docker Compose example:**

```yaml
services:
  app:
    environment:
      SUPER_ADMIN_PASSWORD: "change-me"
```

### Data Persistence

The application uses SQLite for data storage. The server tries these locations in order:

1. `DATA_STORE_PATH` environment variable (if set)
2. `/data/data.sqlite` (recommended for containers)
3. `/tmp/data.sqlite` (ephemeral - **data will be lost!**)
4. `./data.sqlite` (current directory)

> A warning is logged at startup if ephemeral storage is used.

### Corporate Proxy / MITM SSL

For environments with corporate proxies that perform SSL inspection:

```bash
# Set proxy environment variables
export HTTP_PROXY=http://proxy.example.com:8080
export HTTPS_PROXY=http://proxy.example.com:8080
export NO_PROXY=localhost,127.0.0.1

# Add custom CA certificates
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.crt
```

In Docker Compose, uncomment the proxy section in `docker-compose.yml`.

In Kubernetes, add these as environment variables in the deployment.

## Development

### Prerequisites

- Node.js 20+
- npm

### Local Development

```bash
# Install dependencies
npm install

# Start the backend (port 3000)
npm run start

# In another terminal, start the frontend (port 5173)
npm run dev
```

The Vite dev server proxies API and WebSocket requests to the backend.

### Development with Docker

```bash
docker-compose --profile dev up dev
```

This starts the Vite dev server with hot reload at http://localhost:5173.

### Project Structure

```
.
├── App.tsx                 # Main React component
├── components/             # React components
│   ├── Dashboard.tsx       # Team and session management
│   ├── Session.tsx         # Retrospective session
│   ├── HealthCheckSession.tsx  # Health check session
│   ├── TeamLogin.tsx       # Team authentication
│   └── InviteModal.tsx     # Invitation modal
├── services/               # Client services
│   ├── dataService.ts      # State management
│   └── syncService.ts      # WebSocket sync
├── server.js               # Express + Socket.IO backend
├── types.ts                # TypeScript interfaces
├── k8s/                    # Kubernetes manifests
├── Dockerfile              # Production image
├── Dockerfile.dev          # Development image
└── docker-compose.yml      # Docker Compose configuration
```

## Architecture

- **Frontend**: React 19 + Vite + Tailwind CSS
- **Backend**: Express 5 + Socket.IO 4
- **Database**: SQLite (better-sqlite3) with WAL mode
- **Container**: Node 20 Alpine, non-root user

### Security Features

- Non-root container execution (OpenShift compatible)
- No external data services - all data stays local
- Password-protected team workspaces
- Security headers configured in nginx
- Health endpoints for orchestration: `/health`, `/ready`

## Quality & Security

This project maintains high standards for code quality and security:

### Automated Testing
- **Unit Tests**: Vitest with 10%+ coverage threshold
- **Security Tests**: Authentication, data isolation, XSS protection
- **Integration Tests**: WebSocket synchronization, state management
- Run tests: `npm test` or `npm run test:coverage`

### Code Quality
- **ESLint**: Static analysis with TypeScript and React rules
- **Type Safety**: Full TypeScript coverage
- **Pre-commit Hooks**: Automatic linting and type-checking before commits
- Run quality checks: `npm run lint && npm run type-check`

### Security Scanning
- **CodeQL**: Automated code security analysis (weekly + on PRs)
- **Dependency Review**: Blocks PRs with vulnerable dependencies
- **Docker Image Scanning**: Trivy scans for container vulnerabilities
- **npm Audit**: Regular dependency vulnerability checks

### CI/CD Pipeline
Every push and pull request automatically:
1. Runs ESLint for code quality
2. Performs TypeScript type-checking
3. Executes full test suite with coverage
4. Builds production artifacts
5. Scans for security vulnerabilities
6. Analyzes Docker images (on main/develop)

See [MAINTENANCE.md](MAINTENANCE.md) for detailed quality tools documentation.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

For security concerns, please see [SECURITY.md](SECURITY.md).

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
