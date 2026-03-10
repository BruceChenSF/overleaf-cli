#!/usr/bin/env node
import { MirrorServer } from './server';
import { homedir } from 'os';

console.log('='.repeat(60));
console.log('🚀 Overleaf Mirror Server');
console.log('='.repeat(60));
console.log(`📁 Default mirror directory: ${homedir()}/overleaf-mirror`);
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
