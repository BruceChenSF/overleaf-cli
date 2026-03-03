#!/usr/bin/env node
import { Command } from 'commander';
import { BridgeServer } from './bridge-server.js';

const program = new Command();

program
  .name('overleaf-cc-bridge')
  .description('Bridge server for Overleaf CC extension')
  .version('0.1.0')
  .option('-p, --port <number>', 'Port to listen on', '3456')
  .action((options) => {
    const port = parseInt(options.port, 10);
    const server = new BridgeServer(port);

    process.on('SIGINT', () => {
      console.log('\n[Bridge] Shutting down...');
      server.close();
      process.exit(0);
    });
  });

program.parse();
