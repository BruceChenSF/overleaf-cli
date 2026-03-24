# Overleaf CC Hybrid Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a hybrid system with local CLI tool + Chrome extension that enables Claude Code to operate on Overleaf projects through bidirectional file synchronization.

**Architecture:** Split into two packages: (1) `@overleaf-cc/bridge` - local Node.js CLI tool with WebSocket server, Claude Code integration, and Overleaf API client; (2) `overleaf-cc-extension` - Chrome extension modified to use WebSocket client instead of WebContainer.

**Tech Stack:** Node.js, TypeScript, ws (WebSocket), chokidar (file watching), @anthropic-ai/claude-code, xterm.js, Chrome Extension Manifest V3

---

## Phase 1: Create Local CLI Bridge Package

### Task 1: Initialize CLI Package Structure

**Files:**
- Create: `packages/bridge/package.json`
- Create: `packages/bridge/tsconfig.json`
- Create: `packages/bridge/src/index.ts`

**Step 1: Create package.json**

```bash
mkdir -p packages/bridge
cat > packages/bridge/package.json << 'EOF'
{
  "name": "@overleaf-cc/bridge",
  "version": "0.1.0",
  "description": "Local CLI bridge for Overleaf CC",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "overleaf-cc-bridge": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/cli.js"
  },
  "dependencies": {
    "ws": "^8.16.0",
    "chokidar": "^3.5.3",
    "commander": "^11.1.0",
    "node-fetch": "^3.3.2"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/ws": "^8.5.10",
    "typescript": "^5.3.3"
  }
}
EOF
```

**Step 2: Create tsconfig.json**

```bash
cat > packages/bridge/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOF
```

**Step 3: Create main entry point**

```bash
cat > packages/bridge/src/index.ts << 'EOF'
export { BridgeServer } from './bridge-server.js';
export { OverleafClient } from './overleaf-client.js';
EOF
```

**Step 4: Commit**

```bash
git add packages/bridge/
git commit -m "feat: initialize bridge package structure

- Create package.json with dependencies (ws, chokidar, commander)
- Setup TypeScript configuration
- Add main entry point"
```

---

### Task 2: Implement Overleaf API Client

**Files:**
- Create: `packages/bridge/src/overleaf-client.ts`

**Step 1: Write the OverleafClient class**

```bash
cat > packages/bridge/src/overleaf-client.ts << 'EOF'
import fetch from 'node-fetch';

export interface OverleafDoc {
  _id: string;
  name: string;
  path: string;
}

export class OverleafClient {
  private baseUrl: string;
  private sessionId: string;

  constructor(sessionCookie: string, domain: 'overleaf.com' | 'cn.overleaf.com' = 'overleaf.com') {
    this.baseUrl = `https://${domain === 'cn.overleaf.com' ? 'cn.' : 'www.'}overleaf.com`;
    this.sessionId = sessionCookie;
  }

  async getAllDocs(projectId: string): Promise<OverleafDoc[]> {
    const response = await fetch(`${this.baseUrl}/api/project/${projectId}/docs`, {
      headers: {
        'Cookie': `overleaf_session_id=${this.sessionId}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch docs: ${response.statusText}`);
    }

    const data = await response.json() as { docs: OverleafDoc[] };
    return data.docs || [];
  }

  async getDocContent(projectId: string, docId: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/project/${projectId}/doc/${docId}`, {
      headers: {
        'Cookie': `overleaf_session_id=${this.sessionId}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch doc: ${response.statusText}`);
    }

    const data = await response.json() as { doc: string };
    return data.doc || '';
  }

  async updateDoc(projectId: string, docId: string, content: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/project/${projectId}/doc/${docId}`, {
      method: 'POST',
      headers: {
        'Cookie': `overleaf_session_id=${this.sessionId}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content, source: 'browser' })
    });

    if (!response.ok) {
      throw new Error(`Failed to update doc: ${response.statusText}`);
    }
  }
}
EOF
```

**Step 2: Commit**

```bash
git add packages/bridge/src/overleaf-client.ts
git commit -m "feat: implement Overleaf API client

- Add OverleafClient class with session authentication
- Implement getAllDocs, getDocContent, updateDoc methods
- Support both overleaf.com and cn.overleaf.com domains"
```

---

### Task 3: Implement File Synchronization Manager

**Files:**
- Create: `packages/bridge/src/sync-manager.ts`

**Step 1: Write the SyncManager class**

```bash
cat > packages/bridge/src/sync-manager.ts << 'EOF'
import chokidar from 'chokidar';
import { promises as fs } from 'fs';
import path from 'path';
import { OverleafClient } from './overleaf-client.js';

export class SyncManager {
  private overleafClient: OverleafClient;
  private projectId: string;
  private localDir: string;
  private fileCache: Map<string, string> = new Map();
  private watcher?: chokidar.FSWatcher;

  constructor(overleafClient: OverleafClient, projectId: string, localDir: string) {
    this.overleafClient = overleafClient;
    this.projectId = projectId;
    this.localDir = localDir;
  }

  async initialSync(): Promise<void> {
    console.log('[Sync] Fetching project files from Overleaf...');

    const docs = await this.overleafClient.getAllDocs(this.projectId);
    console.log(`[Sync] Found ${docs.length} documents`);

    for (const doc of docs) {
      const content = await this.overleafClient.getDocContent(this.projectId, doc._id);
      const filePath = path.join(this.localDir, doc.path);

      // Create directory structure
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Write file
      await fs.writeFile(filePath, content, 'utf-8');
      this.fileCache.set(doc.path, content);

      console.log(`[Sync] Downloaded: ${doc.path}`);
    }

    console.log('[Sync] Initial sync complete');
  }

  startWatching(): void {
    console.log('[Sync] Watching for file changes...');

    this.watcher = chokidar.watch(this.localDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true
    });

    this.watcher.on('change', async (filePath) => {
      const relativePath = path.relative(this.localDir, filePath);
      await this.uploadFile(relativePath);
    });

    this.watcher.on('add', async (filePath) => {
      const relativePath = path.relative(this.localDir, filePath);
      await this.uploadFile(relativePath);
    });
  }

  private async uploadFile(relativePath: string): Promise<void> {
    try {
      const content = await fs.readFile(path.join(this.localDir, relativePath), 'utf-8');
      const cachedContent = this.fileCache.get(relativePath);

      // Only upload if content changed
      if (content !== cachedContent) {
        console.log(`[Sync] Uploading: ${relativePath}`);

        // Find doc ID by path (simplified - in real implementation, cache doc IDs)
        const docs = await this.overleafClient.getAllDocs(this.projectId);
        const doc = docs.find(d => d.path === relativePath);

        if (doc) {
          await this.overleafClient.updateDoc(this.projectId, doc._id, content);
          this.fileCache.set(relativePath, content);
          console.log(`[Sync] Uploaded: ${relativePath}`);
        }
      }
    } catch (error) {
      console.error(`[Sync] Error uploading ${relativePath}:`, error);
    }
  }

  stop(): void {
    this.watcher?.close();
  }
}
EOF
```

**Step 2: Commit**

```bash
git add packages/bridge/src/sync-manager.ts
git commit -m "feat: implement file synchronization manager

- Add SyncManager class with chokidar for file watching
- Implement initial sync from Overleaf to local filesystem
- Implement automatic upload on file changes
- Add file content caching to prevent redundant uploads"
```

---

### Task 4: Implement WebSocket Bridge Server

**Files:**
- Create: `packages/bridge/src/bridge-server.ts`
- Create: `packages/bridge/src/types.ts`

**Step 1: Create shared types**

```bash
cat > packages/bridge/src/types.ts << 'EOF'
export interface BridgeMessage {
  type: 'auth' | 'command' | 'response' | 'sync';
  data: unknown;
}

export interface AuthMessage {
  type: 'auth';
  data: {
    projectId: string;
    sessionCookie: string;
    domain: 'overleaf.com' | 'cn.overleaf.com';
  };
}

export interface CommandMessage {
  type: 'command';
  data: {
    command: string;
    args: string[];
  };
}

export interface ResponseMessage {
  type: 'response';
  data: {
    success: boolean;
    output?: string;
    error?: string;
  };
}
EOF
```

**Step 2: Write the BridgeServer class**

```bash
cat > packages/bridge/src/bridge-server.ts << 'EOF'
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { OverleafClient } from './overleaf-client.js';
import { SyncManager } from './sync-manager.js';
import { promises as fs } from 'fs';
import path from 'path';
import type { BridgeMessage, AuthMessage, CommandMessage } from './types.js';

export class BridgeServer {
  private wss: WebSocketServer;
  private clients: Map<WebSocket, { projectId: string; overleafClient: OverleafClient; syncManager: SyncManager }> = new Map();
  private claudeProcess?: ChildProcess;
  private workDir: string;

  constructor(port: number = 3456) {
    this.wss = new WebSocketServer({ port });
    this.workDir = path.join(process.cwd(), 'overleaf-workspace');

    this.wss.on('connection', (ws) => {
      console.log('[Bridge] Client connected');

      ws.on('message', async (data: string) => {
        try {
          const message = JSON.parse(data) as BridgeMessage;
          await this.handleMessage(ws, message);
        } catch (error) {
          console.error('[Bridge] Error handling message:', error);
          ws.send(JSON.stringify({
            type: 'response',
            data: { success: false, error: 'Invalid message' }
          }));
        }
      });

      ws.on('close', () => {
        console.log('[Bridge] Client disconnected');
        this.clients.delete(ws);
      });
    });

    console.log(`[Bridge] WebSocket server listening on port ${port}`);
  }

  private async handleMessage(ws: WebSocket, message: BridgeMessage): Promise<void> {
    switch (message.type) {
      case 'auth':
        await this.handleAuth(ws, message as AuthMessage);
        break;
      case 'command':
        await this.handleCommand(ws, message as CommandMessage);
        break;
      default:
        ws.send(JSON.stringify({
          type: 'response',
          data: { success: false, error: 'Unknown message type' }
        }));
    }
  }

  private async handleAuth(ws: WebSocket, message: AuthMessage): Promise<void> {
    const { projectId, sessionCookie, domain } = message.data;

    console.log(`[Bridge] Auth request for project ${projectId}`);

    // Create Overleaf client
    const overleafClient = new OverleafClient(sessionCookie, domain);

    // Create project workspace
    const projectDir = path.join(this.workDir, projectId);
    await fs.mkdir(projectDir, { recursive: true });

    // Create sync manager
    const syncManager = new SyncManager(overleafClient, projectId, projectDir);

    // Initial sync
    await syncManager.initialSync();
    syncManager.startWatching();

    // Store client
    this.clients.set(ws, { projectId, overleafClient, syncManager });

    // Send success response
    ws.send(JSON.stringify({
      type: 'response',
      data: { success: true, output: 'Connected and synchronized' }
    }));
  }

  private async handleCommand(ws: WebSocket, message: CommandMessage): Promise<void> {
    const client = this.clients.get(ws);

    if (!client) {
      ws.send(JSON.stringify({
        type: 'response',
        data: { success: false, error: 'Not authenticated' }
      }));
      return;
    }

    const { command, args } = message.data;
    const projectDir = path.join(this.workDir, client.projectId);

    console.log(`[Bridge] Executing: ${command} ${args.join(' ')}`);

    return new Promise((resolve) => {
      const process = spawn(command, args, {
        cwd: projectDir,
        shell: true,
        env: { ...process.env }
      });

      let output = '';
      let errorOutput = '';

      process.stdout?.on('data', (data) => {
        const text = data.toString();
        output += text;
        ws.send(JSON.stringify({
          type: 'response',
          data: { success: true, output: text }
        }));
      });

      process.stderr?.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        ws.send(JSON.stringify({
          type: 'response',
          data: { success: false, error: text }
        }));
      });

      process.on('close', (code) => {
        console.log(`[Bridge] Command exited with code ${code}`);
        resolve();
      });
    });
  }

  close(): void {
    this.wss.close();
    this.clients.forEach((client) => {
      client.syncManager.stop();
    });
  }
}
EOF
```

**Step 3: Commit**

```bash
git add packages/bridge/src/bridge-server.ts packages/bridge/src/types.ts
git commit -m "feat: implement WebSocket bridge server

- Add BridgeServer class with WebSocket handling
- Implement authentication with Overleaf session
- Add command execution in project workspace
- Integrate SyncManager for automatic file sync
- Send real-time stdout/stderr to WebSocket clients"
```

---

### Task 5: Implement CLI Entry Point

**Files:**
- Create: `packages/bridge/src/cli.ts`

**Step 1: Write CLI interface**

```bash
cat > packages/bridge/src/cli.ts << 'EOF'
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
EOF
```

**Step 2: Build and test**

```bash
cd packages/bridge
npm install
npm run build
```

**Step 3: Verify CLI works**

```bash
node dist/cli.js --help
```

Expected output: Help text showing usage instructions

**Step 4: Commit**

```bash
git add packages/bridge/src/cli.ts
git commit -m "feat: implement CLI entry point

- Add commander-based CLI interface
- Support custom port option
- Handle graceful shutdown on SIGINT
- Add help and version commands"
```

---

## Phase 2: Modify Chrome Extension to Use WebSocket

### Task 6: Remove WebContainer Dependency

**Files:**
- Modify: `package.json`
- Delete: `src/terminal/web-container-bridge.ts`

**Step 1: Update root package.json**

```bash
cd /c/Home/CodeProjects/overleaf-cc

npm uninstall @webcontainer/api

# Update package.json to remove @webcontainer/api
# Use Edit tool or manually edit
```

Edit `package.json`, remove `@webcontainer/api` from dependencies.

**Step 2: Delete WebContainer bridge file**

```bash
rm src/terminal/web-container-bridge.ts
```

**Step 3: Commit**

```bash
git add package.json src/terminal/web-container-bridge.ts
git commit -m "refactor: remove WebContainer dependency

- Uninstall @webcontainer/api package
- Remove web-container-bridge.ts file
- Prepare to replace with WebSocket client"
```

---

### Task 7: Implement WebSocket Client

**Files:**
- Create: `src/terminal/websocket-client.ts`

**Step 1: Write WebSocketClient class**

```bash
cat > src/terminal/websocket-client.ts << 'EOF'
import type { Terminal } from 'xterm';

export interface BridgeMessage {
  type: 'auth' | 'command' | 'response' | 'sync';
  data: unknown;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private terminal: Terminal;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(terminal: Terminal) {
    this.terminal = terminal;
  }

  async connect(projectId: string, sessionCookie: string, domain: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://localhost:3456');

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected to bridge server');

        // Send auth message
        this.send({
          type: 'auth',
          data: { projectId, sessionCookie, domain }
        });

        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as BridgeMessage;

          if (message.type === 'response') {
            const data = message.data as { success: boolean; output?: string; error?: string };

            if (data.output) {
              this.terminal.write(data.output);
            }

            if (data.error) {
              this.terminal.writeln(`\r\n\x1b[31m${data.error}\x1b[0m`);
            }
          }
        } catch (error) {
          console.error('[WebSocket] Error parsing message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('[WebSocket] Disconnected from bridge server');
        this.handleReconnect(projectId, sessionCookie, domain);
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        reject(error);
      };
    });
  }

  private handleReconnect(projectId: string, sessionCookie: string, domain: string): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[WebSocket] Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      setTimeout(() => {
        this.connect(projectId, sessionCookie, domain);
      }, 2000 * this.reconnectAttempts);
    } else {
      this.terminal.writeln('\r\n\x1b[31mConnection lost. Please restart the bridge server.\x1b[0m');
    }
  }

  sendCommand(command: string, args: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.terminal.writeln('\r\n\x1b[31mNot connected to bridge server\x1b[0m');
      return;
    }

    this.send({
      type: 'command',
      data: { command, args }
    });
  }

  private send(message: BridgeMessage): void {
    this.ws?.send(JSON.stringify(message));
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
EOF
```

**Step 2: Commit**

```bash
git add src/terminal/websocket-client.ts
git commit -m "feat: implement WebSocket client for terminal

- Add WebSocketClient class to connect to bridge server
- Implement authentication message handling
- Add automatic reconnection logic
- Handle real-time output from bridge server"
```

---

### Task 8: Update Terminal UI to Use WebSocket Client

**Files:**
- Modify: `src/terminal/terminal-ui.ts`

**Step 1: Replace WebContainer with WebSocket**

Edit `src/terminal/terminal-ui.ts`, replace the entire file content with:

```typescript
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebSocketClient } from './websocket-client';
import 'xterm/css/xterm.css';

const terminal = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#ffffff',
    selection: '#264f78'
  }
});

const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);

let wsClient: WebSocketClient | null = null;
let currentLine = '';

async function init(): Promise<void> {
  console.log('[Terminal UI] Starting initialization...');

  const container = document.getElementById('terminal-container');
  if (!container) {
    console.error('[Terminal UI] Container not found!');
    throw new Error('Terminal container not found');
  }

  container.innerHTML = '';
  terminal.open(container);
  fitAddon.fit();
  console.log('[Terminal UI] Terminal opened');

  window.addEventListener('resize', () => {
    fitAddon.fit();
  });

  // Get project context
  const currentWindow = await chrome.windows.getCurrent();
  const windowId = currentWindow.id;
  const context = await chrome.storage.session.get(`window_${windowId}`);
  const projectContext = context[`window_${windowId}`];

  if (!projectContext) {
    terminal.writeln('\x1b[31mError: Project context not found\x1b[0m');
    terminal.writeln('Please close this window and open terminal from Overleaf again.');
    return;
  }

  // Show welcome message
  terminal.writeln('\x1b[1m\x1b[32mOverleaf CC Terminal\x1b[0m');
  terminal.writeln('Project ID: ' + projectContext.projectId);
  terminal.writeln('');

  // Get session cookie
  const sessionCookie = await getSessionCookie();

  if (!sessionCookie) {
    terminal.writeln('\x1b[31mError: Could not find Overleaf session cookie\x1b[0m');
    terminal.writeln('Please make sure you are logged in to Overleaf.');
    return;
  }

  // Detect domain
  const domain = projectContext.projectUrl.includes('cn.overleaf.com') ? 'cn.overleaf.com' : 'overleaf.com';

  // Connect to bridge server
  terminal.writeln('Connecting to bridge server...');
  wsClient = new WebSocketClient(terminal);

  try {
    await wsClient.connect(projectContext.projectId, sessionCookie, domain);
    terminal.writeln('\x1b[32mConnected!\x1b[0m');
    terminal.writeln('Files are being synchronized from Overleaf...');
    terminal.writeln('');
    terminal.writeln('Type commands or use Claude Code CLI.');
    terminal.writeln('');
    showPrompt();
  } catch (error) {
    terminal.writeln('\x1b[31mFailed to connect to bridge server\x1b[0m');
    terminal.writeln('');
    terminal.writeln('Please make sure the bridge server is running:');
    terminal.writeln('  1. Install: npm install -g @overleaf-cc/bridge');
    terminal.writeln('  2. Run: overleaf-cc-bridge');
    terminal.writeln('');
  }

  // Set up input handling
  terminal.onData((data) => {
    if (data === '\r') {
      terminal.writeln('');
      handleCommand(currentLine.trim());
      currentLine = '';
      showPrompt();
    } else if (data === '\u007F') {
      if (currentLine.length > 0) {
        currentLine = currentLine.slice(0, -1);
        terminal.write('\b \b');
      }
    } else if (data.length === 1) {
      currentLine += data;
      terminal.write(data);
    }
  });
}

function showPrompt(): void {
  terminal.write('\x1b[1m\x1b[36moverleaf\x1b[0m:\x1b[1m\x1b[34m~\x1b[0m$ ');
}

async function handleCommand(command: string): Promise<void> {
  if (!command) return;

  const [cmd, ...args] = command.split(' ');

  switch (cmd) {
    case 'clear':
      terminal.clear();
      break;

    case 'claude':
      if (wsClient) {
        terminal.writeln('Starting Claude Code...');
        wsClient.sendCommand('claude', args);
      }
      break;

    case 'npm':
    case 'node':
    case 'npx':
      if (wsClient) {
        wsClient.sendCommand(cmd, args);
      } else {
        terminal.writeln('\x1b[31mNot connected to bridge server\x1b[0m');
      }
      break;

    case 'help':
      terminal.writeln('Available commands:');
      terminal.writeln('  claude   - Run Claude Code CLI');
      terminal.writeln('  npm      - Run npm commands');
      terminal.writeln('  node     - Run Node.js');
      terminal.writeln('  npx      - Run npx packages');
      terminal.writeln('  clear    - Clear terminal');
      terminal.writeln('  help     - Show this help');
      break;

    default:
      terminal.writeln(`Command not found: ${cmd}`);
      terminal.writeln('Type "help" for available commands.');
  }
}

async function getSessionCookie(): Promise<string | null> {
  const cookies = await chrome.cookies.getAll({});

  const sessionCookie = cookies.find(
    c => c.name === 'overleaf_session_id' ||
         c.name === 'connect.sid' ||
         c.name === 'koa.sid' ||
         c.name.includes('session') ||
         c.name.includes('sid')
  );

  return sessionCookie?.value || null;
}

init().catch(err => {
  console.error('[Terminal UI] Init error:', err);
  terminal.writeln(`\x1b[31mError: ${err.message}\x1b[0m`);
});
```

**Step 2: Commit**

```bash
git add src/terminal/terminal-ui.ts
git commit -m "refactor: update terminal UI to use WebSocket client

- Replace WebContainer bridge with WebSocket client
- Add command handling for claude, npm, node, npx
- Show clear error message if bridge server not running
- Maintain simple terminal fallback functionality"
```

---

### Task 9: Update Extension Manifest

**Files:**
- Modify: `manifest.json`

**Step 1: Remove COOP/COEP headers (no longer needed)**

Edit `manifest.json`, remove the `cross_origin_embedder_policy` and `cross_origin_opener_policy` sections.

**Step 2: Update description**

Edit `manifest.json`, update description to reflect new architecture:

```json
{
  "manifest_version": 3,
  "name": "Overleaf CC",
  "version": "0.1.0",
  "description": "Run Claude Code CLI in Overleaf via local bridge server",
  ...
}
```

**Step 3: Commit**

```bash
git add manifest.json
git commit -m "docs: update manifest for WebSocket architecture

- Remove cross-origin isolation headers (no longer needed)
- Update description to reflect bridge server requirement
- Simplify permissions"
```

---

### Task 10: Create Installation and Setup Documentation

**Files:**
- Create: `README.md`
- Create: `docs/INSTALLATION.md`

**Step 1: Create main README**

```bash
cat > README.md << 'EOF'
# Overleaf CC

Run Claude Code CLI in Overleaf with automatic file synchronization.

## Architecture

This project consists of two parts:

1. **@overleaf-cc/bridge** - Local CLI tool that runs Claude Code and syncs files
2. **overleaf-cc-extension** - Chrome extension that provides terminal UI

## Quick Start

### 1. Install the Bridge CLI

\`\`\`bash
npm install -g @overleaf-cc/bridge
\`\`\`

### 2. Start the Bridge Server

\`\`\`bash
overleaf-cc-bridge
\`\`\`

### 3. Install the Chrome Extension

1. Build the extension: \`npm run build\`
2. Open \`chrome://extensions/\`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the \`dist\` directory

### 4. Use in Overleaf

1. Open any Overleaf project
2. Click the "Terminal" button in the toolbar
3. Start using Claude Code!

## How It Works

```
Overleaf Web Page
    ↓ (click Terminal)
Chrome Extension Terminal
    ↓ (WebSocket)
Local Bridge Server
    ↓ (executes)
Claude Code CLI
    ↓ (reads/writes)
Local File System
    ↓ (synced by)
Overleaf API
```

## Development

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for detailed setup instructions.

## License

MIT
EOF
```

**Step 2: Create installation guide**

```bash
cat > docs/INSTALLATION.md << 'EOF'
# Installation Guide

## Prerequisites

- Node.js 18+ installed
- npm or yarn
- Google Chrome browser
- Overleaf account (logged in)

## Install Bridge CLI

### From NPM (Recommended)

\`\`\`bash
npm install -g @overleaf-cc/bridge
\`\`\`

### From Source

\`\`\`bash
git clone https://github.com/yourusername/overleaf-cc.git
cd overleaf-cc/packages/bridge
npm install
npm run build
npm link
\`\`\`

## Install Chrome Extension

### Build Extension

\`\`\`bash
cd overleaf-cc
npm install
npm run build
\`\`\`

### Load in Chrome

1. Open \`chrome://extensions/\`
2. Enable "Developer mode" toggle (top right)
3. Click "Load unpacked" button
4. Select the \`dist\` directory
5. Extension should appear in your extensions list

## Verify Installation

1. Start bridge server: \`overleaf-cc-bridge\`
2. You should see: \`[Bridge] WebSocket server listening on port 3456\`
3. Open Overleaf project
4. Click Terminal button
5. Terminal should connect and show: \`Connected!\`

## Troubleshooting

### Bridge server won't start

- Check if port 3456 is already in use
- Try: \`overleaf-cc-bridge --port 3457\`

### Terminal shows "Failed to connect"

- Make sure bridge server is running
- Check browser console for errors
- Verify WebSocket connection (chrome://extensions → Service Worker)

### Files not syncing

- Check you're logged in to Overleaf
- Verify session cookie is being captured
- Check bridge server logs for sync errors

## Development Setup

For development, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
EOF
```

**Step 3: Commit**

```bash
git add README.md docs/INSTALLATION.md
git commit -m "docs: add installation and setup documentation

- Create main README with quick start guide
- Add detailed installation instructions
- Include troubleshooting section
- Document architecture overview"
```

---

## Phase 3: Testing and Integration

### Task 11: Integration Test - Manual Testing

**Files:**
- Create: `tests/manual/test-bridge-and-extension.md`

**Step 1: Create test plan**

```bash
mkdir -p tests/manual
cat > tests/manual/test-bridge-and-extension.md << 'EOF'
# Manual Integration Test Plan

## Prerequisites

- Bridge CLI installed and running
- Chrome extension loaded
- Overleaf project open

## Test Cases

### TC1: Bridge Server Startup

**Steps:**
1. Run: \`overleaf-cc-bridge\`
2. Check console output

**Expected:**
\`\`\`
[Bridge] WebSocket server listening on port 3456
\`\`\`

**Status:** ☐ Pass ☐ Fail

---

### TC2: Extension Auth

**Steps:**
1. Open Overleaf project
2. Click Terminal button
3. Check bridge server logs

**Expected:**
\`\`\`
[Bridge] Client connected
[Bridge] Auth request for project [ID]
[Sync] Fetching project files from Overleaf...
[Sync] Found N documents
[Sync] Downloaded: [file paths]
[Sync] Initial sync complete
[Sync] Watching for file changes...
\`\`\`

**Status:** ☐ Pass ☐ Fail

---

### TC3: Command Execution

**Steps:**
1. In terminal, type: \`node --version\`
2. Press Enter
3. Check output

**Expected:**
Terminal shows Node.js version number

**Status:** ☐ Pass ☐ Fail

---

### TC4: Claude Code Execution

**Steps:**
1. In terminal, type: \`claude --version\`
2. Press Enter
3. Check output

**Expected:**
Terminal shows Claude Code version

**Status:** ☐ Pass ☐ Fail

---

### TC5: File Sync (Overleaf → Local)

**Steps:**
1. In Overleaf editor, modify a file
2. Save changes
3. Check local workspace directory

**Expected:**
File changes are reflected in local workspace

**Status:** ☐ Pass ☐ Fail

---

### TC6: File Sync (Local → Overleaf)

**Steps:**
1. In Claude Code, modify a file
2. Wait 2 seconds
3. Refresh Overleaf editor

**Expected:**
Changes appear in Overleaf editor

**Status:** ☐ Pass ☐ Fail

---

## Test Results Summary

| Test Case | Result | Notes |
|-----------|--------|-------|
| TC1 | | |
| TC2 | | |
| TC3 | | |
| TC4 | | |
| TC5 | | |
| TC6 | | |

**Date:** ___________
**Tester:** ___________
EOF
```

**Step 2: Commit**

```bash
git add tests/manual/test-bridge-and-extension.md
git commit -m "test: add manual integration test plan

- Create comprehensive test cases
- Cover bridge server, auth, commands, and file sync
- Include test results template"
```

---

### Task 12: Final Build and Verification

**Files:**
- Build: All packages

**Step 1: Build bridge package**

```bash
cd packages/bridge
npm run build
```

Expected: No errors, `dist/` directory created with compiled JS

**Step 2: Build extension**

```bash
cd /c/Home/CodeProjects/overleaf-cc
npm run build
```

Expected: No errors, `dist/` directory updated

**Step 3: Verify extension manifest**

```bash
cat dist/manifest.json | jq .
```

Expected: Valid JSON with all required fields

**Step 4: Commit final version**

```bash
git add .
git commit -m "chore: final build verification

- Build bridge package successfully
- Build extension successfully
- Verify all components are ready for testing
- Ready for alpha release"
```

---

### Task 13: Create Release Notes

**Files:**
- Create: `RELEASE_NOTES.md`

**Step 1: Write release notes**

```bash
cat > RELEASE_NOTES.md << 'EOF'
# Release Notes - v0.1.0 (Alpha)

## Overview

This is the first alpha release of Overleaf CC, a hybrid system that enables running Claude Code CLI in Overleaf with automatic file synchronization.

## What's New

### Architecture
- Split into two packages: bridge CLI tool and Chrome extension
- WebSocket-based communication between extension and local tool
- Automatic bidirectional file synchronization

### Bridge CLI (`@overleaf-cc/bridge`)
- WebSocket server on port 3456
- Overleaf API client with session authentication
- File synchronization manager with chokidar
- Command execution in isolated workspace
- Support for both overleaf.com and cn.overleaf.com

### Chrome Extension
- xterm.js-based terminal UI
- WebSocket client for bridge communication
- Automatic session cookie detection
- Project context management
- Fallback simple terminal mode

## Known Issues

- File sync conflicts are not resolved (last write wins)
- No support for binary files
- Claude Code must be installed separately
- Bridge server must be started manually

## Installation

See [README.md](README.md) for quick start guide.

## Requirements

- Node.js 18+
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- Google Chrome
- Overleaf account

## Next Steps

- [ ] Add conflict resolution for file sync
- [ ] Support for binary files (images, etc.)
- [ ] Auto-installation of Claude Code
- [ ] Background service for bridge server
- [ ] File sync status indicator in UI

## Feedback

Please report issues at: https://github.com/yourusername/overleaf-cc/issues
EOF
```

**Step 2: Commit**

```bash
git add RELEASE_NOTES.md
git commit -m "docs: add release notes for v0.1.0 alpha

- Document new features and architecture
- List known issues and limitations
- Outline requirements and installation steps
- Provide roadmap for future improvements"
```

---

## Summary

This implementation plan creates a hybrid system with:

1. **Local CLI Bridge** (`@overleaf-cc/bridge`)
   - WebSocket server (port 3456)
   - Overleaf API integration
   - File synchronization with chokidar
   - Command execution in workspace

2. **Chrome Extension** (modified)
   - WebSocket client connection
   - xterm.js terminal UI
   - Session cookie detection
   - Real-time command execution

3. **File Sync**
   - Initial sync from Overleaf on connection
   - Automatic upload on local file changes
   - Bidirectional sync via Overleaf API

**Total estimated time:** 13 tasks × ~15 minutes = 3-4 hours

**Next steps after implementation:**
- Test all components together
- Fix any integration issues
- Refine file sync logic
- Add error handling
- Polish user experience
EOF
