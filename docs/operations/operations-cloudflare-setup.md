# Cloudflare DNS and Wildcard SSL Setup

This document describes how to set up Cloudflare DNS management and wildcard SSL certificates for PR environments.

## Overview

TronRelic PR environments use Cloudflare for dynamic DNS management combined with a single wildcard SSL certificate. This approach enables unlimited PR environments with trusted HTTPS certificates without hitting Let's Encrypt rate limits or requiring reserved static IP addresses.

**Key benefits:**
- Every PR gets a unique subdomain: `pr-{number}.dev-pr.tronrelic.com`
- Single wildcard certificate (`*.dev-pr.tronrelic.com`) covers all PRs
- No Let's Encrypt rate limit concerns (50 certs/week avoided)
- No monthly cost for reserved IP addresses
- Trusted certificates (no browser warnings)

## Prerequisites

- Domain managed by Cloudflare (free tier sufficient)
- Cloudflare API token with DNS edit permissions
- Server with root access for certificate generation

## Step 1: Transfer DNS to Cloudflare

If your domain is not already managed by Cloudflare:

1. **Create Cloudflare account** at https://cloudflare.com
2. **Add your domain** to Cloudflare (free plan)
3. **Update nameservers** at your domain registrar to point to Cloudflare's nameservers
4. **Wait for DNS propagation** (can take up to 48 hours)

## Step 2: Create Cloudflare API Token

The GitHub Actions workflows need API access to create and delete DNS records.

1. **Log in to Cloudflare Dashboard**
2. **Navigate to:** My Profile → API Tokens
3. **Click "Create Token"**
4. **Select "Edit zone DNS" template** or create custom token with:
   - Permissions: `Zone.DNS.Edit`
   - Zone Resources: `Include → Specific zone → tronrelic.com`
5. **Copy the API token** (you won't see it again!)

## Step 3: Get Cloudflare Zone ID

1. **Log in to Cloudflare Dashboard**
2. **Select your domain** (tronrelic.com)
3. **Scroll down in the Overview tab**
4. **Copy the Zone ID** (found in the right sidebar under "API")

Example Zone ID: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

## Step 4: Generate Wildcard SSL Certificate

Generate the wildcard certificate on a server with root access (can be your local machine or a temporary droplet).

### Install Dependencies

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-dns-cloudflare

# macOS (with Homebrew)
brew install certbot
pip3 install certbot-dns-cloudflare
```

### Generate Certificate

```bash
# Set your Cloudflare API token
export CLOUDFLARE_API_TOKEN="your-api-token-here"

# Run the certificate generation script
sudo CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
  ./scripts/cloudflare-wildcard-ssl.sh admin@tronrelic.com
```

This script will:
1. Create Cloudflare credentials file at `/root/.secrets/cloudflare.ini`
2. Request certificate from Let's Encrypt using DNS-01 challenge
3. Wait for DNS propagation (30 seconds)
4. Verify domain ownership via Cloudflare DNS TXT record
5. Generate wildcard certificate valid for 90 days

**Certificate locations:**
- Certificate: `/etc/letsencrypt/live/dev-pr.tronrelic.com/fullchain.pem`
- Private Key: `/etc/letsencrypt/live/dev-pr.tronrelic.com/privkey.pem`

### Certificate Renewal

Let's Encrypt certificates are valid for 90 days. Certbot automatically sets up renewal via cron or systemd timer.

**Manual renewal:**
```bash
sudo certbot renew --cert-name dev-pr.tronrelic.com
```

**Check renewal status:**
```bash
sudo certbot certificates
```

## Step 5: Encode Certificate for GitHub Secrets

GitHub Actions needs the certificate files in base64 format to deploy them to PR droplets.

```bash
# Encode certificate (cross-platform: works on Linux and macOS)
sudo cat /etc/letsencrypt/live/dev-pr.tronrelic.com/fullchain.pem | base64 | tr -d '\n' > cert.b64

# Encode private key (cross-platform: works on Linux and macOS)
sudo cat /etc/letsencrypt/live/dev-pr.tronrelic.com/privkey.pem | base64 | tr -d '\n' > key.b64

# Display for copying to GitHub secrets
echo "WILDCARD_SSL_CERT:"
cat cert.b64
echo ""
echo "WILDCARD_SSL_KEY:"
cat key.b64

# Clean up
rm cert.b64 key.b64
```

## Step 6: Configure GitHub Secrets

Add the following secrets to your GitHub repository:

**Navigate to:** Repository Settings → Secrets and variables → Actions

| Secret Name | Description | How to Get |
|------------|-------------|------------|
| `CLOUDFLARE_API_TOKEN` | API token with DNS edit permissions | Step 2 above |
| `CLOUDFLARE_ZONE_ID` | Zone ID for tronrelic.com | Step 3 above |
| `WILDCARD_SSL_CERT` | Base64-encoded wildcard certificate | Step 5 above |
| `WILDCARD_SSL_KEY` | Base64-encoded wildcard private key | Step 5 above |

**Click "New repository secret"** for each and paste the corresponding value.

## Step 7: Verify DNS Setup

Before triggering a PR workflow, verify that Cloudflare can manage DNS for your domain:

```bash
# Install jq for JSON parsing
sudo apt-get install -y jq

# Test DNS record creation
export CLOUDFLARE_API_TOKEN="your-api-token"
export CLOUDFLARE_ZONE_ID="your-zone-id"
./scripts/cloudflare-dns-add.sh pr-test 192.0.2.1

# Verify DNS record
dig pr-test.dev-pr.tronrelic.com

# Test DNS record deletion
./scripts/cloudflare-dns-delete.sh pr-test
```

Expected output:
```
✅ DNS record created successfully: pr-test.dev-pr.tronrelic.com -> 192.0.2.1
ℹ️  DNS propagation may take a few moments...
✅ DNS record deleted: pr-test.dev-pr.tronrelic.com
```

## Certificate Renewal Strategy

### Automated Renewal (Recommended)

Certbot automatically sets up certificate renewal. Verify with:

```bash
# Check renewal timer (systemd)
sudo systemctl status certbot.timer

# Check renewal cron job
sudo cat /etc/cron.d/certbot
```

### Manual Renewal and Redeployment

When the wildcard certificate is renewed, update GitHub secrets with the new certificate:

1. **Renew certificate:**
   ```bash
   sudo certbot renew --cert-name dev-pr.tronrelic.com
   ```

2. **Encode new certificate:**
   ```bash
   # Cross-platform encoding (works on Linux and macOS)
   sudo cat /etc/letsencrypt/live/dev-pr.tronrelic.com/fullchain.pem | base64 | tr -d '\n' > cert.b64
   sudo cat /etc/letsencrypt/live/dev-pr.tronrelic.com/privkey.pem | base64 | tr -d '\n' > key.b64
   ```

3. **Update GitHub secrets:**
   - Navigate to Repository Settings → Secrets → Actions
   - Update `WILDCARD_SSL_CERT` with contents of `cert.b64`
   - Update `WILDCARD_SSL_KEY` with contents of `key.b64`

4. **Existing PR environments:**
   - Close and reopen PRs to get new certificate
   - Or manually redeploy certificate to active droplets

### Certificate Expiration Monitoring

Set up monitoring to alert before certificate expires:

```bash
# Check certificate expiration
sudo certbot certificates

# Check specific certificate expiration date
sudo openssl x509 -enddate -noout -in /etc/letsencrypt/live/dev-pr.tronrelic.com/fullchain.pem
```

**Recommendation:** Renew and update GitHub secrets when certificate has 30 days or less remaining.

## Troubleshooting

### DNS Record Creation Fails

**Symptom:** Cloudflare API returns error when creating DNS record

**Solutions:**
- Verify `CLOUDFLARE_API_TOKEN` has DNS edit permissions
- Verify `CLOUDFLARE_ZONE_ID` matches your domain
- Check API token hasn't expired (tokens can expire after 90 days if configured)
- Verify domain is active on Cloudflare (not just added)

### Certificate Generation Fails

**Symptom:** Certbot fails with DNS validation error

**Solutions:**
- Verify Cloudflare API token is correct
- Check DNS propagation: `dig _acme-challenge.dev-pr.tronrelic.com TXT`
- Increase propagation wait time in script (default 30 seconds)
- Verify domain nameservers point to Cloudflare: `dig +short NS tronrelic.com`

### Browser Shows Certificate Error

**Symptom:** Browser shows "Your connection is not private" warning

**Possible causes:**
- Certificate not deployed correctly to droplet (check `/etc/nginx/ssl/wildcard.crt`)
- Nginx configuration incorrect (check `nginx -t`)
- Certificate expired (check expiration date)
- DNS not propagated yet (wait a few minutes)

**Debug steps:**
```bash
# SSH to PR droplet
ssh root@<droplet-ip>

# Verify certificate files exist
ls -la /etc/nginx/ssl/

# Check certificate expiration
openssl x509 -enddate -noout -in /etc/nginx/ssl/wildcard.crt

# Test Nginx configuration
nginx -t

# Check Nginx error logs
tail -50 /var/log/nginx/error.log

# Restart Nginx
systemctl restart nginx
```

### DNS Propagation Takes Too Long

**Symptom:** Health checks fail because DNS not resolved yet

**Solutions:**
- Cloudflare DNS typically propagates within seconds
- GitHub Actions workflow waits 30 seconds after DNS creation
- Check DNS resolution: `dig pr-{number}.dev-pr.tronrelic.com`
- Verify A record created in Cloudflare dashboard
- Check Cloudflare DNS propagation status

## Cost Analysis

**Cloudflare DNS:**
- Free tier: Unlimited DNS records
- API access: Included in free tier
- No monthly cost

**Let's Encrypt Certificate:**
- Free: Wildcard certificates
- Renewal: Automatic and free
- No rate limit issues with wildcard approach

**Total additional cost: $0/month**

**Comparison to reserved IP approach:**
- Reserved IP cost: $4-6/month per IP
- Wildcard approach: $0/month
- Savings: $4-6/month per concurrent PR environment

## Security Considerations

**API Token Security:**
- Store Cloudflare API token only in GitHub secrets
- Never commit API tokens to version control
- Use minimum required permissions (Zone.DNS.Edit only)
- Rotate API tokens periodically (every 90 days recommended)

**Certificate Security:**
- Private keys stored as GitHub encrypted secrets
- Private key never committed to version control
- Droplets receive certificate via SCP over SSH
- Certificate files have restricted permissions (600)

**DNS Security:**
- Cloudflare provides DDoS protection (free tier)
- DNS records authenticated via API token
- Only GitHub Actions can create/delete PR DNS records

## Additional Resources

- [Cloudflare API Documentation](https://developers.cloudflare.com/api/)
- [Let's Encrypt DNS-01 Challenge](https://letsencrypt.org/docs/challenge-types/#dns-01-challenge)
- [Certbot DNS Plugins](https://eff-certbot.readthedocs.io/en/stable/using.html#dns-plugins)
- [Nginx SSL Configuration](https://nginx.org/en/docs/http/configuring_https_servers.html)
