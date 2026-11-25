# Zero Downtime Requirements

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


`PROXY_BASE_URL` optionally supplies a second HTTPS public mount. Only its exact
configured request Host selects the public prefix. The proxy strips that prefix
once. Keep assets, API calls, Socket.IO paths, navigation and mailed links aligned
with the server-rendered public base while preserving root access.

**CRITICAL**: This application is deployed on OpenShift/Kubernetes with rolling updates. Users may be in the middle of a retrospective session when deployments occur.

### Key Principles
- **Never interrupt active sessions** - All features must support seamless reconnection after pod restarts
- **WebSocket reconnection must be automatic** - The `SyncService` automatically rejoins sessions after reconnection (see `services/syncService.ts`)
- **State must be persistent** - Session state is stored in PostgreSQL/SQLite and synchronized across pods via Socket.IO adapters (Redis or PostgreSQL)

### When Developing New Features
1. **Consider reconnection scenarios** - Will the feature work correctly if the WebSocket disconnects and reconnects mid-operation?
2. **Store necessary state for recovery** - If a feature requires user context, ensure it can be restored after reconnection
3. **Test with rolling updates** - Verify that ongoing sessions survive pod restarts
4. **Use the existing sync patterns** - Follow the `pendingJoin`, `queuedSession`, and auto-rejoin patterns in `syncService.ts`

### Architecture for High Availability
- **Multi-pod support**: Use Redis or PostgreSQL Socket.IO adapter for cross-pod communication
- **Session persistence**: All session state is saved to database on every update
- **Graceful shutdown**: Kubernetes probes (`/health`, `/ready`) ensure proper pod lifecycle management
- **A lost cross-pod adapter is visible, and heals itself**: if the Redis or PostgreSQL Socket.IO adapter fails to initialise, the pod keeps serving with the in-memory adapter (it must — refusing traffic on every pod at once is worse than degraded collaboration), logs the failure loudly, reports it on `/health`, and retries in the background with backoff for roughly ten minutes before leaving the state visible. Alert on `status: 'degraded'`; never gate routing on it
