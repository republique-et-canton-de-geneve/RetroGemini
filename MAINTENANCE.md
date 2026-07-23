# Maintenance Guide - RetroGeminiCodex

This guide explains how to use the project's quality and maintenance tools.

## 📦 Installation

After cloning the repository, install all dependencies:

```bash
npm install
```

## 🧪 Tests

### Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode (automatic re-run)
npm run test:watch

# Run tests with code coverage
npm run test:coverage

# Run tests with graphical interface
npm run test:ui
```

### Test Structure

Tests are organized in the `__tests__/` directory:

- `__tests__/example.test.ts` - Basic test examples
- `__tests__/security.test.ts` - Security tests
- `__tests__/App.test.tsx` - React component tests

### Writing New Tests

```typescript
import { describe, it, expect } from 'vitest';

describe('My feature', () => {
  it('should do something', () => {
    expect(1 + 1).toBe(2);
  });
});
```

For React components:

```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import MyComponent from './MyComponent';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

## 🔍 Static Analysis (Linting)

### Running ESLint

```bash
# Analyze code
npm run lint

# Analyze and automatically fix errors
npm run lint:fix
```

### ESLint Configuration

The configuration is located in `eslint.config.js`. It includes:

- TypeScript support
- React and React Hooks support
- Security rules
- Code quality rules

## 📝 TypeScript Type Checking

```bash
# Check types without generating files
npm run type-check
```

This command verifies that all your TypeScript code is properly typed.

## 🔒 Security Audits

### npm Dependency Audit

```bash
# Check vulnerabilities (moderate level and above)
npm run security:audit

# Automatically fix vulnerabilities (when possible)
npm run security:fix
```

### Manual Audit

```bash
# Full audit with details
npm audit

# Audit with specific severity level
npm audit --audit-level=high
```

## 🚀 CI/CD - GitHub Actions

### Configured Workflows

The project uses several GitHub Actions workflows:

#### 1. Main CI (`.github/workflows/ci.yml`)

**Triggered on**: Push and Pull Requests

**Steps**:
- ✅ Code linting
- ✅ TypeScript verification
- ✅ Tests with coverage
- ✅ Production build
- ✅ Security audit

**Matrix**: Tests on Node.js 22.x and 26.x

#### 2. CodeQL (`.github/workflows/codeql.yml`)

**Triggered on**:
- Push to main/master/develop
- Pull Requests
- Every Monday at 6:00 AM UTC (automatic)

**Purpose**: Advanced code security analysis

#### 3. Dependency Review (`.github/workflows/dependency-review.yml`)

**Triggered on**: Pull Requests

**Purpose**: Checks new dependencies for vulnerabilities

### Viewing CI Results

1. Go to the "Actions" tab of your GitHub repository
2. Click on a workflow to see details
3. Failures are marked in red, successes in green

## 🤖 Dependabot

Dependabot is configured in `.github/dependabot.yml` for:

- **npm**: Daily update checks
- **GitHub Actions**: Weekly checks
- **Docker**: Weekly checks

### Managing Dependabot PRs

When Dependabot creates a PR:

1. Verify that CI tests pass
2. Read the changelog if available
3. Merge the PR if everything is OK
4. Or comment `@dependabot rebase` to rebase the PR

Useful Dependabot commands:
- `@dependabot rebase` - Rebase the PR
- `@dependabot recreate` - Recreate the PR
- `@dependabot merge` - Automatically merge
- `@dependabot close` - Close the PR
- `@dependabot ignore this dependency` - Ignore this dependency

## 📊 Code Coverage

### Coverage Goals

The project aims for the following goals:

- **Lines**: 70% minimum
- **Functions**: 70% minimum
- **Branches**: 70% minimum
- **Statements**: 70% minimum

### Viewing Coverage Report

After running `npm run test:coverage`:

```bash
# The report is available in coverage/index.html
# Open it in your browser
open coverage/index.html  # macOS
xdg-open coverage/index.html  # Linux
start coverage/index.html  # Windows
```

## 🔄 Recommended Development Workflow

### Before Committing

```bash
# 1. Format and fix code
npm run lint:fix

# 2. Check types
npm run type-check

# 3. Run tests
npm test

# 4. (Optional) Check coverage
npm run test:coverage
```

### Before Pushing

```bash
# Run full CI locally
npm run ci

# Or individually:
npm run lint
npm run type-check
npm run test
npm run build
```

### Creating a Pull Request

1. Create a branch from `develop` or `main`
2. Make your changes
3. Commit with clear messages
4. Push your branch
5. Create a PR on GitHub
6. Wait for all CI checks to pass ✅
7. Request a review if necessary
8. Merge when approved

## 🛠️ Available npm Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite development server |
| `npm run build` | Production build |
| `npm start` | Start Node.js server |
| `npm test` | Run tests |
| `npm run test:watch` | Tests in watch mode |
| `npm run test:coverage` | Tests with coverage |
| `npm run test:ui` | Graphical interface for tests |
| `npm run lint` | Analyze code with ESLint |
| `npm run lint:fix` | Automatically fix ESLint errors |
| `npm run type-check` | Check TypeScript types |
| `npm run security:audit` | Security audit of dependencies |
| `npm run security:fix` | Fix vulnerabilities |
| `npm run ci` | Run all CI checks locally |

## 📁 Configuration File Structure

```
.
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # Main CI
│   │   ├── codeql.yml                # Security analysis
│   │   └── dependency-review.yml     # Dependency review
│   └── dependabot.yml                # Dependabot configuration
├── __tests__/                        # Tests
│   ├── example.test.ts               # Test examples
│   ├── security.test.ts              # Security tests
│   └── App.test.tsx                  # React tests
├── eslint.config.js                  # ESLint configuration
├── vitest.config.ts                  # Vitest configuration
├── vitest.setup.ts                   # Test setup
├── tsconfig.json                     # TypeScript configuration
└── package.json                      # Scripts and dependencies
```

## 🐛 Troubleshooting

### Tests Failing

```bash
# Clean and reinstall
rm -rf node_modules package-lock.json
npm install
npm test
```

### Too Many ESLint Errors

```bash
# Fix what can be fixed automatically
npm run lint:fix

# Then manually fix the rest
npm run lint
```

### TypeScript Types Incorrect

```bash
# Check type errors
npm run type-check

# Sometimes restarting the editor helps
# Or delete TypeScript cache
rm -rf .tsbuildinfo
```

### npm audit Finds Vulnerabilities

```bash
# Try to fix them automatically
npm audit fix

# If that doesn't work, force updates (caution!)
npm audit fix --force

# Check remaining vulnerabilities
npm audit
```

## 📚 Resources

- [Vitest Documentation](https://vitest.dev/)
- [ESLint Documentation](https://eslint.org/)
- [Testing Library](https://testing-library.com/)
- [GitHub Actions](https://docs.github.com/en/actions)
- [Dependabot](https://docs.github.com/en/code-security/dependabot)
- [CodeQL](https://codeql.github.com/)

## 💡 Best Practices

### Tests

1. **Write tests for each new feature**
2. **Aim for 80%+ coverage for critical code**
3. **Test edge cases and errors**
4. **Use descriptive test names**
5. **Keep tests simple and readable**

### Code Quality

1. **Fix ESLint errors before committing**
2. **Use TypeScript strict mode as much as possible**
3. **Avoid `any` in TypeScript**
4. **Comment complex code**
5. **Keep functions small and focused**

### Security

1. **Never commit secrets or credentials**
2. **Keep dependencies up to date**
3. **Read Dependabot security reports**
4. **Use environment variables for secrets**
5. **Validate all user inputs**

### CI/CD

1. **All tests must pass before merging**
2. **Check CodeQL reports regularly**
3. **Merge Dependabot PRs quickly**
4. **Keep branches up to date with main/develop**
5. **Use clear commit messages**

---

**Last updated**: 2025-12-22

For any questions, open an issue on GitHub.
