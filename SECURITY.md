# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

## Reporting a Vulnerability

We take the security of TronRelic seriously. If you discover a security vulnerability, please follow these guidelines:

### How to Report

**Do NOT create public GitHub issues for security vulnerabilities.**

Instead, please report security issues through one of these channels:

1. **GitHub Security Advisory (Preferred)**
   - Navigate to the repository's Security tab
   - Click "Report a vulnerability"
   - Provide detailed information about the vulnerability

2. **Email**
   - Send details to: [security contact - update with your email]
   - Include "SECURITY" in the subject line
   - Provide detailed reproduction steps

### What to Include

When reporting a vulnerability, please include:

- **Description**: Clear description of the vulnerability
- **Impact**: Potential security impact and affected components
- **Reproduction**: Step-by-step instructions to reproduce
- **Environment**: Version, OS, Node.js version, etc.
- **Mitigation**: If you have suggestions for fixes

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Fix Timeline**: Depends on severity
  - Critical: 24-48 hours
  - High: 7 days
  - Medium: 30 days
  - Low: 90 days

## Security Best Practices

### For Contributors

When contributing to TronRelic, please follow these security guidelines:

#### Environment Variables & Secrets

- **Never commit `.env` files** - They contain sensitive credentials
- **Never hardcode secrets** - Use environment variables for all sensitive data
- **Use strong secrets** - Generate with `openssl rand -hex 32`
- **Rotate credentials regularly** - Every 90 days for production systems

#### Authentication

- **Admin endpoints** require `ADMIN_API_TOKEN` authentication
- **Use header-based auth** - Send tokens via `x-admin-token` or `Authorization: Bearer` headers
- **Never use query parameters** for tokens - They appear in logs and browser history

#### API Security

- **Validate all input** - Use Zod schemas for request validation
- **Sanitize user input** - Prevent XSS and injection attacks
- **Rate limit endpoints** - Protect against brute-force and DoS attacks
- **Use HTTPS in production** - Encrypt all traffic

#### Dependencies

- **Keep dependencies updated** - Run `npm audit` regularly
- **Review dependency changes** - Check for suspicious updates
- **Use exact versions** - Pin critical dependencies in `package.json`

### For Deployment

#### Required Secrets

Generate these secrets before deploying:

```bash
# Admin API token (required for /system endpoint)
openssl rand -hex 32

# Telegram webhook secret (if using Telegram integration)
openssl rand -hex 32

# Grafana admin password (if using observability stack)
openssl rand -hex 32
```

#### Environment Checklist
- [ ] `ADMIN_API_TOKEN` - Strong random token for admin endpoints
- [ ] `TRONGRID_API_KEY` - Obtained from https://www.trongrid.io/
- [ ] `TELEGRAM_WEBHOOK_SECRET` - Random token for webhook validation
- [ ] `GRAFANA_ADMIN_PASSWORD` - Strong password for Grafana UI
- [ ] All `.env` files excluded from version control
- [ ] HTTPS enabled for production deployments
- [ ] CORS origins restricted to known domains

#### Production Security

- **Enable HTTPS** - Use TLS/SSL certificates
- **Restrict CORS** - Only allow known origin domains
- **Use rate limiting** - Protect all public endpoints
- **Monitor logs** - Watch for suspicious activity
- **Regular backups** - Encrypt and store securely
- **Security headers** - Helmet.js is enabled by default
- **Database encryption** - Enable encryption at rest for MongoDB

## Vulnerability Disclosure Process

1. **Report received** - Security team acknowledges receipt
2. **Triage** - Team assesses severity and impact
3. **Development** - Fix is developed and tested
4. **Coordination** - Notify affected users if applicable
5. **Release** - Patch is released with security advisory
6. **Disclosure** - Public disclosure after users have time to update

## Security Features

TronRelic implements several security measures:

### Authentication & Authorization

- **Admin middleware** - Validates `ADMIN_API_TOKEN` for sensitive endpoints
- **Header-based auth** - Secure token transmission (no query parameters)
- **Telegram IP allowlist** - Restricts webhook endpoints to Telegram IPs

### Input Validation

- **Zod schemas** - Type-safe validation for all API requests
- **TypeScript** - Compile-time type safety
- **Mongoose models** - Schema validation for database operations

### Infrastructure Security

- **Helmet.js** - Security headers (XSS, clickjacking, etc.)
- **CORS configuration** - Origin restrictions for cross-domain requests
- **Redis namespacing** - Isolated data stores per environment
- **MongoDB connection** - Authenticated database access

### Rate Limiting

- **TronGrid API** - Rotating API keys with 200ms throttling
- **Queue overflow protection** - Max 100 pending blockchain requests
- **Notification throttling** - Prevents spam across WebSocket, Telegram, email

### Secrets Management

- **Environment variables** - All secrets loaded from `.env` files
- **Vault integration** - Optional HashiCorp Vault support
- **AWS Secrets Manager** - Optional AWS integration
- **File-based secrets** - JSON/dotenv file loading

## Known Security Considerations

### Third-Party Dependencies

- **TronGrid API** - External blockchain data provider (rate limits apply)
- **Telegram Bot API** - External messaging service (IP allowlist enforced)
- **Market data providers** - Various external APIs for pricing data

### Data Storage

- **MongoDB** - Stores blockchain transaction data (consider encryption at rest)
- **Redis** - Caches temporary data (configure eviction policies)
- **S3/R2** - Stores user uploads (configure bucket policies and encryption)

### WebSocket Connections

- **Socket.IO** - Real-time updates (ensure origin validation in production)
- **Namespace isolation** - Plugin events are namespaced to prevent conflicts

## Security Updates

Security patches will be released as needed. To stay informed:

- Watch this repository for security advisories
- Subscribe to release notifications
- Follow the changelog for security-related updates

## Acknowledgments

We appreciate responsible disclosure and will acknowledge security researchers who help improve TronRelic's security.

---

**Last Updated:** 2025-10-12
