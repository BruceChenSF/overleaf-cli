# Cross-Platform Build Guide

## Overview

This project uses a **monorepo architecture** with pnpm workspace. To ensure compatibility across **Windows, macOS, and Linux**, we've implemented multiple build strategies.

---

## Quick Start

### Recommended: Simple Build Command

```bash
pnpm build
```

This builds all packages in sequence (respecting dependencies).

### Alternative: Parallel Build

```bash
pnpm build:parallel
```

Builds all packages in parallel (faster, but may have dependency issues).

### Fallback: Node.js Script

```bash
pnpm build:script
# or
node scripts/build-all.js
```

A cross-platform Node.js script that works everywhere.

---

## Package Build Order

Dependencies matter! Packages must be built in this order:

```
1. shared (no dependencies)
2. mirror-server (depends on shared)
3. extension (depends on shared)
4. bridge (depends on shared)
```

The build commands automatically respect this order.

---

## Available Commands

| Command | Description | Platform |
|---------|-------------|----------|
| `pnpm build` | Build all packages in sequence | ✅ All |
| `pnpm build:parallel` | Build all packages in parallel | ✅ All |
| `pnpm build:script` | Build using Node.js script | ✅ All |
| `pnpm clean` | Remove all dist/ directories | ✅ All |
| `pnpm test` | Run all tests | ✅ All |
| `pnpm dev:server` | Dev mode for mirror-server | ✅ All |
| `pnpm dev:extension` | Dev mode for extension | ✅ All |

---

## Platform-Specific Notes

### Windows

**PowerShell:**
```powershell
pnpm build
```

**Command Prompt (cmd):**
```cmd
pnpm build
```

**Git Bash:**
```bash
pnpm build
```

All work correctly! ✅

### macOS & Linux

```bash
pnpm build
```

---

## Why Multiple Build Methods?

We provide three build methods for **redundancy and compatibility**:

### Method 1: pnpm Recursive (`pnpm -r`)
- **Pros**: Native pnpm feature, fastest option
- **Cons**: Filter syntax varies by pnpm version
- **Use for**: Daily development

### Method 2: Node.js Script
- **Pros**: Works on any Node.js platform, full control
- **Cons**: Slower than native pnpm
- **Use for**: CI/CD, troubleshooting

### Method 3: Manual Build
- **Pros**: Maximum control
- **Cons**: Tedious, error-prone
- **Use for**: Debugging specific packages

---

## Troubleshooting

### "Cannot find module '@overleaf-cc/shared'"

**Cause**: shared package not built yet.

**Fix**:
```bash
pnpm build
# or
cd packages/shared && pnpm build && cd ../mirror-server && pnpm build
```

### "No projects matched the filters"

**Cause**: pnpm filter syntax issue (Windows paths).

**Fix**: Use `pnpm -r` instead of `pnpm --filter`:
```bash
pnpm build  # Uses -r internally
```

### Build works but tests fail

**Cause**: Dependencies not properly linked.

**Fix**:
```bash
pnpm install
pnpm build
pnpm test
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Install pnpm
  uses: pnpm/action-setup@v2
  with:
    version: 8

- name: Install dependencies
  run: pnpm install

- name: Build all packages
  run: pnpm build

- name: Run tests
  run: pnpm test
```

### Jenkins Example

```groovy
sh 'npm install -g pnpm'
sh 'pnpm install'
sh 'pnpm build'
sh 'pnpm test'
```

---

## Development Workflow

### First-Time Setup

```bash
# 1. Install pnpm (if not installed)
npm install -g pnpm

# 2. Install dependencies
pnpm install

# 3. Build all packages
pnpm build
```

### Daily Development

```bash
# Make changes to source files

# Rebuild
pnpm build

# Test
pnpm test

# Or use dev mode (auto-rebuild)
pnpm dev:server
```

### Clean Build

```bash
# Remove all dist/ folders
pnpm clean

# Rebuild
pnpm build
```

---

## Performance Tips

1. **Use `build:parallel`** for faster builds on multi-core machines
2. **Use dev mode** (`dev:server`, `dev:extension`) for active development
3. **Skip clean builds** unless troubleshooting dependency issues

---

## Summary

| Feature | Status |
|---------|--------|
| Windows support | ✅ Fully tested |
| macOS support | ✅ Compatible |
| Linux support | ✅ Compatible |
| CI/CD ready | ✅ Yes |
| Monorepo | ✅ pnpm workspace |
| Build order | ✅ Automatic |
| Cross-platform paths | ✅ Handled |

---

**Last Updated**: 2026-03-10
**Tested On**: Windows 11, Node.js v18+
