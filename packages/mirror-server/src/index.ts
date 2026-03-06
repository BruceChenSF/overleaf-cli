#!/usr/bin/env node
import { MirrorServer } from './server';
import * as fs from 'fs';
import * as path from 'path';

// Get project directory from command line args or use default
const projectDir = process.argv[2] || path.join(process.env.HOME || process.env.USERPROFILE || '', 'OverleafProjects');

// Ensure project directory exists
if (!fs.existsSync(projectDir)) {
  console.log(`Creating project directory: ${projectDir}`);
  fs.mkdirSync(projectDir, { recursive: true });
}

console.log('='.repeat(60));
console.log('🚀 Overleaf Mirror Server');
console.log('='.repeat(60));
console.log(`📁 Project directory: ${projectDir}`);
console.log('');

// Create and start the server
const server = new MirrorServer();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down gracefully...');
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\nShutting down gracefully...');
  server.close();
  process.exit(0);
});

console.log('✅ Server started. Press Ctrl+C to stop.\n');
