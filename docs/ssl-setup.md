# SSL/HTTPS Setup Guide

This guide explains how to set up SSL/HTTPS certificates for TronRelic using Let's Encrypt and Certbot.

## Prerequisites

Before setting up SSL, ensure:

1. **Domain Configuration**
   - You have a registered domain name (e.g., `tronrelic.com`)
   - DNS A record points your domain to your droplet's IP address
   - DNS propagation is complete (check with `dig yourdomain.com`)

2. **Server Requirements**
   - TronRelic is deployed using `./scripts/droplet-deploy.sh`
   - Nginx is installed and running
   - Ports 80 and 443 are open in firewall (UFW)
   - Application is accessible via HTTP at `http://your-ip/`

3. **Information Needed**
   - Droplet IP address (e.g., `<PROD_DROPLET_IP>`)
   - Your domain name (e.g., `tronrelic.com`)
   - Your email address (for Let's Encrypt notifications)

## Quick Start

Run the SSL setup script from your local machine:

```bash
./scripts/droplet-setup-ssl.sh <droplet-ip> <domain> <email>
```

**Example:**
```bash
./scripts/droplet-setup-ssl.sh <PROD_DROPLET_IP> tronrelic.com admin@tronrelic.com
```

The script will:
1. Verify DNS configuration
2. Install Certbot and Nginx plugin
3. Obtain SSL certificate from Let's Encrypt
4. Configure Nginx with SSL and security headers
5. Set up automatic HTTP → HTTPS redirect
6. Update environment variables to use HTTPS URLs
7. Test automatic certificate renewal
8. Restart frontend to apply changes

## What the Script Does

### 1. DNS Verification
The script verifies that your domain resolves to the correct IP address:
- Queries DNS using Google's 8.8.8.8 resolver
- Compares resolved IP with expected droplet IP
- Fails early if DNS is not configured correctly

### 2. Certbot Installation
Installs Let's Encrypt Certbot if not already present:
```bash
apt install -y certbot python3-certbot-nginx
```

### 3. SSL Certificate Issuance
Obtains a free SSL certificate from Let's Encrypt:
- Validates domain ownership using HTTP-01 challenge
- Issues certificate valid for 90 days
- Automatically renews before expiration

### 4. Nginx SSL Configuration
Updates Nginx with enhanced security settings:
- **TLS 1.2/1.3** protocols only (no older versions)
- **Modern cipher suites** for strong encryption
- **OCSP Stapling** for faster certificate validation
- **Security headers**:
  - `Strict-Transport-Security` (HSTS) - Force HTTPS
  - `X-Frame-Options` - Prevent clickjacking
  - `X-Content-Type-Options` - Prevent MIME sniffing
  - `X-XSS-Protection` - XSS attack protection
  - `Referrer-Policy` - Control referrer information
- **HTTP → HTTPS redirect** for all traffic
- **Gzip compression** for faster page loads
- **WebSocket support** with extended timeouts

### 5. Environment Variable Updates
Updates `/opt/tronrelic/.env` to use HTTPS URLs:
```bash
NEXT_PUBLIC_API_URL=https://yourdomain.com/api
NEXT_PUBLIC_SOCKET_URL=https://yourdomain.com
NEXT_PUBLIC_SITE_URL=https://yourdomain.com
```

### 6. Frontend Restart
Restarts the frontend container to apply new environment variables:
```bash
docker compose restart frontend
```

## Certificate Management

### Automatic Renewal
Let's Encrypt certificates expire after 90 days. Certbot automatically renews them using a systemd timer.

**Check renewal timer status:**
```bash
ssh root@your-droplet "systemctl status certbot.timer"
```

**Test renewal (dry run):**
```bash
ssh root@your-droplet "certbot renew --dry-run"
```

### Manual Operations

**View certificate information:**
```bash
ssh root@your-droplet "certbot certificates"
```

**Force manual renewal:**
```bash
ssh root@your-droplet "certbot renew --force-renewal"
ssh root@your-droplet "systemctl reload nginx"
```

**Revoke certificate:**
```bash
ssh root@your-droplet "certbot revoke --cert-path /etc/letsencrypt/live/yourdomain.com/fullchain.pem"
```

## Adding WWW Subdomain

To support both `yourdomain.com` and `www.yourdomain.com`:

1. **Create DNS A record** for `www.yourdomain.com` pointing to your droplet IP

2. **Add certificate for both domains:**
```bash
ssh root@your-droplet "certbot --nginx -d yourdomain.com -d www.yourdomain.com"
```

3. **Update Nginx configuration** to include both domains in `server_name`

## Troubleshooting

### DNS Not Resolving

**Problem:** Script fails with "Domain does not resolve to expected IP"

**Solution:**
```bash
# Check current DNS resolution
dig +short yourdomain.com

# Wait 5-15 minutes for DNS propagation
# Verify with multiple DNS servers
dig @8.8.8.8 +short yourdomain.com
dig @1.1.1.1 +short yourdomain.com
```

### Port 80 Blocked

**Problem:** Certbot fails with "Connection refused" or "Timeout"

**Solution:**
```bash
# Check UFW firewall status
ssh root@your-droplet "ufw status"

# Ensure port 80 is allowed
ssh root@your-droplet "ufw allow 80/tcp"

# Check Nginx is listening on port 80
ssh root@your-droplet "ss -tuln | grep :80"
```

### Certificate Validation Failed

**Problem:** Let's Encrypt cannot validate domain ownership

**Solution:**
```bash
# Verify Nginx is serving the challenge directory
ssh root@your-droplet "curl -I http://localhost/.well-known/acme-challenge/test"

# Check Nginx logs for errors
ssh root@your-droplet "tail -f /var/log/nginx/error.log"

# Ensure default site is disabled
ssh root@your-droplet "ls -la /etc/nginx/sites-enabled/"
```

### Mixed Content Errors

**Problem:** Browser shows "Mixed content" warnings after enabling HTTPS

**Solution:**
- Verify all `NEXT_PUBLIC_*` variables use `https://` in `/opt/tronrelic/.env`
- Restart frontend: `ssh root@your-droplet "cd /opt/tronrelic && docker compose restart frontend"`
- Clear browser cache and hard reload (Ctrl+Shift+R)

### WebSocket Connection Failed

**Problem:** Real-time features stop working after SSL setup

**Solution:**
```bash
# Verify WebSocket proxy configuration
ssh root@your-droplet "nginx -T | grep -A 10 'location /socket.io'"

# Check extended timeouts are set
ssh root@your-droplet "nginx -T | grep proxy_read_timeout"

# Test WebSocket connection
wscat -c wss://yourdomain.com/socket.io/
```

## SSL Testing

### Online SSL Checkers

**SSL Labs Test** (comprehensive security analysis):
```
https://www.ssllabs.com/ssltest/analyze.html?d=yourdomain.com
```

Target rating: **A or A+**

**Security Headers Check:**
```
https://securityheaders.com/?q=yourdomain.com
```

### Manual Testing

**Test HTTPS connection:**
```bash
curl -I https://yourdomain.com
```

**Test HTTP → HTTPS redirect:**
```bash
curl -I http://yourdomain.com
# Should show: HTTP/1.1 301 Moved Permanently
# Location: https://yourdomain.com/
```

**Test HSTS header:**
```bash
curl -I https://yourdomain.com | grep Strict-Transport-Security
# Should show: Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

**Test WebSocket over SSL:**
```bash
npm install -g wscat
wscat -c wss://yourdomain.com/socket.io/?EIO=4&transport=websocket
```

## Security Best Practices

### HSTS Preload
After SSL is stable for a few weeks, consider adding your domain to the HSTS preload list:
- Test thoroughly with `max-age=300` first
- Then increase to `max-age=63072000`
- Submit to https://hstspreload.org/

### Certificate Monitoring
Set up monitoring to alert before certificate expiration:
- Use a service like UptimeRobot or Pingdom
- Monitor certificate expiration date
- Alert if expiring within 7 days (indicates auto-renewal failure)

### Regular Updates
Keep Certbot and Nginx updated:
```bash
ssh root@your-droplet "apt update && apt upgrade -y certbot nginx"
```

## Files Modified by SSL Setup

The SSL setup script modifies these files on the droplet:

```
/etc/nginx/sites-available/tronrelic          # Nginx configuration
/etc/nginx/sites-enabled/tronrelic            # Symlink to config
/etc/letsencrypt/live/yourdomain.com/         # SSL certificates
/opt/tronrelic/.env                           # Environment variables
```

**Backup locations:**
```
/etc/nginx/sites-available/tronrelic.backup   # Original Nginx config
```

## Reverting SSL Setup

If you need to revert to HTTP-only:

```bash
# SSH into droplet
ssh root@your-droplet

# Restore original Nginx config
cp /etc/nginx/sites-available/tronrelic.backup /etc/nginx/sites-available/tronrelic
nginx -t && systemctl reload nginx

# Update environment variables back to HTTP
cd /opt/tronrelic
sed -i 's|https://|http://|g' .env
docker compose restart frontend

# (Optional) Revoke SSL certificate
certbot revoke --cert-path /etc/letsencrypt/live/yourdomain.com/fullchain.pem
```

## Cost

Let's Encrypt SSL certificates are **completely free**:
- No cost for certificate issuance
- No cost for renewals
- Unlimited certificates
- No hidden fees

## Support

**Let's Encrypt Documentation:**
- https://letsencrypt.org/docs/

**Certbot Documentation:**
- https://certbot.eff.org/docs/

**Nginx SSL Configuration:**
- https://nginx.org/en/docs/http/configuring_https_servers.html

**Mozilla SSL Configuration Generator:**
- https://ssl-config.mozilla.org/
