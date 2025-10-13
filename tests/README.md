# E2E Tests

End-to-end tests for TronRelic using Playwright.

## Running Tests

### Prerequisites

Make sure services are running:
```bash
./scripts/start.sh --force-build
```

### Run all tests
```bash
npx playwright test
```

### Run specific test file
```bash
npx playwright test tests/system-monitoring.spec.ts
```

### Run tests in headed mode (see browser)
```bash
npx playwright test --headed
```

### Run tests with UI mode (interactive)
```bash
npx playwright test --ui
```

### View test report
```bash
npx playwright show-report
```

## Test Structure

- `health-check.spec.ts` - Basic application health and navigation
- `system-monitoring.spec.ts` - System monitoring dashboard tests

## Writing Tests

Tests use Playwright's test runner with TypeScript. See the [Playwright documentation](https://playwright.dev/docs/intro) for more details.

## CI/CD

The Playwright configuration is set to automatically retry failed tests on CI and run tests serially to avoid resource conflicts.
