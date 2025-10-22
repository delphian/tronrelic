# Git Hooks

Git hooks provide local protection by running checks before commits, pushes, etc.

## Installation

Git hooks must be manually installed in each developer's local repository:

```bash
# Configure git to use the .githooks directory
git config core.hooksPath .githooks
```

**Important:** This only affects your local repository. Each developer must run this command.

## Available Hooks

### pre-push

Runs unit tests before allowing pushes to `main` or `dev` branches.

**What it does:**
- Detects pushes to protected branches (`main` or `dev`)
- Runs `npm test` (vitest unit tests)
- Blocks the push if tests fail
- Allows the push if tests pass

**Bypass (not recommended):**
```bash
git push --no-verify
```

## Why Use Local Hooks?

Git hooks provide **defense in depth**:

1. **Local hooks** - Catch issues before pushing (this)
2. **GitHub Actions** - Run full test suite on PR
3. **Branch protection** - Prevent merging without passing tests

Even with GitHub branch protection, local hooks provide faster feedback and save CI minutes.

## Adding More Hooks

Create new executable scripts in `.githooks/`:

**Example - pre-commit hook for linting:**
```bash
#!/bin/bash
# .githooks/pre-commit

echo "Running linter..."
npm run lint --workspace apps/backend
```

Then make it executable:
```bash
chmod +x .githooks/pre-commit
```
