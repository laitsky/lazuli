# Lazuli Monorepo Architecture

This document explains the monorepo structure, tooling, and best practices for the Lazuli project.

## Table of Contents

- [Why Monorepo?](#why-monorepo)
- [Tooling](#tooling)
- [Directory Structure](#directory-structure)
- [Package Management](#package-management)
- [Build Pipeline](#build-pipeline)
- [Development Workflow](#development-workflow)
- [Best Practices](#best-practices)

## Why Monorepo?

### Benefits

✅ **Code Sharing**: Easy to share code between frontend and backend
✅ **Atomic Changes**: Single PR can update API and Web together
✅ **Consistent Tooling**: Same linting, formatting, TypeScript config
✅ **Type Safety**: Shared types eliminate API/UI mismatches
✅ **Simplified Dependencies**: One node_modules, faster installs
✅ **Better CI/CD**: Turborepo caches builds, runs only what changed

### Industry Adoption

- Google (internal monorepo with billions of lines of code)
- Facebook/Meta (React, React Native in monorepo)
- Vercel (Next.js, Turbo, etc.)
- Microsoft (VS Code extensions)

## Tooling

### Turborepo

**Purpose**: Build orchestration and caching

**Features**:

- Task pipeline with dependencies
- Remote caching for CI/CD
- Parallel execution
- Only builds what changed

**Configuration**: `turbo.json`

### npm Workspaces

**Purpose**: Dependency management

**Features**:

- Shared dependencies hoisted to root
- Package linking without `npm link`
- Workspace protocol for internal packages

**Configuration**: `package.json#workspaces`

### Husky

**Purpose**: Git hooks for code quality

**Features**:

- Pre-commit linting and formatting
- Commit message validation
- Prevents bad commits from being pushed

**Configuration**: `.husky/`

### ESLint & Prettier

**Purpose**: Code quality and formatting

**Features**:

- Shared configurations across packages
- Auto-fix on save (IDE)
- Auto-fix on commit (Husky)

**Configuration**: `packages/config/eslint/`

## Directory Structure

```
lazuli/
├── .github/              # GitHub Actions workflows
├── .husky/               # Git hooks (Husky)
├── apps/                 # Applications
│   ├── api/              # Elysia REST API
│   │   ├── src/
│   │   │   ├── controllers/
│   │   │   ├── services/
│   │   │   ├── utils/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/              # React + Vite frontend
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── packages/             # Shared packages
│   ├── shared/           # Shared TypeScript types
│   │   ├── src/
│   │   │   └── index.ts
│   │   └── package.json
│   └── config/           # Configuration packages
│       ├── eslint/       # ESLint configs
│       │   ├── index.js  # Base config
│       │   ├── react.js  # React config
│       │   └── package.json
│       └── typescript/   # TypeScript configs
│           ├── base.json
│           ├── node.json
│           └── package.json
├── .commitlintrc.json    # Commit message rules
├── .prettierrc.json      # Code formatting rules
├── turbo.json            # Turborepo configuration
├── package.json          # Root package.json
└── README.md             # Project documentation
```

### Package Naming Convention

All internal packages use the `@lazuli/` namespace:

- `@lazuli/api` - REST API application
- `@lazuli/web` - React + Vite web application
- `@lazuli/shared` - Shared TypeScript types
- `@lazuli/eslint-config` - ESLint configuration
- `@lazuli/typescript-config` - TypeScript configuration

## Package Management

### Installing Dependencies

```bash
# Install for all packages
npm install

# Install for specific package
npm install <package> --workspace=@lazuli/api
npm install <package> --workspace=@lazuli/web

# Install dev dependency at root
npm install <package> --save-dev
```

### Workspace Protocol

Use `"*"` to reference internal packages:

```json
{
  "dependencies": {
    "@lazuli/shared": "*"
  }
}
```

npm automatically links to the local package during development.

### Hoisting

Dependencies are hoisted to the root `node_modules` when possible:

- ✅ Single version of React across all packages
- ✅ Faster installs
- ✅ Smaller total size

## Build Pipeline

### Turborepo Pipeline

Defined in `turbo.json`:

```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "lint": {},
    "type-check": {},
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

### Task Dependencies

The `^` symbol means "dependencies first":

```json
"build": {
  "dependsOn": ["^build"]
}
```

**Execution order**:

1. Build `@lazuli/shared` (no dependencies)
2. Build `@lazuli/api` (depends on shared)
3. Build `@lazuli/web` (depends on shared)

### Caching

Turborepo caches task outputs:

- **Inputs**: Source files, dependencies, config files
- **Outputs**: `dist/`, etc.
- **Cache hit**: Instant "build" from cache
- **Cache miss**: Runs build, saves to cache

**Example**:

```bash
# First build: ~30s
npm run build

# No changes: ~0.1s (from cache)
npm run build

# Change only API: rebuilds API, uses cache for Web
npm run build
```

### Remote Caching (Future)

For CI/CD, you can enable remote caching:

```bash
npx turbo login
npx turbo link
```

Now your CI and team members share the cache!

## Development Workflow

### Starting Development

```bash
# Run all apps (API + Web)
npm run dev

# Run specific app
npm run dev:api
npm run dev:web
```

### Making Changes

1. **Edit code** in any package
2. **Hot reload** automatically refreshes
3. **Type errors** show in real-time (if using IDE)

### Building for Production

```bash
# Build all packages
npm run build

# Build specific package
npm run build:api
npm run build:web
```

### Code Quality Checks

```bash
# Lint all packages
npm run lint

# Fix linting issues
npm run lint:fix

# Check TypeScript types
npm run type-check

# Format code
npm run format

# Check formatting
npm run format:check
```

### Git Workflow

```bash
# Create branch
git checkout -b feat/new-feature

# Make changes
# ...

# Stage changes
git add .

# Commit (triggers Husky pre-commit hook)
git commit -m "feat: add new feature"
# ✅ Lint-staged runs ESLint + Prettier
# ✅ Commitlint validates message

# Push
git push origin feat/new-feature
```

## Best Practices

### 1. Shared Types

**Always** define shared types in `packages/shared`:

```typescript
// packages/shared/src/index.ts
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: string | null;
}

// apps/api/src/controllers/...
import { ApiResponse } from '@lazuli/shared';

// apps/web/app/...
import { ApiResponse } from '@lazuli/shared';
```

### 2. Configuration Sharing

Use shared configs instead of duplicating:

```json
// apps/api/tsconfig.json
{
  "extends": "@lazuli/typescript-config/node.json"
}

// apps/web/tsconfig.json
{
  "compilerOptions": { /* Vite-specific options */ }
}
```

### 3. Atomic Changes

When changing shared types, update both API and Web in the same PR:

```bash
# ✅ Good: Single PR with both changes
- packages/shared/src/index.ts (add new field)
- apps/api/src/controllers/... (use new field)
- apps/web/app/... (display new field)

# ❌ Bad: Separate PRs can break builds
- PR1: Add field to shared types
- PR2: (later) Update API to use it
```

### 4. Turbo Filters

Run tasks for specific packages:

```bash
# Build only API and its dependencies
turbo run build --filter=@lazuli/api

# Build API and all dependents
turbo run build --filter=...@lazuli/api

# Build changed packages only
turbo run build --filter=[HEAD^1]
```

### 5. Cache Debugging

If caching seems wrong:

```bash
# See what Turbo is doing
turbo run build --dry-run

# Force rebuild (ignore cache)
turbo run build --force

# Clear cache
rm -rf .turbo
```

## Troubleshooting

### "Module not found: @lazuli/shared"

**Solution**: Install dependencies

```bash
npm install
```

### "tsc: Command not found"

**Solution**: TypeScript is a workspace dependency

```bash
cd /home/user/lazuli  # Go to root
npm run type-check     # Run from root
```

### Build Hangs

**Solution**: Kill background processes

```bash
# Find Node processes
ps aux | grep node

# Kill specific process
kill <PID>

# Or kill all Node processes
pkill -f node
```

### Turbo Cache Issues

**Solution**: Clear cache

```bash
npm run clean
rm -rf .turbo
npm install
npm run build
```

## Further Reading

- [Turborepo Documentation](https://turbo.build/repo/docs)
- [npm Workspaces Documentation](https://docs.npmjs.com/cli/v7/using-npm/workspaces)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Husky Documentation](https://typicode.github.io/husky/)

## Questions?

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines and [README.md](./README.md) for project overview.
