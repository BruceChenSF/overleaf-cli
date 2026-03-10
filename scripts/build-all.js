#!/usr/bin/env node

/**
 * Cross-platform build script for Overleaf Mirror monorepo
 * Works on Windows, macOS, and Linux
 */

const { spawn } = require('child_process');
const path = require('path');

// Build order matters - shared must be built first
const packages = [
  'shared',
  'mirror-server',
  'extension',
  'bridge'
];

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function buildPackage(packageName) {
  const packagePath = path.join(__dirname, '..', 'packages', packageName);

  log(`\n📦 Building ${packageName}...`, 'blue');

  return new Promise((resolve, reject) => {
    const buildProcess = spawn('pnpm', ['build'], {
      cwd: packagePath,
      shell: true,
      stdio: 'inherit'
    });

    buildProcess.on('close', (code) => {
      if (code === 0) {
        log(`✅ ${packageName} built successfully`, 'green');
        resolve();
      } else {
        log(`❌ ${packageName} build failed`, 'red');
        reject(new Error(`Build failed for ${packageName}`));
      }
    });

    buildProcess.on('error', (error) => {
      log(`❌ Failed to start build for ${packageName}: ${error.message}`, 'red');
      reject(error);
    });
  });
}

async function buildAll() {
  log('🚀 Starting cross-platform build for all packages...\n', 'yellow');

  const startTime = Date.now();

  try {
    for (const pkg of packages) {
      await buildPackage(pkg);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`\n✨ All packages built successfully in ${duration}s!`, 'green');
    process.exit(0);
  } catch (error) {
    log(`\n💥 Build failed: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Handle Windows specific issues
if (process.platform === 'win32') {
  // Ensure proper path handling on Windows
  process.env.PATH = process.env.PATH || '';
}

buildAll();
