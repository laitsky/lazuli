# Contributing to Lazuli

Thank you for your interest in contributing to Lazuli! This document provides guidelines and instructions for contributing to our monorepo.

## Table of Contents

- [Development Setup](#development-setup)
- [Monorepo Structure](#monorepo-structure)
- [Development Workflow](#development-workflow)
- [Code Quality](#code-quality)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)

## Development Setup

### Prerequisites

- **Node.js**: >= 18.0.0
- **npm**: >= 9.0.0

### Getting Started

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd lazuli
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Run development servers**

   ```bash
   # Run both API and Web
   npm run dev

   # Or run individually
   npm run dev:api   # API only on port 3000
   npm run dev:web   # Web only on port 3001
   ```

## Monorepo Structure

This project uses **Turborepo** for monorepo management. See [MONOREPO.md](./MONOREPO.md) for detailed information.

```
lazuli/
├── apps/
│   ├── api/          # Express REST API
│   └── web/          # Next.js frontend
├── packages/
│   ├── shared/       # Shared TypeScript types
│   └── config/       # Shared configurations
│       ├── eslint/   # ESLint configurations
│       └── typescript/ # TypeScript configurations
└── turbo.json        # Turborepo pipeline config
```

## Development Workflow

### Creating a New Feature

1. **Create a feature branch**

   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes**
   - Write code following our [Code Quality](#code-quality) guidelines
   - Add tests if applicable
   - Update documentation

3. **Run quality checks**

   ```bash
   npm run lint        # Lint all packages
   npm run type-check  # TypeScript type checking
   npm run format:check # Check code formatting
   ```

4. **Commit your changes**

   ```bash
   git add .
   git commit -m "feat: add new feature"
   # Husky will automatically run pre-commit checks
   ```

5. **Push and create PR**
   ```bash
   git push origin feat/your-feature-name
   # Create a Pull Request on GitHub
   ```

### Available Scripts

#### Root Level

```bash
npm run dev              # Run all apps in development mode
npm run dev:api          # Run API only
npm run dev:web          # Run web only
npm run build            # Build all packages
npm run lint             # Lint all packages
npm run lint:fix         # Auto-fix linting issues
npm run type-check       # Check TypeScript types
npm run format           # Format all code with Prettier
npm run format:check     # Check code formatting
npm run clean            # Clean all build artifacts
```

#### Package Level

```bash
# In apps/api or apps/web
npm run dev             # Run development server
npm run build           # Build for production
npm run lint            # Run ESLint
npm run type-check      # Run TypeScript compiler
npm run clean           # Clean build artifacts
```

## Code Quality

### TypeScript

- **Strict mode enabled**: All code must pass strict TypeScript checks
- **No `any` types**: Use proper typing or `unknown` with type guards
- **Explicit return types**: For exported functions

### ESLint

- ESLint is configured with TypeScript support
- Runs automatically on pre-commit via Husky
- Fix issues with: `npm run lint:fix`

### Prettier

- Code is automatically formatted on commit
- Run manually: `npm run format`
- Configuration: `.prettierrc.json`

### Pre-commit Hooks

We use **Husky** and **lint-staged** to enforce code quality:

- **On commit**: Runs ESLint and Prettier on staged files
- **On commit-msg**: Validates commit message format

## Commit Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `build`: Build system changes
- `ci`: CI/CD changes
- `chore`: Other changes (dependencies, etc.)

### Examples

```bash
# Good commits
git commit -m "feat: add pagination to tickers endpoint"
git commit -m "fix: resolve memory leak in cache service"
git commit -m "docs: update API documentation"

# Bad commits (will be rejected)
git commit -m "Fixed stuff"  # ❌ Missing type
git commit -m "FEAT: Add feature"  # ❌ Type in uppercase
git commit -m "add new feature"  # ❌ Missing type prefix
```

### Scopes (Optional)

- `api`: Changes to the API
- `web`: Changes to the web frontend
- `shared`: Changes to shared packages
- `config`: Changes to configuration

Example: `feat(api): add caching layer`

## Pull Request Process

1. **Update documentation**: Ensure README and relevant docs are updated

2. **Run all checks**:

   ```bash
   npm run build       # Ensure everything builds
   npm run lint        # No linting errors
   npm run type-check  # No type errors
   ```

3. **Write a clear PR description**:
   - What changes were made?
   - Why were they made?
   - How to test?

4. **Link related issues**: Use "Fixes #123" or "Closes #456"

5. **Request review**: Tag relevant maintainers

6. **Address feedback**: Make requested changes and push updates

7. **Squash commits** (if requested): Maintainers may ask you to squash commits

## Testing

### Running Tests

```bash
# Run all tests
npm run test

# Run tests for specific package
npm run test --filter=@lazuli/api
npm run test --filter=@lazuli/web
```

### Writing Tests

- Place tests next to the code: `component.test.ts`
- Use descriptive test names
- Follow AAA pattern: Arrange, Act, Assert

```typescript
describe('CacheService', () => {
  it('should evict LRU entry when cache is full', () => {
    // Arrange
    const cache = new CacheService();

    // Act
    // ... test code

    // Assert
    expect(result).toBe(expected);
  });
});
```

## Adding a New Package

1. **Create package directory**

   ```bash
   mkdir -p packages/your-package/src
   ```

2. **Add package.json**

   ```json
   {
     "name": "@lazuli/your-package",
     "version": "1.0.0",
     "private": true,
     "main": "src/index.ts"
   }
   ```

3. **Update workspace references** in dependent packages

4. **Add to Turborepo pipeline** if needed

## Getting Help

- **Issues**: Check [GitHub Issues](../../issues)
- **Discussions**: Use [GitHub Discussions](../../discussions)
- **Documentation**: See [README.md](./README.md) and [MONOREPO.md](./MONOREPO.md)

## Code of Conduct

Please be respectful and constructive in all interactions. We're building this together! 🚀
