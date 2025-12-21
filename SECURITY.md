# Security Policy

## Reporting Security Issues

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email the maintainers with details of the vulnerability
3. Allow time for the issue to be addressed before public disclosure

## Security Features

### Data Privacy

- **Self-hosted**: All data stays on your server
- **No external services**: No third-party analytics, tracking, or data collection
- **No telemetry**: The application does not phone home

### Container Security

- **Non-root execution**: Container runs as unprivileged user
- **Minimal base image**: Node 20 Alpine for reduced attack surface
- **Security context**: OpenShift-compatible security settings
- **Capability dropping**: All Linux capabilities dropped

### Network Security

- **TLS support**: Configure via reverse proxy (nginx, OpenShift Route)
- **Security headers**: X-Frame-Options, X-Content-Type-Options, etc.
- **Health endpoints**: `/health` and `/ready` for monitoring

## Security Considerations

### Team Passwords

Team passwords provide access control but are stored as-is in the database. For production deployments:

- Use strong, unique passwords for each team
- Consider network-level access controls
- Deploy behind a VPN or authenticated proxy for sensitive environments

### Database Security

- SQLite database is unencrypted at rest
- Ensure the data volume has appropriate filesystem permissions
- Regular backups are recommended

### CORS Configuration

The Socket.IO server accepts connections from any origin by default. For production:

- Deploy behind a reverse proxy that handles CORS
- Use network policies to restrict access

### SMTP Credentials

- SMTP credentials are passed via environment variables
- Do not commit credentials to source control
- Use secrets management in Kubernetes/OpenShift

## Recommended Production Setup

1. **Deploy behind a reverse proxy** (nginx, Traefik, or platform ingress)
2. **Enable TLS** for all connections
3. **Use network policies** to restrict pod-to-pod communication
4. **Mount secrets** for SMTP credentials instead of environment variables
5. **Regular updates** of the base image and dependencies

## Dependency Security

Run regular security audits:

```bash
npm audit
```

Update dependencies regularly to address known vulnerabilities.

## Version Support

Security updates are provided for the latest release only. We recommend always running the latest version.
