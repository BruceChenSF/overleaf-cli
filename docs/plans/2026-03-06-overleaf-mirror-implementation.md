# Overleaf Mirror Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a lightweight API forwarding and local backend service system that enables real-time bidirectional synchronization between Overleaf and local file system for Claude Code to use.

**Architecture:**
- **Browser Extension**: Intercepts fetch API calls to Overleaf, mirrors requests to local backend
- **Local Backend**: WebSocket server that maintains a local mirror of Overleaf project files
- **File Watcher**: Monitors local changes and syncs back to Overleaf via browser extension
- **Direct File Access**: Files written to disk at `~/overleaf-mirror/{project_id}/`

**Tech Stack:**
- Node.js 18+ with TypeScript
- Express.js + ws (WebSocket)
- chokidar (file watching)
- fs-extra (file operations)
- Chrome Extension Manifest V3
- Vite for building

---

## Phase 1: API Research and Documentation

### Task 1: Explore Overleaf Repository Structure

**Files:**
- Reference: `C:\Home\CodeProjects\overleaf\services\web\app\src\Router.js`
- Reference: `C:\Home\CodeProjects\overleaf\services\web\app\src\Project\`
- Create: `docs/overleaf-api-reference.md`

**Step 1: Locate and read main router file**

Run: `code "C:\Home\CodeProjects\overleaf\services\web\app\src\Router.js"`
Expected: File opens in code editor

**Step 2: Search for file-related API routes**

Run: `grep -n "project.*doc" "C:\Home\CodeProjects\overleaf\services\web\app\src\Router.js" | head -20`
Expected: List of route definitions matching pattern

**Step 3: Identify Project-related controllers**

Run: `ls "C:\Home\CodeProjects\overleaf\services\web\app\src\Project\"`
Expected: List of Project controller files

**Step 4: Create initial API documentation skeleton**

Create: `docs/overleaf-api-reference.md`

```markdown
# Overleaf API Reference

**Purpose:** Document all Overleaf API endpoints needed for file mirroring

**Research Date:** 2026-03-06

## Discovered Routes

<!-- Fill in as we explore -->

## Project Structure

<!-- Document key controllers and their responsibilities -->
```

**Step 5: Commit initial documentation**

Run:
```bash
git add docs/overleaf-api-reference.md
git commit -m "docs: add API reference skeleton"
```

---

### Task 2: Document File Listing API

**Files:**
- Reference: `C:\Home\CodeProjects\overleaf\services\web\app\src\Project\ProjectEntity.js`
- Modify: `docs/overleaf-api-reference.md`

**Step 1: Open ProjectEntity controller**

Run: `code "C:\Home\CodeProjects\overleaf\services\web\app\src\Project\ProjectEntity.js"`
Expected: File opens

**Step 2: Find file listing endpoint handler**

Run: `grep -n "getAllDocum" "C:\Home\CodeProjects\overleaf\services\web\app\src\Project\ProjectEntity.js"`
Expected: Function definition found

**Step 3: Read the handler implementation**

Run: `sed -n '1,50p' "C:\Home\CodeProjects\overleaf\services\web\app\src\Project\ProjectEntity.js"`
Expected: First 50 lines of controller displayed

**Step 4: Document the GET /project/:id/docs endpoint**

Add to `docs/overleaf-api-reference.md`:

```markdown
### GET /project/:id/docs

**Purpose:** Get all documents in a project

**Request:**
- Method: GET
- URL: `/api/project/{project_id}/docs`
- Auth: Session cookie required

**Response:**
```json
{
  "docs": [
    {
      "_id": "doc_id_string",
      "name": "main.tex",
      "folder": null or "folder_id",
      "created": "2026-03-06T10:00:00.000Z",
      "updated": "2026-03-06T12:00:00.000Z"
    }
  ]
}
```
```

**Step 5: Commit documentation**

Run:
```bash
git add docs/overleaf-api-reference.md
git commit -m "docs: document file listing API"
```

---

### Task 3: Document File Content Retrieval API

**Files:**
- Reference: `C:\Home\CodeProjects\overleaf\services\web\app\src\Project\ProjectEntity.js`
- Modify: `docs/overleaf-api-reference.md`

**Step 1: Find getDocument handler**

Run: `grep -n "getDoc" "C:\Home\CodeProjects\overleaf\services\web\app\src\Project\ProjectEntity.js" | head -5`
Expected: Function definition lines

**Step 2: Read handler implementation**

Run: `sed -n '100,150p' "C:\Home\CodeProjects\overleaf\services\web\app\src\Project\ProjectEntity.js"`
Expected: Handler implementation displayed

**Step 3: Document GET /project/:id/doc/:doc_id**

Add to `docs/overleaf-api-reference.md`:

```markdown
### GET /project/:id/doc/:doc_id

**Purpose:** Get document content

**Request:**
- Method: GET
- URL: `/api/project/{project_id}/doc/{doc_id}`
- Auth: Session cookie required

**Response:**
```json
{
  "_id": "doc_id_string",
  "name": "main.tex",
  "content": "\\documentclass{article}\n...",
  "version": 123,
  "folder": null
}
```
```

**Step 4: Commit documentation**

Run:
```bash
git add docs/overleaf-api-reference.md
git commit -m "docs: document file content retrieval API"
```

---

### Task 4: Document File Update API

**Files:**
- Reference: `C:\Home\CodeProjects\overleaf\services\web\app\src\Project\EntityUpdateHandler.js`
- Modify: `docs/overleaf-api-reference.md`

**Step 1: Open EntityUpdateHandler**

Run: `code "C:\Home\CodeProjects\overleaf\services\web\app\src\Project\EntityUpdateHandler.js"`
Expected: File opens

**Step 2: Find updateDocument function**

Run: `grep -n "updateDoc" "C:\Home\CodeProjects\overleaf\services\web\app\src\Project\EntityUpdateHandler.js"`
Expected: Function definition found

**Step 3: Document POST /project/:id/doc**

Add to `docs/overleaf-api-reference.md`:

```markdown
### POST /project/:id/doc

**Purpose:** Create or update a document

**Request:**
- Method: POST
- URL: `/api/project/{project_id}/doc`
- Auth: Session cookie required
- Body:
```json
{
  "doc_id": "existing_id" or null (for create),
  "name": "filename.tex",
  "folder": "folder_id" or null,
  "content": "file content here",
  "version": 123
}
```

**Response:**
```json
{
  "_id": "doc_id_string",
  "version": 124,
  "name": "filename.tex"
}
```
```

**Step 4: Commit documentation**

Run:
```bash
git add docs/overleaf-api-reference.md
git commit -m "docs: document file update API"
```

---

### Task 5: Document File Deletion and Rename APIs

**Files:**
- Reference: `C:\Home\CodeProjects\overleaf\services\web\app\src\Project\EntityUpdateHandler.js`
- Modify: `docs/overleaf-api-reference.md`

**Step 1: Find delete handler**

Run: `grep -n "deleteDoc" "C:\Home\CodeProjects\overleaf\services\web\app\src\Project\EntityUpdateHandler.js"`
Expected: Delete function found

**Step 2: Find rename handler**

Run: `grep -n "renameDoc" "C:\Home\CodeProjects\overleaf\services\web\app\src\Project\EntityUpdateHandler.js"`
Expected: Rename function found

**Step 3: Document DELETE and rename endpoints**

Add to `docs/overleaf-api-reference.md`:

```markdown
### DELETE /project/:id/doc/:doc_id

**Purpose:** Delete a document

**Request:**
- Method: DELETE
- URL: `/api/project/{project_id}/doc/{doc_id}`
- Auth: Session cookie required

**Response:**
```json
{
  "success": true
}
```

### POST /project/:id/doc/:doc_id/rename

**Purpose:** Rename a document

**Request:**
- Method: POST
- URL: `/api/project/{project_id}/doc/{doc_id}/rename`
- Auth: Session cookie required
- Body:
```json
{
  "newName": "new_filename.tex"
}
```

**Response:**
```json
{
  "_id": "doc_id_string",
  "name": "new_filename.tex"
}
```
```

**Step 4: Commit documentation**

Run:
```bash
git add docs/overleaf-api-reference.md
git commit -m "docs: document file deletion and rename APIs"
```

---

### Task 6: Document Folder Operations API

**Files:**
- Reference: `C:\Home\CodeProjects\overleaf\services\web\app\src\Project\FolderController.js` (or similar)
- Modify: `docs/overleaf-api-reference.md`

**Step 1: Find folder controller**

Run: `find "C:\Home\CodeProjects\overleaf\services\web\app\src" -name "*older*.js" -type f`
Expected: List of folder-related files

**Step 2: Examine folder operations**

Run: `grep -n "createFolder\|deleteFolder" "C:\Home\CodeProjects\overleaf\services\web\app\src\Project\FolderController.js"`
Expected: Folder operation definitions

**Step 3: Document folder endpoints**

Add to `docs/overleaf-api-reference.md`:

```markdown
### POST /project/:id/folder

**Purpose:** Create a folder

**Request:**
- Method: POST
- URL: `/api/project/{project_id}/folder`
- Auth: Session cookie required
- Body:
```json
{
  "name": "folder_name",
  "parentFolderId": "parent_id" or null
}
```

**Response:**
```json
{
  "_id": "folder_id_string",
  "name": "folder_name"
}
```

### DELETE /project/:id/folder/:folder_id

**Purpose:** Delete a folder and all its contents

**Request:**
- Method: DELETE
- URL: `/api/project/{project_id}/folder/{folder_id}`
- Auth: Session cookie required

**Response:**
```json
{
  "success": true
}
```
```

**Step 4: Commit documentation**

Run:
```bash
git add docs/overleaf-api-reference.md
git commit -m "docs: document folder operations APIs"
```

---

### Task 7: Complete API Documentation with Versioning Info

**Files:**
- Modify: `docs/overleaf-api-reference.md`

**Step 1: Research version mechanism**

Run: `grep -rn "version" "C:\Home\CodeProjects\overleaf\services\web\app\src\Project\" | grep -i "docum" | head -10`
Expected: Version-related code snippets

**Step 2: Document versioning strategy**

Add to `docs/overleaf-api-reference.md`:

```markdown
## Versioning

Overleaf uses integer version numbers for documents:
- Each update increments the version
- Used for conflict detection
- Required for updates (optimistic locking)

**Example:**
```json
{
  "_id": "doc_id",
  "name": "main.tex",
  "version": 42,  // Current version
  "content": "..."
}
```

**Update with version:**
```json
{
  "doc_id": "doc_id",
  "version": 42,  // Must match current version
  "content": "new content"
}
```
```

**Step 3: Add authentication notes**

Add to `docs/overleaf-api-reference.md`:

```markdown
## Authentication

All API calls require session authentication:

**Cookie:** `overleaf_session2`

**How to get it:**
- From browser: `chrome.cookies.get({ url: 'https://overleaf.com', name: 'overleaf_session2' })`
- Must be included in all requests

** CSRF Token:**
- Some requests may require `x-csrf-token` header
- Token available in meta tag: `meta[name="csrf-token"]`
```

**Step 4: Commit completed documentation**

Run:
```bash
git add docs/overleaf-api-reference.md
git commit -m "docs: complete API reference with versioning and auth"
```

---

## Phase 2: Project Setup - Monorepo Structure

### Task 8: Initialize Monorepo Structure

**Files:**
- Modify: `package.json`
- Create: `packages/mirror-server/package.json`
- Create: `packages/extension/package.json`
- Create: `pnpm-workspace.yaml`

**Step 1: Initialize pnpm workspace**

Create: `pnpm-workspace.yaml`

```yaml
packages:
  - 'packages/*'
```

**Step 2: Update root package.json**

Modify: `package.json`

```json
{
  "name": "overleaf-cc",
  "version": "2.0.0",
  "private": true,
  "description": "Overleaf Mirror - Bidirectional file sync for Claude Code",
  "scripts": {
    "build": "pnpm --filter './packages/*' build",
    "dev:server": "pnpm --filter @overleaf-cc/mirror-server dev",
    "dev:extension": "pnpm --filter @overleaf-cc/extension dev",
    "test": "pnpm --filter './packages/*' test"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "prettier": "^3.1.0"
  },
  "engines": {
    "node": ">=18.0.0",
    "pnpm": ">=8.0.0"
  }
}
```

**Step 3: Create mirror-server package.json**

Create: `packages/mirror-server/package.json`

```json
{
  "name": "@overleaf-cc/mirror-server",
  "version": "1.0.0",
  "description": "Local backend service for Overleaf file mirroring",
  "main": "dist/server.js",
  "bin": {
    "overleaf-mirror-server": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/server.js",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.16.0",
    "chokidar": "^3.5.3",
    "fs-extra": "^11.2.0",
    "commander": "^11.1.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/ws": "^8.5.10",
    "@types/fs-extra": "^11.0.4",
    "typescript": "^5.3.3",
    "ts-node": "^10.9.2",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.11"
  }
}
```

**Step 4: Create extension package.json**

Create: `packages/extension/package.json`

```json
{
  "name": "@overleaf-cc/extension",
  "version": "1.0.0",
  "description": "Browser extension for Overleaf API interception",
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/chrome": "^0.0.254",
    "typescript": "^5.3.3",
    "vite": "^5.0.10"
  }
}
```

**Step 5: Commit monorepo structure**

Run:
```bash
git add pnpm-workspace.yaml package.json packages/
git commit -m "feat: initialize monorepo structure"
```

---

### Task 9: Setup TypeScript Configuration

**Files:**
- Create: `tsconfig.json` (root)
- Create: `packages/mirror-server/tsconfig.json`
- Create: `packages/extension/tsconfig.json`

**Step 1: Create root TypeScript config**

Create: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist"
  },
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

**Step 2: Create mirror-server TypeScript config**

Create: `packages/mirror-server/tsconfig.json`

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create extension TypeScript config**

Create: `packages/extension/tsconfig.json`

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["chrome"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Commit TypeScript configs**

Run:
```bash
git add tsconfig.json packages/*/tsconfig.json
git commit -m "feat: setup TypeScript configuration"
```

---

## Phase 3: Mirror Server - Core Infrastructure

### Task 10: Define Shared Types

**Files:**
- Create: `packages/mirror-server/src/types.ts`

**Step 1: Write type definitions**

Create: `packages/mirror-server/src/types.ts`

```typescript
/**
 * Shared types for Overleaf Mirror system
 */

// WebSocket message types
export type WSMessage =
  | MirrorRequestMessage
  | SyncCommandMessage
  | AckMessage;

export interface MirrorRequestMessage {
  type: 'mirror';
  project_id: string;
  api_endpoint: string;
  method: string;
  data: unknown;
}

export interface SyncCommandMessage {
  type: 'sync';
  project_id: string;
  operation: 'create' | 'update' | 'delete' | 'rename';
  path: string;
  content?: string;
  new_path?: string;
}

export interface AckMessage {
  type: 'ack';
  request_id: string;
  success: boolean;
  error?: string;
}

// File system types
export interface FileMetadata {
  path: string;
  version: string;
  lastModified: number;
  size: number;
  isBinary: boolean;
}

export interface ProjectState {
  projectId: string;
  lastSync: number;
  localVersion: Record<string, string>;
  remoteVersion: Record<string, string>;
  pendingSync: PendingSyncTask[];
}

export interface PendingSyncTask {
  operation: 'create' | 'update' | 'delete' | 'rename';
  path: string;
  new_path?: string;
  content?: string;
  attempts: number;
  lastAttempt: number;
  error?: string;
}

// Overleaf API types
export interface OverleafDocument {
  _id: string;
  name: string;
  folder: string | null;
  created: string;
  updated: string;
}

export interface OverleafDocumentContent extends OverleafDocument {
  content: string;
  version: number;
}

export interface OverleafFolder {
  _id: string;
  name: string;
  parentFolderId: string | null;
}
```

**Step 2: Commit types**

Run:
```bash
git add packages/mirror-server/src/types.ts
git commit -m "feat: define shared types for mirror system"
```

---

### Task 11: Implement File Extension Filter

**Files:**
- Create: `packages/mirror-server/src/filesystem/filter.ts`
- Test: `packages/mirror-server/src/filesystem/filter.test.ts`

**Step 1: Write failing test for file filter**

Create: `packages/mirror-server/src/filesystem/filter.test.ts`

```typescript
import { shouldSyncFile, SYNCABLE_EXTENSIONS } from './filter';

describe('File Extension Filter', () => {
  it('should allow text files', () => {
    expect(shouldSyncFile('main.tex')).toBe(true);
    expect(shouldSyncFile('references.bib')).toBe(true);
    expect(shouldSyncFile('README.md')).toBe(true);
  });

  it('should allow image files', () => {
    expect(shouldSyncFile('figure1.png')).toBe(true);
    expect(shouldSyncFile('diagram.jpg')).toBe(true);
    expect(shouldSyncFile('plot.pdf')).toBe(true);
  });

  it('should reject archive files', () => {
    expect(shouldSyncFile('data.zip')).toBe(false);
    expect(shouldSyncFile('backup.tar.gz')).toBe(false);
  });

  it('should reject office documents', () => {
    expect(shouldSyncFile('notes.docx')).toBe(false);
    expect(shouldSyncFile('data.xlsx')).toBe(false);
  });

  it('should be case insensitive', () => {
    expect(shouldSyncFile('MAIN.TEX')).toBe(true);
    expect(shouldSyncFile('Figure1.PNG')).toBe(true);
  });

  it('should handle files without extension', () => {
    expect(shouldSyncFile('Makefile')).toBe(false);
    expect(shouldSyncFile('.gitignore')).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/mirror-server && npm test`
Expected: FAIL - "Cannot find module './filter'"

**Step 3: Implement file filter**

Create: `packages/mirror-server/src/filesystem/filter.ts`

```typescript
/**
 * File extension filtering for Overleaf mirror
 * Whitelist approach: only sync files we understand
 */

export const SYNCABLE_EXTENSIONS = new Set([
  // Text files
  '.tex',
  '.bib',
  '.sty',
  '.cls',
  '.def',
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.py',
  '.js',
  '.ts',
  '.java',
  '.sh',
  '.bat',
  '.ps1',
  '.r',
  '.m',
  '.jl',
  // Image files (for Claude Code context)
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.eps',
  '.bmp',
  '.tiff',
  // PDF files (references)
  '.pdf',
]);

/**
 * Check if a file should be synced based on extension
 */
export function shouldSyncFile(filename: string): boolean {
  const ext = filename.toLowerCase();
  // Find the last dot
  const lastDotIndex = ext.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return false; // No extension
  }
  const extension = ext.substring(lastDotIndex);
  return SYNCABLE_EXTENSIONS.has(extension);
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/mirror-server && npm test`
Expected: PASS

**Step 5: Commit file filter implementation**

Run:
```bash
git add packages/mirror-server/src/filesystem/
git commit -m "feat: implement file extension filter"
```

---

### Task 12: Implement State Persistence

**Files:**
- Create: `packages/mirror-server/src/filesystem/state.ts`
- Test: `packages/mirror-server/src/filesystem/state.test.ts`

**Step 1: Write failing test for state management**

Create: `packages/mirror-server/src/filesystem/state.test.ts`

```typescript
import fs from 'fs-extra';
import { tmpdir } from 'os';
import { join } from 'path';
import { StateManager } from './state';

describe('StateManager', () => {
  const testDir = join(tmpdir(), 'overleaf-mirror-test');

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it('should create initial state file', async () => {
    const manager = new StateManager(testDir, 'test-project');
    await manager.initialize();

    const state = await manager.load();
    expect(state.projectId).toBe('test-project');
    expect(state.localVersion).toEqual({});
    expect(state.remoteVersion).toEqual({});
    expect(state.pendingSync).toEqual([]);
  });

  it('should save and load state', async () => {
    const manager = new StateManager(testDir, 'test-project');
    await manager.initialize();

    await manager.updateLocalVersion('main.tex', 'v3');
    await manager.updateRemoteVersion('main.tex', 'v3');

    const state = await manager.load();
    expect(state.localVersion['main.tex']).toBe('v3');
    expect(state.remoteVersion['main.tex']).toBe('v3');
  });

  it('should detect version conflicts', async () => {
    const manager = new StateManager(testDir, 'test-project');
    await manager.initialize();

    await manager.updateLocalVersion('main.tex', 'v3');
    await manager.updateRemoteVersion('main.tex', 'v4');

    const hasConflict = await manager.hasConflict('main.tex');
    expect(hasConflict).toBe(true);
  });

  it('should add pending sync task', async () => {
    const manager = new StateManager(testDir, 'test-project');
    await manager.initialize();

    await manager.addPendingSync({
      operation: 'update',
      path: 'main.tex',
      content: 'new content',
      attempts: 0,
      lastAttempt: Date.now(),
    });

    const state = await manager.load();
    expect(state.pendingSync).toHaveLength(1);
    expect(state.pendingSync[0].path).toBe('main.tex');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/mirror-server && npm test`
Expected: FAIL - "Cannot find module './state'"

**Step 3: Implement state manager**

Create: `packages/mirror-server/src/filesystem/state.ts`

```typescript
import fs from 'fs-extra';
import { join } from 'path';
import type { ProjectState, PendingSyncTask } from '../types';

const STATE_FILENAME = '.overleaf-state.json';

export class StateManager {
  private statePath: string;
  private state: ProjectState | null = null;

  constructor(
    private projectDir: string,
    private projectId: string
  ) {
    this.statePath = join(projectDir, STATE_FILENAME);
  }

  async initialize(): Promise<void> {
    const exists = await fs.pathExists(this.statePath);

    if (!exists) {
      this.state = {
        projectId: this.projectId,
        lastSync: Date.now(),
        localVersion: {},
        remoteVersion: {},
        pendingSync: [],
      };
      await this.save();
    } else {
      await this.load();
    }
  }

  async load(): Promise<ProjectState> {
    if (!this.state) {
      const content = await fs.readFile(this.statePath, 'utf-8');
      this.state = JSON.parse(content);
    }
    return this.state;
  }

  private async save(): Promise<void> {
    if (!this.state) {
      throw new Error('State not initialized');
    }
    await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2));
  }

  async updateLocalVersion(path: string, version: string): Promise<void> {
    const state = await this.load();
    state.localVersion[path] = version;
    await this.save();
  }

  async updateRemoteVersion(path: string, version: string): Promise<void> {
    const state = await this.load();
    state.remoteVersion[path] = version;
    await this.save();
  }

  async getLocalVersion(path: string): Promise<string | undefined> {
    const state = await this.load();
    return state.localVersion[path];
  }

  async getRemoteVersion(path: string): Promise<string | undefined> {
    const state = await this.load();
    return state.remoteVersion[path];
  }

  async hasConflict(path: string): Promise<boolean> {
    const local = await this.getLocalVersion(path);
    const remote = await this.getRemoteVersion(path);
    return local !== undefined && remote !== undefined && local !== remote;
  }

  async addPendingSync(task: PendingSyncTask): Promise<void> {
    const state = await this.load();
    state.pendingSync.push(task);
    await this.save();
  }

  async getPendingSync(): Promise<PendingSyncTask[]> {
    const state = await this.load();
    return state.pendingSync;
  }

  async removePendingSync(index: number): Promise<void> {
    const state = await this.load();
    state.pendingSync.splice(index, 1);
    await this.save();
  }

  async updateLastSync(): Promise<void> {
    const state = await this.load();
    state.lastSync = Date.now();
    await this.save();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/mirror-server && npm test`
Expected: PASS

**Step 5: Commit state manager implementation**

Run:
```bash
git add packages/mirror-server/src/filesystem/state.ts
git commit -m "feat: implement state persistence manager"
```

---

### Task 13: Implement File System Manager

**Files:**
- Create: `packages/mirror-server/src/filesystem/manager.ts`
- Test: `packages/mirror-server/src/filesystem/manager.test.ts`

**Step 1: Write failing test for file manager**

Create: `packages/mirror-server/src/filesystem/manager.test.ts`

```typescript
import fs from 'fs-extra';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileSystemManager } from './manager';

describe('FileSystemManager', () => {
  const testDir = join(tmpdir(), 'overleaf-mirror-fs-test');

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it('should create file with content', async () => {
    const manager = new FileSystemManager(testDir);
    await manager.createFile('main.tex', '\\documentclass{article}');

    const content = await fs.readFile(join(testDir, 'main.tex'), 'utf-8');
    expect(content).toBe('\\documentclass{article}');
  });

  it('should update existing file', async () => {
    const manager = new FileSystemManager(testDir);
    await manager.createFile('main.tex', 'old content');
    await manager.updateFile('main.tex', 'new content');

    const content = await fs.readFile(join(testDir, 'main.tex'), 'utf-8');
    expect(content).toBe('new content');
  });

  it('should delete file', async () => {
    const manager = new FileSystemManager(testDir);
    await manager.createFile('main.tex', 'content');
    await manager.deleteFile('main.tex');

    const exists = await fs.pathExists(join(testDir, 'main.tex'));
    expect(exists).toBe(false);
  });

  it('should rename file', async () => {
    const manager = new FileSystemManager(testDir);
    await manager.createFile('old.tex', 'content');
    await manager.renameFile('old.tex', 'new.tex');

    const oldExists = await fs.pathExists(join(testDir, 'old.tex'));
    const newExists = await fs.pathExists(join(testDir, 'new.tex'));
    expect(oldExists).toBe(false);
    expect(newExists).toBe(true);
  });

  it('should create nested directories', async () => {
    const manager = new FileSystemManager(testDir);
    await manager.createFile('chapters/intro.tex', 'content');

    const exists = await fs.pathExists(join(testDir, 'chapters/intro.tex'));
    expect(exists).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/mirror-server && npm test`
Expected: FAIL - "Cannot find module './manager'"

**Step 3: Implement file system manager**

Create: `packages/mirror-server/src/filesystem/manager.ts`

```typescript
import fs from 'fs-extra';
import { join } from 'path';
import { shouldSyncFile } from './filter';

export class FileSystemManager {
  constructor(private projectDir: string) {}

  async createFile(path: string, content: string): Promise<void> {
    if (!shouldSyncFile(path)) {
      throw new Error(`File type not supported for sync: ${path}`);
    }

    const fullPath = join(this.projectDir, path);
    await fs.ensureFile(fullPath);
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async updateFile(path: string, content: string): Promise<void> {
    const fullPath = join(this.projectDir, path);
    const exists = await fs.pathExists(fullPath);

    if (!exists) {
      throw new Error(`File does not exist: ${path}`);
    }

    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async readFile(path: string): Promise<string> {
    const fullPath = join(this.projectDir, path);
    return await fs.readFile(fullPath, 'utf-8');
  }

  async deleteFile(path: string): Promise<void> {
    const fullPath = join(this.projectDir, path);
    await fs.remove(fullPath);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const oldFullPath = join(this.projectDir, oldPath);
    const newFullPath = join(this.projectDir, newPath);
    await fs.move(oldFullPath, newFullPath);
  }

  async fileExists(path: string): Promise<boolean> {
    const fullPath = join(this.projectDir, path);
    return await fs.pathExists(fullPath);
  }

  getProjectDir(): string {
    return this.projectDir;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/mirror-server && npm test`
Expected: PASS

**Step 5: Commit file system manager**

Run:
```bash
git add packages/mirror-server/src/filesystem/manager.ts
git commit -m "feat: implement file system manager"
```

---

### Task 14: Implement WebSocket Server

**Files:**
- Create: `packages/mirror-server/src/server.ts`
- Create: `packages/mirror-server/src/client-connection.ts`

**Step 1: Create client connection manager**

Create: `packages/mirror-server/src/client-connection.ts`

```typescript
import { WebSocket } from 'ws';
import type { WSMessage, MirrorRequestMessage, SyncCommandMessage } from './types';

export class ClientConnection {
  private messageId = 0;

  constructor(private ws: WebSocket, private projectId: string) {}

  getProjectId(): string {
    return this.projectId;
  }

  sendMirrorRequest(data: MirrorRequestMessage): void {
    this.send({ ...data, type: 'mirror' });
  }

  sendSyncCommand(command: SyncCommandMessage): void {
    this.send(command);
  }

  sendAck(requestId: string, success: boolean, error?: string): void {
    this.send({
      type: 'ack',
      request_id: requestId,
      success,
      error,
    });
  }

  private send(message: WSMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  onMessage(callback: (message: WSMessage) => void): void {
    this.ws.on('message', (data: string) => {
      try {
        const message = JSON.parse(data) as WSMessage;
        callback(message);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    });
  }

  onClose(callback: () => void): void {
    this.ws.on('close', callback);
  }

  close(): void {
    this.ws.close();
  }
}
```

**Step 2: Create WebSocket server**

Create: `packages/mirror-server/src/server.ts`

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { ClientConnection } from './client-connection';
import type { WSMessage } from './types';

const PORT = 3456;

export class MirrorServer {
  private wss: WebSocketServer;
  private connections: Map<WebSocket, ClientConnection> = new Map();

  constructor(httpServer?: HttpServer) {
    this.wss = new WebSocketServer({
      port: httpServer ? undefined : PORT,
      server: httpServer,
    });

    this.setupServer();
  }

  private setupServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New client connected');

      const connection = new ClientConnection(ws, '');

      this.connections.set(ws, connection);

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

      ws.on('close', () => {
        console.log('Client disconnected');
        this.connections.delete(ws);
      });

      connection.onMessage((message: WSMessage) => {
        this.handleMessage(connection, message);
      });
    });

    console.log(`Mirror server listening on port ${PORT}`);
  }

  private handleMessage(connection: ClientConnection, message: WSMessage): void {
    switch (message.type) {
      case 'mirror':
        console.log('Received mirror request:', message.api_endpoint);
        // Will be implemented in later tasks
        break;
      case 'sync':
        console.log('Received sync command:', message.operation);
        // Will be implemented in later tasks
        break;
      default:
        console.warn('Unknown message type:', message);
    }
  }

  broadcast(message: WSMessage): void {
    this.connections.forEach((connection) => {
      // Handle broadcasting if needed
    });
  }

  close(): void {
    this.wss.close();
  }
}
```

**Step 3: Commit WebSocket server**

Run:
```bash
git add packages/mirror-server/src/server.ts packages/mirror-server/src/client-connection.ts
git commit -m "feat: implement WebSocket server infrastructure"
```

---

### Task 15: Create CLI Entry Point

**Files:**
- Create: `packages/mirror-server/src/cli.ts`

**Step 1: Create CLI interface**

Create: `packages/mirror-server/src/cli.ts`

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { MirrorServer } from './server';

const program = new Command();

program
  .name('overleaf-mirror-server')
  .description('Overleaf Mirror Server - Local file sync service')
  .version('1.0.0');

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
```

**Step 2: Make CLI executable**

Run:
```bash
chmod +x packages/mirror-server/src/cli.ts
```

**Step 3: Commit CLI**

Run:
```bash
git add packages/mirror-server/src/cli.ts
git commit -m "feat: add CLI entry point"
```

---

### Task 16: Build and Test Mirror Server

**Files:**
- Modify: `packages/mirror-server/package.json`

**Step 1: Add build script**

Modify: `packages/mirror-server/package.json`

Add to scripts:
```json
"scripts": {
  "prebuild": "rimraf dist",
  "build": "tsc",
  "prepublishOnly": "npm run build"
}
```

**Step 2: Build the project**

Run:
```bash
cd packages/mirror-server
npm run build
```

Expected: Compilation succeeds, `dist/` directory created

**Step 3: Test server starts**

Run:
```bash
node dist/cli.js start --help
```

Expected: Help text displayed

**Step 4: Commit build configuration**

Run:
```bash
git add packages/mirror-server/package.json
git commit -m "feat: configure build process"
```

---

## Phase 4: Browser Extension - API Interceptor

### Task 17: Setup Extension Manifest

**Files:**
- Create: `packages/extension/manifest.json`

**Step 1: Create manifest v3**

Create: `packages/extension/manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Overleaf Mirror",
  "version": "2.0.0",
  "description": "Bidirectional file sync for Claude Code",
  "permissions": ["cookies", "storage"],
  "host_permissions": [
    "https://*.overleaf.com/*",
    "ws://localhost:3456/*"
  ],
  "content_scripts": [
    {
      "matches": ["https://*.overleaf.com/project/*"],
      "js": ["content.js"],
      "run_at": "document_end"
    }
  ],
  "background": {
    "service_worker": "background.js"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

**Step 2: Copy existing icons**

Run:
```bash
cp -r icons packages/extension/
```

**Step 3: Commit manifest**

Run:
```bash
git add packages/extension/manifest.json packages/extension/icons
git commit -m "feat: setup extension manifest"
```

---

### Task 18: Create Shared Types for Extension

**Files:**
- Create: `packages/extension/src/shared/types.ts`

**Step 1: Define extension types**

Create: `packages/extension/src/shared/types.ts`

```typescript
/**
 * Shared types for browser extension
 * (Mirrors server types for Type safety)
 */

export type WSMessage =
  | MirrorRequestMessage
  | SyncCommandMessage
  | AckMessage;

export interface MirrorRequestMessage {
  type: 'mirror';
  project_id: string;
  api_endpoint: string;
  method: string;
  data: unknown;
}

export interface SyncCommandMessage {
  type: 'sync';
  project_id: string;
  operation: 'create' | 'update' | 'delete' | 'rename';
  path: string;
  content?: string;
  new_path?: string;
}

export interface AckMessage {
  type: 'ack';
  request_id: string;
  success: boolean;
  error?: string;
}

export interface APIRequest {
  url: string;
  method: string;
  body?: any;
  headers?: Record<string, string>;
}
```

**Step 2: Commit types**

Run:
```bash
git add packages/extension/src/shared/types.ts
git commit -m "feat: define extension types"
```

---

### Task 19: Implement WebSocket Client

**Files:**
- Create: `packages/extension/src/client.ts`

**Step 1: Create WebSocket client**

Create: `packages/extension/src/client.ts`

```typescript
import type { WSMessage } from './shared/types';

export class MirrorClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private messageHandlers: ((message: WSMessage) => void)[] = [];

  constructor(private serverUrl: string = 'ws://localhost:3456') {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          console.log('[MirrorClient] Connected to server');
          this.clearReconnectTimer();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as WSMessage;
            this.notifyHandlers(message);
          } catch (error) {
            console.error('[MirrorClient] Failed to parse message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[MirrorClient] WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[MirrorClient] Disconnected from server');
          this.scheduleReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      console.log('[MirrorClient] Attempting to reconnect...');
      this.connect().catch((error) => {
        console.error('[MirrorClient] Reconnect failed:', error);
      });
    }, 3000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  send(message: WSMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('[MirrorClient] Cannot send message: not connected');
    }
  }

  onMessage(handler: (message: WSMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  private notifyHandlers(message: WSMessage): void {
    this.messageHandlers.forEach((handler) => {
      try {
        handler(message);
      } catch (error) {
        console.error('[MirrorClient] Handler error:', error);
      }
    });
  }

  disconnect(): void {
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
```

**Step 2: Commit WebSocket client**

Run:
```bash
git add packages/extension/src/client.ts
git commit -m "feat: implement WebSocket client"
```

---

### Task 20: Implement API Interceptor

**Files:**
- Create: `packages/extension/src/content/interceptor.ts`

**Step 1: Create fetch interceptor**

Create: `packages/extension/src/content/interceptor.ts`

```typescript
import type { APIRequest } from '../shared/types';

const API_BASE_URL = 'https://www.overleaf.com';

interface InterceptorConfig {
  client: {
    send: (message: any) => void;
  };
  projectId: string;
}

export function setupAPIInterceptor(config: InterceptorConfig): void {
  const { client, projectId } = config;

  // Intercept fetch API
  const originalFetch = window.fetch;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    // Check if this is an Overleaf API request we want to mirror
    if (shouldMirrorRequest(url, init?.method)) {
      const request = await buildAPIRequest(url, init);

      // Mirror to local backend (async, don't block original request)
      mirrorToBackend(client, projectId, request).catch((error) => {
        console.error('[Interceptor] Failed to mirror request:', error);
      });
    }

    // Execute original request
    return originalFetch(input, init);
  };

  console.log('[Interceptor] API interception enabled');
}

function shouldMirrorRequest(url: string, method?: string): boolean {
  // Only mirror Overleaf API requests
  if (!url.startsWith(API_BASE_URL)) return false;

  // Only mirror file-related endpoints
  const mirrorablePaths = [
    '/api/project/',
    '/project/',
  ];

  return mirrorablePaths.some((path) => url.includes(path));
}

async function buildAPIRequest(url: string, init?: RequestInit): Promise<APIRequest> {
  const method = init?.method || 'GET';

  let body: any;
  if (init?.body) {
    try {
      body = JSON.parse(init.body as string);
    } catch {
      body = init.body;
    }
  }

  return {
    url,
    method,
    body,
    headers: init?.headers as Record<string, string>,
  };
}

async function mirrorToBackend(
  client: { send: (message: any) => void },
  projectId: string,
  request: APIRequest
): Promise<void> {
  // Extract API endpoint path
  const url = new URL(request.url);
  const apiEndpoint = url.pathname + url.search;

  client.send({
    type: 'mirror',
    project_id: projectId,
    api_endpoint: apiEndpoint,
    method: request.method,
    data: request.body,
  });
}
```

**Step 2: Commit API interceptor**

Run:
```bash
git add packages/extension/src/content/interceptor.ts
git commit -m "feat: implement fetch API interceptor"
```

---

### Task 21: Create Content Script Entry Point

**Files:**
- Create: `packages/extension/src/content/injector.ts`

**Step 1: Create content script**

Create: `packages/extension/src/content/injector.ts`

```typescript
import { MirrorClient } from '../client';
import { setupAPIInterceptor } from './interceptor';

let mirrorClient: MirrorClient | null = null;

async function initializeMirror(): Promise<void> {
  try {
    // Extract project ID from URL
    const projectId = extractProjectId();
    if (!projectId) {
      console.log('[Mirror] Not a project page, skipping initialization');
      return;
    }

    console.log('[Mirror] Initializing for project:', projectId);

    // Connect to local server
    mirrorClient = new MirrorClient();
    await mirrorClient.connect();

    // Setup API interception
    setupAPIInterceptor({
      client: mirrorClient,
      projectId,
    });

    console.log('[Mirror] Initialization complete');
  } catch (error) {
    console.error('[Mirror] Initialization failed:', error);
  }
}

function extractProjectId(): string | null {
  const urlMatch = window.location.pathname.match(/\/project\/([^/]+)/);
  return urlMatch ? urlMatch[1] : null;
}

// Auto-initialize when content script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeMirror);
} else {
  initializeMirror();
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (mirrorClient) {
    mirrorClient.disconnect();
  }
});
```

**Step 2: Configure Vite build**

Create: `packages/extension/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content/injector.ts'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'iife',
      },
    },
  },
});
```

**Step 3: Commit content script**

Run:
```bash
git add packages/extension/src/content/injector.ts packages/extension/vite.config.ts
git commit -m "feat: create content script entry point"
```

---

### Task 22: Build and Load Extension

**Files:**
- Create: `packages/extension/src/background/index.ts`

**Step 1: Create minimal background script**

Create: `packages/extension/src/background/index.ts`

```typescript
// Background service worker for Overleaf Mirror extension
console.log('[Background] Overleaf Mirror extension loaded');
```

**Step 2: Build extension**

Run:
```bash
cd packages/extension
npm run build
```

Expected: `dist/` directory created with `content.js` and `background.js`

**Step 3: Update manifest to use built files**

Modify: `packages/extension/manifest.json`

```json
{
  "content_scripts": [
    {
      "matches": ["https://*.overleaf.com/project/*"],
      "js": ["dist/content.js"],
      "run_at": "document_end"
    }
  ],
  "background": {
    "service_worker": "dist/background.js"
  }
}
```

**Step 4: Commit background script and build config**

Run:
```bash
git add packages/extension/src/background/index.ts packages/extension/manifest.json
git commit -m "feat: add background script and build configuration"
```

---

## Phase 5: Integration Testing

### Task 23: Create Integration Test Setup

**Files:**
- Create: `packages/mirror-server/tests/integration/test-server.ts`
- Create: `packages/mirror-server/tests/integration/e2e-sync.test.ts`

**Step 1: Create test helper**

Create: `packages/mirror-server/tests/integration/test-server.ts`

```typescript
import { MirrorServer } from '../../src/server';
import { WebSocket } from 'ws';

export class TestServer {
  private server: MirrorServer;

  constructor() {
    this.server = new MirrorServer();
  }

  async connect(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://localhost:3456');

      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  async close(): Promise<void> {
    this.server.close();
  }
}
```

**Step 2: Create E2E test**

Create: `packages/mirror-server/tests/integration/e2e-sync.test.ts`

```typescript
import { TestServer } from './test-server';
import type { MirrorRequestMessage } from '../../src/types';

describe('E2E: Mirror Communication', () => {
  let testServer: TestServer;
  let ws: WebSocket;

  beforeAll(async () => {
    testServer = new TestServer();
    ws = await testServer.connect();
  });

  afterAll(async () => {
    ws.close();
    await testServer.close();
  });

  it('should receive mirror request from client', (done) => {
    const message: MirrorRequestMessage = {
      type: 'mirror',
      project_id: 'test-project',
      api_endpoint: '/project/test/doc',
      method: 'POST',
      data: { content: 'test content' },
    };

    ws.send(JSON.stringify(message));

    // Verify server received the message
    setTimeout(() => {
      done();
    }, 100);
  });
});
```

**Step 3: Commit integration tests**

Run:
```bash
git add packages/mirror-server/tests/integration/
git commit -m "test: add integration test setup"
```

---

### Task 24: Create Manual Testing Guide

**Files:**
- Create: `docs/testing-guide.md`

**Step 1: Create testing guide**

Create: `docs/testing-guide.md`

```markdown
# Manual Testing Guide

## Prerequisites

1. Node.js 18+ installed
2. Chrome or Chromium browser
3. Overleaf account and active project

## Setup

### 1. Build Mirror Server

```bash
cd packages/mirror-server
npm install
npm run build
npm link
```

### 2. Build Extension

```bash
cd packages/extension
npm install
npm run build
```

### 3. Load Extension in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `packages/extension/dist`

## Test Scenarios

### Test 1: Server Startup

**Steps:**
1. Run: `overleaf-mirror-server start`
2. Expected: Server starts on port 3456
3. Check logs for "Mirror server listening on port 3456"

### Test 2: Extension Connection

**Steps:**
1. Open any Overleaf project
2. Open browser DevTools → Console
3. Expected: "[Mirror] Initializing for project: <project-id>"
4. Expected: "[MirrorClient] Connected to server"

### Test 3: API Interception

**Steps:**
1. In Overleaf editor, make any change to a file
2. Check DevTools Console
3. Expected: "[Interceptor] API interception enabled"
4. Check server logs
5. Expected: "Received mirror request: /project/<id>/doc"

### Test 4: File Mirror

**Steps:**
1. Create new file in Overleaf
2. Check server logs for mirror request
3. Check `~/overleaf-mirror/<project-id>/` directory
4. Expected: File created locally with same content

### Test 5: Connection Recovery

**Steps:**
1. Start server
2. Open Overleaf project (extension connects)
3. Stop server
4. Expected: "[MirrorClient] Disconnected from server"
5. Restart server
6. Expected: "[MirrorClient] Attempting to reconnect..."
7. Expected: Extension reconnects automatically
```

**Step 2: Commit testing guide**

Run:
```bash
git add docs/testing-guide.md
git commit -m "docs: add manual testing guide"
```

---

## Phase 6: Documentation and Final Polish

### Task 25: Update README

**Files:**
- Modify: `README.md`

**Step 1: Update main README**

Modify: `README.md`

```markdown
# Overleaf Mirror

Bidirectional file synchronization between Overleaf and local file system for Claude Code.

## Overview

Overleaf Mirror intercepts API calls from the Overleaf web interface and maintains a local mirror of your project files. This allows Claude Code to access and modify your Overleaf projects with real-time synchronization.

## Architecture

```
Overleaf Browser → Extension (API Interceptor)
                           ↓
                    WebSocket (ws://localhost:3456)
                           ↓
                  Local Mirror Server
                           ↓
                  File System (~/overleaf-mirror/)
                           ↓
                      Claude Code
```

## Quick Start

### Installation

\`\`\`bash
# Clone repository
git clone https://github.com/yourusername/overleaf-cc.git
cd overleaf-cc

# Install dependencies
pnpm install

# Build all packages
pnpm build
\`\`\`

### Running the Mirror Server

\`\`\`bash
cd packages/mirror-server
npm start
\`\`\`

Server will start on port 3456.

### Loading the Browser Extension

1. Build the extension:
   \`\`\`bash
   cd packages/extension
   npm run build
   \`\`\`

2. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select `packages/extension/`

### Using with Claude Code

1. Open any Overleaf project
2. Extension will automatically connect to local server
3. Files will be mirrored to `~/overleaf-mirror/<project-id>/`
4. Point Claude Code to this directory
5. Changes made by Claude Code will sync back to Overleaf

## Documentation

- [Design Document](docs/plans/2026-03-06-overleaf-mirror-design.md)
- [Implementation Plan](docs/plans/2026-03-06-overleaf-mirror-implementation.md)
- [API Reference](docs/overleaf-api-reference.md)
- [Testing Guide](docs/testing-guide.md)

## License

MIT
```

**Step 2: Commit README**

Run:
```bash
git add README.md
git commit -m "docs: update README for mirror architecture"
```

---

### Task 26: Create Contributing Guide

**Files:**
- Create: `CONTRIBUTING.md`

**Step 1: Create contributing guide**

Create: `CONTRIBUTING.md`

```markdown
# Contributing to Overleaf Mirror

## Development Setup

\`\`\`bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Build all packages
pnpm build

# Development mode (watch)
pnpm dev:server   # Watch mirror-server
pnpm dev:extension  # Watch extension
\`\`\`

## Project Structure

\`\`\`
packages/
├── mirror-server/    # Local backend service
│   └── src/
│       ├── server.ts          # WebSocket server
│       ├── filesystem/        # File system operations
│       └── types.ts           # Shared types
│
└── extension/        # Browser extension
    └── src/
        ├── content/           # Content scripts
        │   └── interceptor.ts # API interception
        └── client.ts          # WebSocket client
\`\`\`

## Code Style

- Use TypeScript for all new code
- Follow existing code style
- Write tests for new features
- Commit messages should follow conventional commits

## Testing

\`\`\`bash
# Run all tests
pnpm test

# Run tests for specific package
cd packages/mirror-server
npm test

# Run integration tests
npm run test:integration
\`\`\`

## Pull Requests

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request
```

**Step 2: Commit contributing guide**

Run:
```bash
git add CONTRIBUTING.md
git commit -m "docs: add contributing guide"
```

---

### Task 27: Final Review and Release Preparation

**Step 1: Run full test suite**

Run:
```bash
pnpm test
```

Expected: All tests pass

**Step 2: Build all packages**

Run:
```bash
pnpm build
```

Expected: All packages build successfully

**Step 3: Check git status**

Run:
```bash
git status
```

Expected: Clean working directory

**Step 4: Create release commit**

Run:
```bash
git add -A
git commit -m "chore: complete initial implementation of Overleaf Mirror

Features:
- API interception from Overleaf
- Local file mirroring
- WebSocket communication
- Extension and server infrastructure

See docs/plans/2026-03-06-overleaf-mirror-implementation.md for details.
"
```

**Step 5: Create git tag**

Run:
```bash
git tag -a v2.0.0 -m "Release v2.0.0 - Overleaf Mirror Initial Release"
```

---

## Implementation Complete

This plan provides the foundation for the Overleaf Mirror system. The following phases can be added in future iterations:

- **Phase 7: File Watcher and Local → Overleaf Sync**
- **Phase 8: Conflict Resolution**
- **Phase 9: Incremental Sync Optimization**
- **Phase 10: Performance Enhancements**

Each phase should follow the same pattern:
1. Write tests
2. Implement feature
3. Test manually
4. Document
5. Commit
