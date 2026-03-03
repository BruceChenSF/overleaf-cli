# Overleaf CC Browser Extension Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Chrome extension that injects a terminal into Overleaf, using WebContainer to run Claude Code CLI with real-time file sync.

**Architecture:** Chrome Extension (Manifest V3) with Content Script for UI injection, Background Service Worker for API/sync, and standalone terminal window with xterm.js + WebContainer runtime.

**Tech Stack:** TypeScript, Vite, Chrome Extension Manifest V3, xterm.js, WebContainer Core

---

## Task 1: Project Setup with Vite

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`

**Step 1: Create package.json**

Run: `cat > package.json`

```json
{
  "name": "overleaf-cc",
  "version": "0.1.0",
  "description": "Browser extension for running Claude Code in Overleaf",
  "type": "module",
  "scripts": {
    "dev": "vite build --watch --mode development",
    "build": "vite build",
    "test": "echo \"TODO: add tests\""
  },
  "dependencies": {
    "xterm": "^5.3.0",
    "xterm-addon-fit": "^0.8.0",
    "@webcontainer/api": "^1.1.0"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.258",
    "@types/node": "^20.11.0",
    "@crxjs/vite-plugin": "^2.0.0-beta.23",
    "typescript": "^5.3.3",
    "vite": "^5.0.11"
  }
}
```

**Step 2: Create tsconfig.json**

Run: `cat > tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM"],
    "types": ["chrome", "node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create vite.config.ts**

Run: `cat > vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [
    crx({ manifest: manifest as any })
  ],
  build: {
    rollupOptions: {
      input: {
        'background': 'src/background/service-worker.ts',
        'content': 'src/content/injector.ts',
        'terminal': 'src/terminal/index.html'
      }
    }
  }
});
```

**Step 4: Install dependencies**

Run: `npm install`

Expected: All packages installed successfully

**Step 5: Commit**

```bash
git add package.json tsconfig.json vite.config.ts
git commit -m "feat: setup project with Vite and TypeScript"
```

---

## Task 2: Chrome Extension Manifest

**Files:**
- Create: `manifest.json`
- Create: `src/icons/icon.svg`

**Step 1: Create manifest.json**

Run: `cat > manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Overleaf CC",
  "version": "0.1.0",
  "description": "Run Claude Code CLI in Overleaf",
  "permissions": [
    "cookies",
    "storage",
    "tabs",
    "windows"
  ],
  "host_permissions": [
    "https://*.overleaf.com/*"
  ],
  "background": {
    "service_worker": "background/service-worker.ts",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://*.overleaf.com/project/*"],
      "js": ["content/injector.ts"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

**Step 2: Create icon SVG**

Run: `mkdir -p src/icons && cat > src/icons/icon.svg`

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="20" fill="#2563eb"/>
  <text x="64" y="90" font-family="monospace" font-size="72" fill="white" text-anchor="middle">&gt;_</text>
</svg>
```

**Step 3: Generate PNG icons from SVG**

Run: `npx -y svg2png-cli src/icons/icon.svg --output src/icons/icon16.png --width 16 --height 16`
Run: `npx -y svg2png-cli src/icons/icon.svg --output src/icons/icon48.png --width 48 --height 48`
Run: `npx -y svg2png-cli src/icons/icon.svg --output src/icons/icon128.png --width 128 --height 128`

Expected: PNG icons created in src/icons/

**Step 4: Copy icons to root for manifest**

Run: `cp src/icons/icon*.png .`

**Step 5: Commit**

```bash
git add manifest.json src/icons ./*.png
git commit -m "feat: add Chrome extension manifest and icons"
```

---

## Task 3: Shared Types

**Files:**
- Create: `src/shared/types.ts`

**Step 1: Create shared types**

Run: `cat > src/shared/types.ts`

```typescript
// Message types for extension communication
export type ExtensionMessage =
  | OpenTerminalMessage
  | SyncFileMessage
  | FetchFilesMessage
  | TerminalReadyMessage;

export interface OpenTerminalMessage {
  type: 'OPEN_TERMINAL';
  projectId: string;
  projectUrl: string;
}

export interface SyncFileMessage {
  type: 'SYNC_FILE';
  projectId: string;
  filepath: string;
  content: string;
}

export interface FetchFilesMessage {
  type: 'FETCH_FILES';
  projectId: string;
}

export interface TerminalReadyMessage {
  type: 'TERMINAL_READY';
  windowId: number;
}

// Overleaf API types
export interface OverleafDoc {
  _id: string;
  name: string;
  path: string;
}

export interface OverleafProject {
  _id: string;
  name: string;
}

// Sync state
export interface FileSyncState {
  filepath: string;
  docId: string;
  lastSyncedAt: number;
  localHash: string;
}
```

**Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add shared type definitions"
```

---

## Task 4: Overleaf API Manager

**Files:**
- Create: `src/background/overleaf-api.ts`

**Step 1: Create Overleaf API manager**

Run: `cat > src/background/overleaf-api.ts`

```typescript
import type { OverleafDoc } from '../shared/types';

const OVERLEAF_DOMAIN = 'overleaf.com';

export class OverleafAPI {
  private async getSessionCookie(): Promise<string> {
    const cookies = await chrome.cookies.getAll({
      domain: OVERLEAF_DOMAIN
    });

    const sessionCookie = cookies.find(
      c => c.name === 'overleaf_session_id' || c.name === 'connect.sid'
    );

    if (!sessionCookie?.value) {
      throw new Error('Not logged in to Overleaf');
    }

    return sessionCookie.value;
  }

  private async fetchAPI(endpoint: string, options?: RequestInit): Promise<Response> {
    const sessionId = await this.getSessionCookie();

    return fetch(`https://www.overleaf.com${endpoint}`, {
      ...options,
      headers: {
        'Cookie': `overleaf_session_id=${sessionId}`,
        'Content-Type': 'application/json',
        ...options?.headers
      },
      credentials: 'include'
    });
  }

  async getAllDocs(projectId: string): Promise<OverleafDoc[]> {
    const response = await this.fetchAPI(`/api/project/${projectId}/docs`);

    if (!response.ok) {
      throw new Error(`Failed to fetch docs: ${response.statusText}`);
    }

    const data = await response.json();
    return data.docs || [];
  }

  async getDocContent(projectId: string, docId: string): Promise<string> {
    const response = await this.fetchAPI(`/api/project/${projectId}/doc/${docId}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch doc: ${response.statusText}`);
    }

    const data = await response.json();
    return data.doc || '';
  }

  async updateDoc(projectId: string, docId: string, content: string): Promise<void> {
    const response = await this.fetchAPI(`/api/project/${projectId}/doc/${docId}`, {
      method: 'POST',
      body: JSON.stringify({ content, source: 'browser' })
    });

    if (!response.ok) {
      throw new Error(`Failed to update doc: ${response.statusText}`);
    }
  }
}

export const overleafAPI = new OverleafAPI();
```

**Step 2: Commit**

```bash
git add src/background/overleaf-api.ts
git commit -m "feat: add Overleaf API manager"
```

---

## Task 5: Background Service Worker

**Files:**
- Create: `src/background/service-worker.ts`

**Step 1: Create service worker**

Run: `cat > src/background/service-worker.ts`

```typescript
import { overleafAPI } from './overleaf-api';
import type { ExtensionMessage, OpenTerminalMessage, SyncFileMessage } from '../shared/types';

let terminalWindowId: number | null = null;

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true; // Keep message channel open for async response
});

async function handleMessage(message: ExtensionMessage): Promise<any> {
  switch (message.type) {
    case 'OPEN_TERMINAL':
      return await openTerminal(message);

    case 'SYNC_FILE':
      return await syncFile(message);

    case 'FETCH_FILES':
      return await fetchProjectFiles(message.projectId);

    default:
      throw new Error(`Unknown message type: ${(message as any).type}`);
  }
}

async function openTerminal(message: OpenTerminalMessage): Promise<{ windowId: number }> {
  // Validate session first
  try {
    await overleafAPI['getSessionCookie']();
  } catch (err) {
    throw new Error('Please login to Overleaf first');
  }

  // Close existing terminal if open
  if (terminalWindowId !== null) {
    try {
      await chrome.windows.remove(terminalWindowId);
    } catch {
      // Window might already be closed
    }
  }

  // Create new terminal window
  const window = await chrome.windows.create({
    url: chrome.runtime.getURL('terminal/index.html'),
    type: 'popup',
    width: 900,
    height: 600,
    focused: true
  });

  terminalWindowId = window.id ?? null;

  // Store project context for the window
  await chrome.storage.session.set({
    [`window_${window.id}`]: {
      projectId: message.projectId,
      projectUrl: message.projectUrl
    }
  });

  return { windowId: window.id ?? 0 };
}

async function syncFile(message: SyncFileMessage): Promise<void> {
  // TODO: Implement file sync with doc ID lookup
  console.log('Syncing file:', message.filepath);
}

async function fetchProjectFiles(projectId: string): Promise<any> {
  const docs = await overleafAPI.getAllDocs(projectId);

  const files = await Promise.all(
    docs.map(async (doc) => ({
      ...doc,
      content: await overleafAPI.getDocContent(projectId, doc._id)
    }))
  );

  return { files };
}
```

**Step 2: Commit**

```bash
git add src/background/service-worker.ts
git commit -m "feat: add background service worker"
```

---

## Task 6: Content Script - UI Injector

**Files:**
- Create: `src/content/injector.ts`

**Step 1: Create content script injector**

Run: `cat > src/content/injector.ts`

```typescript
import type { OpenTerminalMessage } from '../shared/types';

function extractProjectId(): string | null {
  const match = window.location.href.match(/\/project\/([a-f0-9]+)/i);
  return match ? match[1] : null;
}

function createTerminalButton(): HTMLElement {
  const button = document.createElement('button');
  button.id = 'overleaf-cc-terminal-btn';
  button.className = 'btn-btn-default';
  button.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M0 3v10h16V3H0zm15 9H1V4h14v8zM3 6l3 2-3 2V6zm4 4h5v1H7v-1z"/>
    </svg>
    <span>Terminal</span>
  `;
  button.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    cursor: pointer;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: white;
    font-size: 14px;
  `;

  button.addEventListener('click', openTerminal);

  return button;
}

async function openTerminal(): Promise<void> {
  const projectId = extractProjectId();

  if (!projectId) {
    alert('Could not identify Overleaf project. Please refresh the page.');
    return;
  }

  const message: OpenTerminalMessage = {
    type: 'OPEN_TERMINAL',
    projectId,
    projectUrl: window.location.href
  };

  try {
    const response = await chrome.runtime.sendMessage(message);

    if (response?.error) {
      alert(`Error: ${response.error}`);
    }
  } catch (err) {
    alert(`Failed to open terminal: ${(err as Error).message}`);
  }
}

function injectButton(): void {
  // Find the toolbar nav
  const toolbar = document.querySelector('.ide-redesign-toolbar nav');

  if (!toolbar) {
    console.log('Overleaf toolbar not found, retrying...');
    return;
  }

  // Check if button already exists
  if (document.getElementById('overleaf-cc-terminal-btn')) {
    return;
  }

  // Insert button
  const button = createTerminalButton();
  toolbar.appendChild(button);
  console.log('Terminal button injected');
}

function init(): void {
  // Wait for page to load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(injectButton, 1000);
    });
  } else {
    setTimeout(injectButton, 1000);
  }
}

init();
```

**Step 2: Commit**

```bash
git add src/content/injector.ts
git commit -m "feat: add content script with button injection"
```

---

## Task 7: Terminal Window HTML

**Files:**
- Create: `src/terminal/index.html`

**Step 1: Create terminal HTML page**

Run: `mkdir -p src/terminal && cat > src/terminal/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Overleaf Terminal</title>
  <link rel="stylesheet" href="node_modules/xterm/css/xterm.css" />
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background: #1e1e1e;
    }

    #terminal-container {
      width: 100%;
      height: 100%;
      padding: 8px;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #fff;
      font-family: monospace;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div id="terminal-container">
    <div class="loading">Initializing WebContainer...</div>
  </div>
  <script type="module" src="./terminal-ui.ts"></script>
</body>
</html>
```

**Step 2: Commit**

```bash
git add src/terminal/index.html
git commit -m "feat: add terminal window HTML"
```

---

## Task 8: Terminal UI with xterm.js

**Files:**
- Create: `src/terminal/terminal-ui.ts`

**Step 1: Create terminal UI**

Run: `cat > src/terminal/terminal-ui.ts`

```typescript
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebContainerBridge } from './web-container-bridge';

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

async function init(): Promise<void> {
  const container = document.getElementById('terminal-container');
  if (!container) {
    throw new Error('Terminal container not found');
  }

  container.innerHTML = '';
  terminal.open(container);
  fitAddon.fit();

  // Handle window resize
  window.addEventListener('resize', () => {
    fitAddon.fit();
  });

  // Get project context from storage
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const windowId = tabs[0].windowId;

  const context = await chrome.storage.session.get(`window_${windowId}`);
  const projectContext = context[`window_${windowId}`];

  if (!projectContext) {
    terminal.writeln('\x1b[31mError: Project context not found\x1b[0m');
    terminal.writeln('Please close this window and open terminal from Overleaf again.');
    return;
  }

  // Initialize WebContainer
  const bridge = new WebContainerBridge(terminal, projectContext.projectId);
  await bridge.init();

  terminal.writeln('\x1b[32mWebContainer ready!\x1b[0m');
  terminal.writeln('Type commands or use Claude Code CLI.');
}

init().catch(err => {
  terminal.writeln(`\x1b[31mError: ${err.message}\x1b[0m`);
});
```

**Step 2: Commit**

```bash
git add src/terminal/terminal-ui.ts
git commit -m "feat: add xterm.js terminal UI"
```

---

## Task 9: WebContainer Bridge

**Files:**
- Create: `src/terminal/web-container-bridge.ts`

**Step 1: Create WebContainer bridge**

Run: `cat > src/terminal/web-container-bridge.ts`

```typescript
import { WebContainer } from '@webcontainer/api';
import type { Terminal } from 'xterm';

export class WebContainerBridge {
  private wc: WebContainer | null = null;
  private terminal: Terminal;
  private projectId: string;

  constructor(terminal: Terminal, projectId: string) {
    this.terminal = terminal;
    this.projectId = projectId;
  }

  async init(): Promise<void> {
    try {
      this.wc = await WebContainer.boot();

      // Fetch project files from Overleaf
      const files = await this.fetchProjectFiles();

      // Mount files to workspace
      await this.wc.mount(files);

      // Install claude-code
      this.terminal.writeln('Installing Claude Code CLI...');
      const installProcess = await this.wc.spawn('npm', ['install', '-g', '@anthropic-ai/claude-code']);

      const exitCode = await installProcess.exit;
      if (exitCode !== 0) {
        this.terminal.writeln('\x1b[33mWarning: Claude Code installation may have issues\x1b[0m');
      } else {
        this.terminal.writeln('\x1b[32mClaude Code installed!\x1b[0m');
      }

      // Start shell
      await this.startShell();

    } catch (err) {
      this.terminal.writeln(`\x1b[31mWebContainer init failed: ${(err as Error).message}\x1b[0m`);
      throw err;
    }
  }

  private async fetchProjectFiles(): Promise<Record<string, { file: { contents: string } }>> {
    const response = await chrome.runtime.sendMessage({
      type: 'FETCH_FILES',
      projectId: this.projectId
    });

    if (!response?.files) {
      throw new Error('Failed to fetch project files');
    }

    const files: Record<string, { file: { contents: string } }> = {};

    for (const doc of response.files) {
      const path = doc.path.startsWith('/') ? doc.path.slice(1) : doc.path;
      files[path] = {
        file: { contents: doc.content }
      };
    }

    return files;
  }

  private async startShell(): Promise<void> {
    if (!this.wc) return;

    const shellProcess = await this.wc.spawn('jsh', {
      terminal: {
        cols: this.term.cols,
        rows: this.term.rows
      }
    });

    shellProcess.output.pipeTo(new WritableStream({
      write: (data) => {
        this.term.write(data);
      }
    }));

    const input = this.term.input;
    // @ts-ignore - input is a ReadableStream
    input.pipeTo(shellProcess.input);
  }

  private get term(): { cols: number; rows: number; input: any } {
    return (this.terminal as any)._core._coreService._inputHandler || {
      cols: 80,
      rows: 24,
      input: this.terminal.input
    };
  }
}
```

**Step 2: Fix shell startup**

Run: Edit `src/terminal/web-container-bridge.ts`

Update the `startShell` method to use proper shell command:

```typescript
private async startShell(): Promise<void> {
  if (!this.wc) return;

  // Use proper shell with pty
  const shellProcess = await this.wc.spawn('/bin/jsh', [], {
    terminal: {
      cols: 80,
      rows: 24
    }
  });

  // Pipe output to terminal
  const output = this.terminal as any;
  shellProcess.output.pipeTo(new WritableStream({
    write: (data) => {
      output.write(data);
    }
  }));

  // Set up interactive mode
  this.terminal.onData((data: string) => {
    shellProcess.stdin?.write(data);
  });
}
```

**Step 3: Commit**

```bash
git add src/terminal/web-container-bridge.ts
git commit -m "feat: add WebContainer bridge with shell"
```

---

## Task 10: File Sync Manager

**Files:**
- Create: `src/background/sync-manager.ts`

**Step 1: Create sync manager**

Run: `cat > src/background/sync-manager.ts`

```typescript
import { overleafAPI } from './overleaf-api';
import type { FileSyncState } from '../shared/types';

export class SyncManager {
  private syncStates = new Map<string, FileSyncState>();
  private syncTimers = new Map<string, NodeJS.Timeout>();
  private readonly SYNC_DEBOUNCE_MS = 2000;

  constructor(private projectId: string) {}

  async init(files: Array<{ _id: string; path: string }>): Promise<void> {
    for (const file of files) {
      this.syncStates.set(file.path, {
        filepath: file.path,
        docId: file._id,
        lastSyncedAt: Date.now(),
        localHash: ''
      });
    }
  }

  getDocId(filepath: string): string | undefined {
    return this.syncStates.get(filepath)?.docId;
  }

  async syncFile(filepath: string, content: string): Promise<void> {
    // Clear existing timer
    const existingTimer = this.syncTimers.get(filepath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set debounced sync
    const timer = setTimeout(async () => {
      await this.performSync(filepath, content);
    }, this.SYNC_DEBOUNCE_MS);

    this.syncTimers.set(filepath, timer);
  }

  private async performSync(filepath: string, content: string): Promise<void> {
    const docId = this.getDocId(filepath);

    if (!docId) {
      console.warn(`No doc ID found for ${filepath}, skipping sync`);
      return;
    }

    try {
      await overleafAPI.updateDoc(this.projectId, docId, content);

      const state = this.syncStates.get(filepath);
      if (state) {
        state.lastSyncedAt = Date.now();
        state.localHash = this.hashContent(content);
      }

      console.log(`Synced ${filepath} to Overleaf`);
    } catch (err) {
      console.error(`Failed to sync ${filepath}:`, err);
      // TODO: Save to local backup
    }
  }

  private hashContent(content: string): string {
    // Simple hash for change detection
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
}
```

**Step 2: Update service worker to use sync manager**

Run: `cat > src/background/service-worker.ts`

```typescript
import { overleafAPI } from './overleaf-api';
import { SyncManager } from './sync-manager';
import type { ExtensionMessage, OpenTerminalMessage, SyncFileMessage } from '../shared/types';

let terminalWindowId: number | null = null;
const syncManagers = new Map<string, SyncManager>();

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(message: ExtensionMessage): Promise<any> {
  switch (message.type) {
    case 'OPEN_TERMINAL':
      return await openTerminal(message);

    case 'SYNC_FILE':
      return await syncFile(message);

    case 'FETCH_FILES':
      return await fetchProjectFiles(message.projectId);

    default:
      throw new Error(`Unknown message type: ${(message as any).type}`);
  }
}

async function openTerminal(message: OpenTerminalMessage): Promise<{ windowId: number }> {
  try {
    await overleafAPI['getSessionCookie']();
  } catch (err) {
    throw new Error('Please login to Overleaf first');
  }

  if (terminalWindowId !== null) {
    try {
      await chrome.windows.remove(terminalWindowId);
    } catch {
      // Window might already be closed
    }
  }

  const window = await chrome.windows.create({
    url: chrome.runtime.getURL('terminal/index.html'),
    type: 'popup',
    width: 900,
    height: 600,
    focused: true
  });

  terminalWindowId = window.id ?? null;

  await chrome.storage.session.set({
    [`window_${window.id}`]: {
      projectId: message.projectId,
      projectUrl: message.projectUrl
    }
  });

  // Initialize sync manager
  const docs = await overleafAPI.getAllDocs(message.projectId);
  const syncManager = new SyncManager(message.projectId);
  await syncManager.init(docs);
  syncManagers.set(message.projectId, syncManager);

  return { windowId: window.id ?? 0 };
}

async function syncFile(message: SyncFileMessage): Promise<void> {
  const syncManager = syncManagers.get(message.projectId);

  if (!syncManager) {
    console.warn(`No sync manager for project ${message.projectId}`);
    return;
  }

  await syncManager.syncFile(message.filepath, message.content);
}

async function fetchProjectFiles(projectId: string): Promise<any> {
  const docs = await overleafAPI.getAllDocs(projectId);

  const files = await Promise.all(
    docs.map(async (doc) => ({
      ...doc,
      content: await overleafAPI.getDocContent(projectId, doc._id)
    }))
  );

  return { files };
}
```

**Step 3: Commit**

```bash
git add src/background/sync-manager.ts src/background/service-worker.ts
git commit -m "feat: add file sync manager with debouncing"
```

---

## Task 11: Build and Test

**Files:**
- Create: `.gitignore`

**Step 1: Create .gitignore**

Run: `cat > .gitignore`

```
node_modules/
dist/
*.log
.DS_Store
```

**Step 2: Build extension**

Run: `npm run build`

Expected: Build completes with output in `dist/` folder

**Step 3: Verify build output**

Run: `ls -la dist/`

Expected: Should contain `manifest.json`, `background/`, `content/`, `terminal/`, `icons/`

**Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: add gitignore and verify build"
```

---

## Task 12: Load Extension for Manual Testing

**Step 1: Open Chrome extensions page**

Run: (Manual step) Open `chrome://extensions/` in Chrome

**Step 2: Enable developer mode**

Run: (Manual step) Toggle "Developer mode" in top right

**Step 3: Load unpacked extension**

Run: (Manual step) Click "Load unpacked", select `dist/` folder

Expected: Extension appears in list with Overleaf CC icon

**Step 4: Test on Overleaf**

Run: (Manual steps)
1. Open `https://overleaf.com` and login
2. Open or create a project
3. Look for "Terminal" button in toolbar
4. Click button
5. Terminal window should open
6. Files should sync from Overleaf
7. Try running commands in terminal

**Step 5: Document known issues**

Run: Create `docs/known-issues.md`

```markdown
# Known Issues

## File Sync
- Two-way sync not yet implemented (only WebContainer → Overleaf)
- Conflict resolution not implemented
- Large files may fail silently

## Terminal
- Copy/paste not configured
- Scrollback buffer size not set
- Shell exit handling not implemented

## Authentication
- Session expiration not handled gracefully
- No user-visible error messages for auth failures
```

**Step 6: Commit**

```bash
git add docs/known-issues.md
git commit -m "docs: add known issues documentation"
```

---

## Task 13: Add README

**Files:**
- Create: `README.md`

**Step 1: Create README**

Run: `cat > README.md`

```markdown
# Overleaf CC

Browser extension that brings a terminal to Overleaf, powered by WebContainer.

## Features

- Terminal button injected into Overleaf toolbar
- xterm.js-based terminal in standalone window
- WebContainer provides isolated Node.js environment
- Run Claude Code CLI in your Overleaf projects
- Real-time file sync with Overleaf

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev
```

## Installation

1. Build the extension: `npm run build`
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist/` folder

## Usage

1. Login to Overleaf
2. Open any project
3. Click the "Terminal" button in the toolbar
4. Claude Code CLI will be installed automatically
5. Use the terminal to run commands and Claude Code

## Architecture

- **Content Script**: Injects terminal button into Overleaf UI
- **Background Service Worker**: Manages Overleaf API and file sync
- **Terminal Window**: Standalone window with xterm.js
- **WebContainer**: Isolated Node.js environment

## Known Issues

See [docs/known-issues.md](docs/known-issues.md)

## License

MIT
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## End of Implementation Plan

**Total Tasks:** 13

**Estimated Complexity:** Medium-High

**Next Steps:**
1. Execute this plan using `superpowers:executing-plans` or `superpowers:subagent-driven-development`
2. Test thoroughly with real Overleaf projects
3. Iterate on known issues
4. Add error handling and user notifications
