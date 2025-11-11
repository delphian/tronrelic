# Testing the Cloudflare DNS PR Environment Migration

This document provides step-by-step instructions for testing the new Cloudflare DNS-based PR environment workflow.

## Overview

The migration replaces the old two-tier PR system (Main-PR with reserved IP vs Dev-PR without SSL) with a unified approach where every PR gets:
- Unique subdomain: `pr-{number}.dev-pr.tronrelic.com`
- Wildcard SSL certificate (trusted, no browser warnings)
- Nginx reverse proxy
- Production-like infrastructure

## Prerequisites

Before testing, ensure the following setup is complete:

### 1. Cloudflare Configuration

✅ DNS transferred to Cloudflare (or subdomain delegated)
✅ Cloudflare API token created with DNS edit permissions
✅ Zone ID obtained from Cloudflare dashboard

### 2. Wildcard SSL Certificate

✅ Wildcard certificate generated for `*.dev-pr.tronrelic.com`
✅ Certificate and private key base64-encoded
✅ Certificate stored in GitHub secrets

### 3. GitHub Secrets

Navigate to **Repository Settings → Secrets and variables → Actions** and verify:

| Secret Name | Value | Status |
|------------|-------|--------|
| `CLOUDFLARE_API_TOKEN` | API token with DNS edit perms | ☐ |
| `CLOUDFLARE_ZONE_ID` | Zone ID for tronrelic.com | ☐ |
| `WILDCARD_SSL_CERT` | Base64-encoded certificate | ☐ |
| `WILDCARD_SSL_KEY` | Base64-encoded private key | ☐ |
| `DO_API_TOKEN` | Digital Ocean API token | ☐ |
| `DO_SSH_KEY_FINGERPRINT` | SSH key fingerprint | ☐ |
| `DO_SSH_PRIVATE_KEY` | SSH private key (full) | ☐ |
| `ADMIN_API_TOKEN` | Admin API token | ☐ |
| `TRONGRID_API_KEY` | TronGrid key #1 | ☐ |
| `TRONGRID_API_KEY_2` | TronGrid key #2 | ☐ |
| `TRONGRID_API_KEY_3` | TronGrid key #3 | ☐ |

## Test Plan

### Phase 1: Workflow Validation

**Test that GitHub Actions workflows are correctly configured**

1. ✅ **Verify workflow files renamed**
   ```bash
   ls -la .github/workflows/pr-*.yml
   # Should show: pr-environment.yml, pr-teardown.yml
   ```

2. ✅ **Verify Dev-PR workflows removed**
   ```bash
   ls -la .github/workflows/dev-pr-*.yml 2>/dev/null || echo "Correctly removed"
   ```

3. ✅ **Validate YAML syntax**
   ```bash
   python3 -c "import yaml; yaml.safe_load(open('.github/workflows/pr-environment.yml'))"
   python3 -c "import yaml; yaml.safe_load(open('.github/workflows/pr-teardown.yml'))"
   ```

### Phase 2: Script Testing

**Test DNS management scripts locally**

1. **Install dependencies**
   ```bash
   sudo apt-get install -y jq curl
   ```

2. **Set environment variables**
   ```bash
   export CLOUDFLARE_API_TOKEN="your-token-here"
   export CLOUDFLARE_ZONE_ID="your-zone-id-here"
   ```

3. **Test DNS record creation**
   ```bash
   ./scripts/cloudflare-dns-add.sh pr-test 192.0.2.1
   ```
   
   Expected output:
   ```
   ✅ DNS record created successfully: pr-test.dev-pr.tronrelic.com -> 192.0.2.1
   ℹ️  DNS propagation may take a few moments...
   ```

4. **Verify DNS record exists**
   ```bash
   dig pr-test.dev-pr.tronrelic.com
   # or
   nslookup pr-test.dev-pr.tronrelic.com
   ```

5. **Test DNS record deletion**
   ```bash
   ./scripts/cloudflare-dns-delete.sh pr-test
   ```
   
   Expected output:
   ```
   ✅ DNS record deleted: pr-test.dev-pr.tronrelic.com
   ✅ DNS cleanup completed for pr-test.dev-pr.tronrelic.com
   ```

6. **Verify DNS record removed**
   ```bash
   dig pr-test.dev-pr.tronrelic.com
   # Should return NXDOMAIN or no A record
   ```

### Phase 3: PR Environment Creation

**Test full PR environment provisioning**

1. **Create a test PR**
   ```bash
   git checkout -b test/cloudflare-pr-environment
   echo "# Test PR for Cloudflare DNS" >> README.md
   git add README.md
   git commit -m "Test: Verify PR environment creation"
   git push origin test/cloudflare-pr-environment
   ```

2. **Open PR on GitHub**
   - Navigate to repository on GitHub
   - Click "Compare & pull request"
   - Set base branch: `main`
   - Create pull request

3. **Monitor GitHub Actions**
   - Go to **Actions** tab
   - Watch "PR Environment" workflow run
   - Expected duration: 8-12 minutes

4. **Verify workflow steps**
   - ✅ Tests pass
   - ✅ Docker images built and pushed
   - ✅ Droplet created
   - ✅ DNS A record created via Cloudflare
   - ✅ Wildcard SSL certificate deployed
   - ✅ Nginx configured
   - ✅ Containers started
   - ✅ Health checks pass
   - ✅ PR comment posted

### Phase 4: PR Environment Access

**Verify PR environment is accessible and working**

1. **Get PR environment details**
   - Find PR comment from GitHub Actions
   - Note PR domain (e.g., `pr-42.dev-pr.tronrelic.com`)
   - Note droplet IP address

2. **Test DNS resolution**
   ```bash
   dig pr-{number}.dev-pr.tronrelic.com
   nslookup pr-{number}.dev-pr.tronrelic.com
   ```
   
   Expected: Should resolve to droplet IP

3. **Test HTTPS access (frontend)**
   ```bash
   curl -I https://pr-{number}.dev-pr.tronrelic.com/
   ```
   
   Expected:
   - HTTP/2 200 OK
   - No certificate errors
   - Valid SSL connection

4. **Test backend API**
   ```bash
   curl https://pr-{number}.dev-pr.tronrelic.com/api/health
   ```
   
   Expected:
   ```json
   {"status":"healthy","timestamp":"..."}
   ```

5. **Test in browser**
   - Open `https://pr-{number}.dev-pr.tronrelic.com/`
   - **Verify no SSL warnings** (should show padlock icon)
   - Check certificate details (should be wildcard cert)
   - Navigate around the application
   - Check browser console for errors

6. **SSH to droplet**
   ```bash
   ssh root@<droplet-ip>
   ```

7. **Verify droplet configuration**
   ```bash
   # Check Nginx
   systemctl status nginx
   nginx -t
   
   # Check SSL certificate
   ls -la /etc/nginx/ssl/
   openssl x509 -text -noout -in /etc/nginx/ssl/wildcard.crt | grep -A2 Subject
   
   # Check containers
   cd /opt/tronrelic
   docker compose ps
   
   # Check logs
   docker compose logs --tail=50 backend
   docker compose logs --tail=50 frontend
   
   # Check Nginx logs
   tail -50 /var/log/nginx/access.log
   tail -50 /var/log/nginx/error.log
   ```

### Phase 5: PR Environment Teardown

**Test automatic cleanup when PR closes**

1. **Close or merge the PR**
   - Go to PR on GitHub
   - Click "Close pull request" or "Merge pull request"

2. **Monitor teardown workflow**
   - Go to **Actions** tab
   - Watch "Teardown PR Environment" workflow
   - Expected duration: 1-2 minutes

3. **Verify teardown steps**
   - ✅ DNS A record deleted from Cloudflare
   - ✅ Droplet destroyed
   - ✅ PR comment posted confirming cleanup

4. **Verify DNS record removed**
   ```bash
   dig pr-{number}.dev-pr.tronrelic.com
   # Should return NXDOMAIN
   ```

5. **Verify droplet destroyed**
   ```bash
   doctl compute droplet list | grep "tronrelic-pr-{number}"
   # Should return nothing
   ```

6. **Verify Cloudflare DNS clean**
   - Log in to Cloudflare dashboard
   - Check DNS records for tronrelic.com
   - Verify `pr-{number}.dev-pr.tronrelic.com` does not exist

### Phase 6: Edge Cases and Error Handling

**Test error scenarios and recovery**

1. **Test DNS record already exists**
   - Create DNS record manually in Cloudflare
   - Create new PR
   - Verify workflow updates existing record instead of failing

2. **Test droplet already exists**
   - Create droplet manually with PR name
   - Create new PR with same number
   - Verify workflow detects existing droplet and skips creation

3. **Test DNS cleanup failure**
   - Create PR and let it provision
   - Manually delete DNS record in Cloudflare
   - Close PR
   - Verify teardown workflow doesn't fail (continues to destroy droplet)

4. **Test invalid certificate**
   - Temporarily set invalid certificate in GitHub secrets
   - Create PR
   - Expected: Workflow should fail gracefully with clear error message

## Success Criteria

### Provisioning
- ✅ PR workflow completes successfully in 8-12 minutes
- ✅ Unique subdomain created: `pr-{number}.dev-pr.tronrelic.com`
- ✅ DNS resolves to droplet IP within 60 seconds
- ✅ HTTPS works without browser warnings
- ✅ Frontend accessible at `https://pr-{number}.dev-pr.tronrelic.com/`
- ✅ Backend API accessible at `https://pr-{number}.dev-pr.tronrelic.com/api/`
- ✅ Application functions correctly (no errors in browser console)
- ✅ Nginx reverse proxy configured correctly
- ✅ SSL certificate valid and matches wildcard

### Teardown
- ✅ Teardown workflow completes in 1-2 minutes
- ✅ DNS record removed from Cloudflare
- ✅ Droplet destroyed in Digital Ocean
- ✅ No resources left behind
- ✅ PR comment confirms cleanup

### Cost
- ✅ No additional monthly costs (only droplet runtime)
- ✅ No reserved IP charges
- ✅ Cloudflare DNS usage stays within free tier

### Developer Experience
- ✅ Clear PR comments with environment details
- ✅ Memorable URLs for each PR
- ✅ Production-like testing environment
- ✅ No SSL configuration delays or errors
- ✅ Simple GitHub Flow (all PRs → main)

## Rollback Plan

If the new workflow has issues, rollback is straightforward:

1. **Revert PR changes**
   ```bash
   git revert <commit-hash>
   git push origin main
   ```

2. **Restore old workflows**
   - Re-add `main-pr-environment.yml` and `main-pr-teardown.yml`
   - Re-add `dev-pr-environment.yml` and `dev-pr-teardown.yml`
   - Restore reserved IP logic

3. **Clean up test resources**
   - Delete any test droplets
   - Remove test DNS records from Cloudflare
   - Remove Cloudflare secrets from GitHub (if not using)

## Troubleshooting

### DNS Records Not Creating
- Check `CLOUDFLARE_API_TOKEN` has correct permissions
- Verify `CLOUDFLARE_ZONE_ID` matches domain
- Check workflow logs for Cloudflare API errors

### Certificate Warnings
- Verify `WILDCARD_SSL_CERT` contains full certificate chain
- Check certificate not expired
- Ensure private key matches certificate

### Droplet Creation Fails
- Check Digital Ocean quota not exceeded
- Verify SSH keys configured correctly
- Review droplet creation logs in workflow

### Health Checks Fail
- SSH to droplet and check container logs
- Verify Nginx configuration: `nginx -t`
- Check firewall allows HTTPS (port 443)
- Test direct container access: `curl http://localhost:4000/api/health`

## Next Steps After Successful Testing

1. **Update main branch**
   - Merge this PR to main
   - Monitor first production PR environment

2. **Remove dev branch** (optional)
   - Once confident in new workflow
   - Delete `dev` branch from repository
   - Update branch protection rules

3. **Monitor costs**
   - Track Digital Ocean spending
   - Verify no unexpected charges
   - Confirm Cloudflare stays in free tier

4. **Team communication**
   - Notify team of new workflow
   - Share documentation links
   - Address any questions or concerns

## Documentation Links

- [Cloudflare Setup Guide](./docs/operations/operations-cloudflare-setup.md)
- [Operations Workflows](./docs/operations/operations-workflows.md)
- [GitHub Actions Workflows](./.github/workflows/)
