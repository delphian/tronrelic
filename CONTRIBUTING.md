# Contributing to TronRelic

Thank you for your interest in contributing to TronRelic! We welcome contributions from the community.

## Contributor License Agreement (CLA)

**Before we can accept your contribution, you must sign our Contributor License Agreement (CLA).**

### Why We Require a CLA

The CLA ensures that:
- You have the legal right to contribute your code
- The project can distribute your contributions under its chosen license
- The project maintainers can change the license in the future if needed
- Your contributions can be used in both open source and commercial contexts

### How to Sign the CLA

1. **Submit your pull request** as usual
2. **CLA Assistant bot will comment** on your PR with a link to the CLA
3. **Click the link and review** the CLA document
4. **Click "I Agree"** to sign electronically via GitHub OAuth
5. **CLA Assistant will update your PR** with a "cla-signed" label

**You only need to sign once.** All future contributions will be automatically approved.

### CLA Document

You can review the full CLA text here: [.github/CLA.md](.github/CLA.md)

**Key points:**
- You retain ownership of your contributions
- You grant the project rights to use, modify, and relicense your contributions
- You warrant that you have the legal right to make the contribution

#### Why we ask for relicensing rights

Section 4 of the CLA lets the maintainers dual-license or negotiate commercial deals without chasing every past contributor for approval. That flexibility keeps TronRelic's hosted service, enterprise builds, and plugin ecosystem aligned while still ensuring the open-source AGPL distribution stays available to the community.

---

## Development Workflow

### Setting Up Your Development Environment

1. **Fork the repository** on GitHub
2. **Clone your fork:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/tronrelic.git
   cd tronrelic
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Copy environment configuration:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

5. **Start development environment:**
   ```bash
   ./scripts/start.sh
   ```

See [README.md](README.md) for complete setup instructions.

### Making Changes

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make your changes** following our code standards (see below)

3. **Write tests** for new functionality

4. **Run tests locally:**
   ```bash
   npm test
   npm run typecheck
   ```

5. **Commit your changes:**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

6. **Push to your fork:**
   ```bash
   git push origin feature/my-feature
   ```

7. **Open a pull request** on GitHub

### Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, no logic changes)
- `refactor:` - Code refactoring (no feature changes or bug fixes)
- `test:` - Adding or updating tests
- `chore:` - Build process or tooling changes

**Examples:**
```bash
feat(markets): add energy price chart component
fix(observers): handle null transaction data gracefully
docs(plugins): update plugin development guide
```

---

## Code Standards

### TypeScript Guidelines

- **Use TypeScript** - All code must be TypeScript (not JavaScript)
- **Interfaces prefixed with `I`** - `IPluginContext`, `IObserverRegistry`
- **File names match exports** - `IPluginContext.ts` exports `IPluginContext`
- **4 spaces for indentation** - Not 2 spaces or tabs
- **Dependency injection** - Use constructor injection over direct imports

### Documentation Requirements

**All code must be documented with JSDoc comments before shipping:**

```typescript
/**
 * Processes blockchain transactions and notifies subscribed observers.
 *
 * This service coordinates the transaction enrichment pipeline: parsing contract
 * data, fetching market prices, calculating energy costs, and distributing events
 * to all registered observers asynchronously.
 *
 * @param transaction - Raw transaction from TronGrid API
 * @param blockNumber - Block number containing this transaction
 * @returns Enriched transaction with USD values and energy costs
 *
 * @throws {ValidationError} If transaction format is invalid
 * @throws {EnrichmentError} If market data is unavailable
 */
async function processTransaction(
    transaction: ITronTransaction,
    blockNumber: number
): Promise<IEnrichedTransaction> {
    // Implementation
}
```

**Documentation standards:**
- Lead with the **why** (purpose/risk), then the **how**
- Document every function, method, class, and exported constant
- Use `@param` for all parameters (explain why caller provides it)
- Use `@returns` to describe what the function produces
- Use `@throws` for expected error conditions

See [docs/documentation.md](docs/documentation.md) for complete standards.

### Testing Requirements

- **Unit tests required** for all new functionality
- **Integration tests** for API endpoints and database operations
- **Test coverage** should not decrease with your changes

**Run tests:**
```bash
# Unit tests
npm test

# Integration tests (requires Docker)
npm run test:integration

# Watch mode
npm test -- --watch
```

---

## Pull Request Process

1. **Ensure all tests pass** locally before submitting
2. **Sign the CLA** when prompted by CLA Assistant bot
3. **Update documentation** if you've changed functionality
4. **Keep PRs focused** - One feature or bug fix per PR
5. **Respond to review feedback** promptly
6. **Squash commits** if requested (we prefer clean history)

### PR Checklist

Before submitting, verify:

- [ ] Code follows TypeScript and style guidelines
- [ ] All functions/classes have JSDoc comments
- [ ] Tests added for new functionality
- [ ] All tests pass (`npm test`)
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Documentation updated if needed
- [ ] Commit messages follow Conventional Commits format
- [ ] CLA signed (CLA Assistant will handle this)

### Review Process

- Maintainers will review your PR within 7 days
- We may request changes or clarifications
- Once approved, your PR will be merged
- Your contribution will be included in the next release

---

## Project Architecture

Before making significant changes, review these documents:

**Core documentation:**
- [README.md](README.md) - Project overview and quick start
- [AGENTS.md](AGENTS.md) - Project rules and conventions
- [docs/documentation.md](docs/documentation.md) - Documentation standards

**System architecture:**
- [docs/plugins/plugins.md](docs/plugins/plugins.md) - Plugin system overview
- [docs/frontend/frontend.md](docs/frontend/frontend.md) - Frontend architecture
- [docs/system/system.md](docs/system/system.md) - Backend system architecture

**Development guides:**
- [docs/plugins/plugins-blockchain-observers.md](docs/plugins/plugins-blockchain-observers.md) - Creating blockchain observers
- [docs/frontend/ui-component-styling.md](docs/frontend/ui-component-styling.md) - UI styling standards
- [docs/system/system-testing.md](docs/system/system-testing.md) - Testing patterns

---

## Getting Help

- **Questions?** Open a [GitHub Discussion](../../discussions)
- **Bug reports?** Open a [GitHub Issue](../../issues)
- **Feature requests?** Open a [GitHub Issue](../../issues) with the "enhancement" label

---

## Code of Conduct

We expect all contributors to:

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other community members

We will not tolerate harassment, discrimination, or unprofessional behavior.

---

## License

By contributing to TronRelic, you agree that your contributions will be licensed under the same license as the project (see [LICENSE](LICENSE) file).

Additionally, by signing the CLA, you grant the project maintainers the right to relicense your contributions as described in the CLA.

---

Thank you for contributing to TronRelic! 🎉
