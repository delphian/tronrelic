# Branch Protection Setup

This document explains how to configure GitHub branch protection rules to require all tests to pass before merging to `main` branch.

## Automated Test Workflow

The repository uses a reusable test workflow (`.github/workflows/test.yml`) that runs:

1. **Unit Tests** - Backend vitest tests (runs automatically on all PRs)

Integration tests (Playwright) can be run manually but are not required for merging.

The `main` branch workflow calls this test workflow and waits for it to complete before building/deploying.

## Protection Layers

TronRelic uses **three layers of protection** to ensure code quality:

1. **Local Git Hooks** (optional, developer setup) - Run tests before pushing
2. **GitHub Actions** (automatic) - Run full test suite on every PR
3. **Branch Protection Rules** (required, admin setup) - Prevent merging without passing tests

### Layer 1: Local Git Hooks (Developer Setup)

Each developer should configure git hooks to run tests locally before pushing:

```bash
# In the repository root
git config core.hooksPath .githooks
```

This enables the pre-push hook that:
- Runs unit tests before pushing to `main`
- Provides fast feedback (catches issues before GitHub Actions)
- Can be bypassed with `git push --no-verify` (not recommended)

See [../.githooks/README.md](../.githooks/README.md) for details.

### Layer 2 & 3: GitHub Configuration

## Setting Up Branch Protection Rules

### For `main` branch (Production)

1. Go to **Settings** → **Branches** in your GitHub repository
2. Click **Add branch protection rule**
3. Configure the following settings:

   **Branch name pattern:** `main`

   **Protect matching branches:**
   - ☑ Require a pull request before merging
     - ☑ Require approvals: 1 (recommended)
     - ☑ Dismiss stale pull request approvals when new commits are pushed
   - ☑ Require status checks to pass before merging
     - ☑ Require branches to be up to date before merging
     - **Required status checks:**
       - `test / unit-tests`
   - ☑ Require conversation resolution before merging
   - ☑ **Do not allow bypassing the above settings** ← **CRITICAL: Blocks local merges**
   - ☑ **Include administrators** ← **Recommended: Even admins must use PRs**

4. Click **Create** or **Save changes**

## How It Works

### Pull Requests to `main`

When you create a pull request:

1. The test workflow automatically runs
2. Unit tests must pass
3. The PR cannot be merged until all required status checks pass
4. If tests fail, the "Merge" button will be disabled

### Direct Pushes (Not Recommended)

If branch protection is enabled and someone tries to push directly:

1. The push will be rejected if protection is enforced
2. They'll need to create a pull request instead

### Workflow Execution Order

**For `main` branch:**
```
PR Created → Test Workflow Runs → Build & Push (only if tests pass)
```

## Testing the Setup

### 1. Create a test branch

```bash
git checkout -b test/branch-protection
```

### 2. Make a change that breaks tests

Edit a test file to intentionally fail:

```bash
# Break a backend test
echo "test('failing test', () => { expect(true).toBe(false); });" >> apps/backend/src/modules/menu/__tests__/menu.service.test.ts
```

### 3. Commit and push

```bash
git add .
git commit -m "Test: intentionally break tests"
git push origin test/branch-protection
```

### 4. Create pull request

Go to GitHub and create a PR targeting `main`. You should see:

- ❌ Status check "test / unit-tests" failing
- 🚫 Merge button disabled with message "Merging is blocked"

### 5. Fix the tests

Revert the breaking change:

```bash
git checkout apps/backend/src/modules/menu/__tests__/menu.service.test.ts
git commit -m "Fix: revert broken test"
git push
```

You should now see:

- ✅ Status check "test / unit-tests" passing
- ✅ Merge button enabled

## Required Secrets

Ensure these GitHub repository secrets are configured for tests to run:

- `ADMIN_API_TOKEN` - Admin token for system endpoints
- `TRONGRID_API_KEY` - TronGrid API key
- `TRONGRID_API_KEY_2` - Second TronGrid API key
- `TRONGRID_API_KEY_3` - Third TronGrid API key

**To add secrets:**

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Add each secret with its value

## Local Testing

Before pushing, you can run tests locally to catch issues early:

```bash
# Run unit tests (vitest)
npm test

# Run integration tests (Playwright - requires Docker)
docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d
npm ci
npx playwright install --with-deps
npm run test:integration
docker compose -f docker-compose.yml -f docker-compose.ci.yml down -v
```

## Troubleshooting

### Status checks not appearing in PR

**Cause:** The workflow hasn't run yet or the branch is behind.

**Solution:**
1. Make sure you pushed your branch after the workflow files were merged
2. Update your branch with the latest from `main`
3. Check the "Actions" tab to verify workflows are running

### Tests pass locally but fail in CI

**Common causes:**
- Environment differences (MongoDB/Redis versions)
- Missing secrets in GitHub repository settings
- Race conditions in async tests
- Hardcoded localhost references

**Debugging:**
1. Check the workflow run logs in the "Actions" tab
2. Look for the "Show docker compose logs on failure" step output
3. Download test artifacts (screenshots, reports) from the workflow run

### Cannot find required status checks when setting up branch protection

**Cause:** Status checks only appear after they've run at least once on the branch.

**Solution:**
1. Merge the workflow changes to `main` first
2. Wait for the workflows to run on that branch
3. The status check name (`test / unit-tests`) will then appear in the dropdown when configuring branch protection

## Best Practices

1. **Never bypass branch protection** - Even admins should follow the rules
2. **Run tests locally** before pushing to catch issues early
3. **Keep test coverage high** - Add tests for new features
4. **Fix failing tests immediately** - Don't let them linger
5. **Review test failures carefully** - They might catch real bugs
6. **Update this documentation** when adding new test workflows

## Adding New Test Suites

When adding new test types (e.g., frontend tests, E2E tests), update the test workflow:

1. Edit `.github/workflows/test.yml`
2. Add a new job for your test suite
3. Update `BRANCH_PROTECTION.md` to document the new required status check
4. Update branch protection rules to include the new status check

Example:

```yaml
jobs:
  frontend-tests:
    name: Frontend Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test --workspace apps/frontend
```

Then add `test / frontend-tests` to the required status checks in branch protection settings.
