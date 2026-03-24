#!/usr/bin/env node
import { Command } from 'commander';
import { MirrorServer } from './server';

const program = new Command();

program
  .name('overleaf-cli')
  .description('Overleaf CLI - Bidirectional file sync and terminal')
  .version('2.0.0');

program
  .command('start')
  .description('Start the mirror server')
  .option('-p, --port <number>', 'Port to listen on', '3456')
  .action((options) => {
    console.log('Starting Overleaf Mirror Server...');
    const server = new MirrorServer();

    process.on('SIGINT', () => {
      console.log('\nShutting down server...');
      server.close();
      process.exit(0);
    });
  });

program.parse();
