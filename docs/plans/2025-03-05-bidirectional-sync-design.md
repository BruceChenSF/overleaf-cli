# Overleaf CC - Design Document

## 1. Overview

Overleaf CC is a Chrome extension that integrates Claude Code CLI with Overleaf, providing bidirectional file synchronization and dual terminal support. The project aims to bridge the gap between Overleaf's web-based editor and Claude Code's powerful AI-assisted development environment.

### 1.1 Goals

- Enable seamless file synchronization between Overleaf and local Claude Code environment
- Provide flexible terminal options (local vs. in-page)
- Support collaborative workflows with conflict detection
- Maintain native Overleaf UI/UX experience

### 1.2 Non-Goals

- Replacing Overleaf's core functionality
- Implementing a full IDE in the browser
- Direct Overleaf API integration (using DOM manipulation instead)

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Overleaf Web Page                       │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │ Claude Icon  │ ────▶  │ Dropdown Menu │                 │
│  │   Button     │         │     UI        │                 │
│  └──────────────┘         └──────────────┘                 │
│         │                        │                          │
│         ▼                        ▼                          │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │ Sidebar      │         │ Content      │                 │
│  │ Switcher     │         │ Script       │                 │
│  │ + Terminal   │         │              │                 │
│  └──────────────┘         └──────────────┘                 │
│         │                        │                          │
│         ▼                 ┌──────┴──────┐                   │
│  ┌──────────────┐         │             │                   │
│  │ Terminal     │         │  File Sync  │                   │
│  │ Sidebar      │         │  (Event +   │                   │
│  │ (xterm.js)   │         │   Polling)  │                   │
│  └──────────────┘         └──────────────┘                 │
└─────────────────────────────────────────────────────────────┘
                          │
                    Chrome Extension API
                          │
┌─────────────────────────────────────────────────────────────┐
│                 Chrome Extension Background                  │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │ Background   │◀────────┤ Terminal UI  │                 │
│  │ Service      │─────────▶│ (xterm.js)   │                 │
│  │ Worker       │         │              │                 │
│  └──────────────┘         └──────────────┘                 │
└─────────────────────────────────────────────────────────────┘
                          │
                    WebSocket Connection
                          │
┌─────────────────────────────────────────────────────────────┐
│                   Bridge CLI (Local)                         │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │ File Watcher │         │ Claude Code  │                 │
│  │ (Local       │         │ Execution    │                 │
│  │  Changes)    │         │ Environment  │                 │
│  └──────────────┘         └──────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Components

#### 2.2.1 Claude Icon Button (`injector.ts`)
- **Location**: Overleaf toolbar menu bar
- **Appearance**: Claude icon from @lobehub/icons
- **Action**: Opens dropdown menu on click
- **Implementation**: Injected into DOM on page load

#### 2.2.2 Dropdown Menu UI
- **Connection Status**:
  - Simple view: "Connected" / "Not connected" + error message
  - Detailed view: Bridge status, WebSocket status, project ID, local directory
- **Sync Mode Toggle**: Auto sync / Manual sync
- **Manual Sync Button**: Only visible in manual mode
- **Sync Status Indicator**: Color-coded (green/yellow/red/blue)
- **Terminal Options**:
  - "Open Local Terminal" button (with instruction)
  - "Open In-Page Terminal" button
- **Help Text**: "Closing page doesn't clear conversation. Run `claude -r` in any terminal to restore"

#### 2.2.3 Content Script (`file-reader.ts` + sync logic)
- **File Reading**: Extract content from Overleaf DOM (multi-method fallback)
- **File Writing**: Update Overleaf editor content via DOM APIs
- **Change Detection**:
  - Event listeners for user edits in Overleaf
  - Polling (3-5 seconds) for local changes
  - Immediate sync on Claude Code task completion
- **Conflict Detection**: Compare checksums/timestamps

#### 2.2.4 Terminal Sidebar (NEW)
- **Location**: Overleaf left sidebar (shared with file tree)
- **UI Elements**:
  - Sidebar switcher button (injected)
  - xterm.js terminal container
- **Behavior**:
  - Click switcher button → Show terminal, hide other sidebars
  - Integrates with Overleaf's sidebar switching logic
  - Resizable (inherited from Overleaf sidebar behavior)

#### 2.2.5 Background Service Worker (`service-worker.ts`)
- **WebSocket Management**: Connect to bridge CLI
- **Message Passing**: Route messages between content scripts and bridge
- **Terminal Window Management**: Open/close terminal windows

#### 2.2.6 Bridge CLI (Separate Package)
- **Local File Operations**: Read/write files in project directory
- **Claude Code Integration**: Spawn and manage Claude Code process
- **Change Detection**: Watch local files for modifications
- **Task Detection**: Identify when Claude Code completes tasks
- **WebSocket Server**: Communicate with Chrome extension

## 3. Data Flow

### 3.1 File Synchronization Flow

#### Overleaf → Local (Immediate)
```
User edits in Overleaf
  ↓
Event listener fires (change/input)
  ↓
Content script extracts new content
  ↓
Send via WebSocket to bridge
  ↓
Bridge writes to local file
  ↓
Claude Code sees updated file
```

#### Local → Overleaf (Hybrid)
```
Claude Code modifies file
  ↓
Option A: Polling detects change (3-5s)
Option B: Bridge detects task completion → immediate sync
Option C: User clicks manual sync button
  ↓
Content script updates Overleaf editor via DOM
  ↓
Editor updates (triggers Overleaf's autosave)
```

### 3.2 Message Flow

```
┌──────────────┐
│  Overleaf    │
│    Page      │──┐
└──────────────┘  │
                  │ chrome.runtime.sendMessage()
                  ▼
         ┌────────────────┐
         │   Background   │
         │ Service Worker │
         └────────────────┘
                  │ chrome.tabs.sendMessage()
                  ▼
         ┌────────────────┐
         │ Content Script │
         │  (file-reader) │
         └────────────────┘
                  │ DOM manipulation
                  ▼
         ┌────────────────┐
         │  Overleaf      │
         │  Editor DOM    │
         └────────────────┘
```

### 3.3 WebSocket Communication

#### Extension → Bridge
```javascript
{
  type: 'GET_FILE_CONTENT',
  path: '/main.tex'
}
→ Response: { content: '...', path: '/main.tex' }

{
  type: 'SET_FILE_CONTENT',
  payload: { path: '/main.tex', content: '...' }
}
→ Response: { success: true }

{
  type: 'GET_ALL_FILES'
}
→ Response: { files: [...] }

{
  type: 'SYNC_STATUS'
}
→ Response: { status: 'synced', pendingChanges: 0 }
```

#### Bridge → Extension
```javascript
{
  type: 'FILE_CHANGED',
  payload: { path: '/main.tex', checksum: 'abc123' }
}

{
  type: 'TASK_COMPLETE',
  payload: { taskId: 'xxx', modifiedFiles: ['/main.tex'] }
}

{
  type: 'CONFLICT_DETECTED',
  payload: {
    path: '/main.tex',
    localHash: 'abc123',
    remoteHash: 'def456'
  }
}
```

## 4. Synchronization Modes

### 4.1 Auto Sync Mode (Default)

**Behavior**:
- Changes immediately sync in both directions
- No user intervention required
- Best for: Solo projects, trusted Claude suggestions

**User Experience**:
- Green status indicator when synced
- Yellow when changes pending
- Blue when actively syncing
- Red on error or conflict

**Settings Persistence**:
```javascript
chrome.storage.local.set({
  syncMode: 'auto' // or 'manual'
});
```

### 4.2 Manual Sync Mode

**Behavior**:
- Local → Overleaf: Only sync when user clicks button
- Overleaf → Local: Still immediate (user edits should always sync)
- Best for: Collaborative projects, code review workflows

**User Experience**:
- "Sync to Overleaf" button appears in dropdown
- Badge shows count of pending changes
- Yellow status: "3 pending changes"

### 4.3 Sync State Machine

```
┌──────────┐
│  Synced  │ (Green)
└─────┬────┘
      │
      ├─→ Local change detected
      │       ↓
      │   ┌──────────┐
      │   │ Pending  │ (Yellow)
      │   └─────┬────┘
      │         │
      │         ├─→ Auto: Start sync
      │         │       ↓
      │         │   ┌──────────┐
      │         │   │ Syncing  │ (Blue)
      │         │   └─────┬────┘
      │         │         │
      │         └─→ Success: Return to Synced
      │              Failure: Go to Error
      │
      └─→ Conflict detected
              ↓
          ┌──────────┐
          │ Conflict │ (Red)
          └──────────┘
```

## 5. Conflict Detection

### 5.1 Detection Method

Compare file checksums (SHA-256) between:
- Overleaf editor content (DOM)
- Local file (bridge)

### 5.2 Conflict Scenarios

| Scenario | Detection | User Action |
|----------|-----------|-------------|
| User edits in Overleaf while Claude modifies locally | Checksum mismatch | Show conflict warning |
| Collaborator edits file remotely | Checksum mismatch + no local change | Show warning |
| Same file modified in both locations | Checksum mismatch | Show conflict (future: resolution UI) |

### 5.3 UI Indicators

**Dropdown Menu**:
```html
<div class="conflict-warning" style="color: #f14c4c;">
  ⚠️ Conflict detected in main.tex
  <button>Resolve</button>
</div>
```

**Status Badge**:
```css
.status-conflict {
  background: #f14c4c; /* VSCode red */
  color: white;
}
```

### 5.4 Future: Conflict Resolution

(Deferred to Claude Code skill phase)
- Three-way merge
- Claude-assisted resolution
- Interactive diff viewer

## 6. UI/UX Design

### 6.1 Claude Icon Button

**Specification**:
- Icon: `https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude-color.svg`
- Size: 16x16 pixels
- Placement: After "Help" button in toolbar
- Tooltip: "Claude Code - Click for options"

### 6.2 Dropdown Menu Layout

```
┌─────────────────────────────────────┐
│ Connection Status                    │
│ ● Connected to bridge               │
│                                     │
│ Sync Mode: [Auto ▼]                 │
│ Status: ● Synced 2s ago             │
│                                     │
│ [Sync to Overleaf] (manual only)    │
│                                     │
│ ──────────────────────────────────  │
│                                     │
│ Terminal Options                    │
│ [🖥️ Open Local Terminal]            │
│   → Run: overleaf-cc-bridge         │
│                                     │
│ [💻 Open In-Page Terminal]          │
│                                     │
│ ──────────────────────────────────  │
│                                     │
│ 💡 Tip: Closing page doesn't clear │
│    conversation. Run `claude -r`    │
│    to restore.                      │
│                                     │
│ [▼ Details]                         │
└─────────────────────────────────────┘
```

### 6.3 Status Color Scheme

Based on VSCode Git indicator colors:

| State | Color | Hex | Usage |
|-------|-------|-----|-------|
| Synced | Green | `#73c991` | No pending changes |
| Pending | Yellow | `#ffc107` | Awaiting sync (manual mode) |
| Syncing | Blue | `#3794ff` | In progress |
| Error | Red | `#f14c4c` | Failed, disconnected, or conflict |
| Unknown | Gray | `#858585` | Initial state |

### 6.4 Terminal Sidebar

**Layout**:
```
┌─────────────────────────────────────┐
│ [Files] [Search] [Terminal]         │ ← Switcher
├─────────────────────────────────────┤
│ xterm.js terminal output             │
│                                     │
│ $ claude                             │
│ > What would you like me to do?     │
│                                     │
│                                     │
└─────────────────────────────────────┘
```

**Integration**:
- Inject button into existing sidebar switcher
- Click hides other sidebar content, shows terminal
- Click other buttons hides terminal, shows their content
- Terminal persists state (visible/hidden) during session

## 7. Technical Implementation Details

### 7.1 File Reading Strategy

**Priority Order** (already implemented in `file-reader.ts`):
1. `window.ee._.document.entities` (Modern Overleaf)
2. `window.__initData.project.rootFolder.fileRefs` (Older Overleaf)
3. `window.clientVars.document.currentDoc` (ShareJS)
4. DOM parsing (`[data-file-id]`)
5. URL parsing (current document from URL)

### 7.2 File Writing Strategy

**Priority Order** (already implemented):
1. `window.editor.setDocValue()`
2. `window.editor.setValue()`
3. ACE Editor API
4. Fallback: textarea / contenteditable

### 7.3 Change Detection

**Overleaf Changes**:
```javascript
// Event listeners on editor
editor.on('change', () => {
  const newContent = getCurrentDocumentContent();
  const checksum = hashContent(newContent);
  if (checksum !== lastKnownChecksum) {
    notifyBridge({ type: 'FILE_CHANGED', path, content: newContent });
    lastKnownChecksum = checksum;
  }
});
```

**Local Changes**:
```javascript
// Polling every 3-5 seconds
setInterval(async () => {
  const response = await bridge.sendMessage({ type: 'GET_FILE_STATUS' });
  if (response.checksum !== localChecksum) {
    // File changed locally, sync to Overleaf
    await syncFromLocal();
  }
}, 3000);
```

**Immediate Sync on Task Complete**:
```javascript
// Bridge detects Claude Code task completion
bridge.on('taskComplete', async (task) => {
  const modifiedFiles = task.getModifiedFiles();
  for (const file of modifiedFiles) {
    await extension.syncFile(file);
  }
});
```

### 7.4 State Management

**Chrome Storage**:
```javascript
// User preferences
{
  syncMode: 'auto' | 'manual',
  terminalMode: 'local' | 'in-page',
  sidebarVisible: boolean
}

// Runtime state (in-memory)
{
  connectionStatus: 'connected' | 'disconnected' | 'error',
  syncStatus: 'synced' | 'pending' | 'syncing' | 'conflict',
  pendingChanges: number,
  lastSyncTime: timestamp
}
```

### 7.5 Error Handling

**Connection Errors**:
```javascript
if (!bridgeConnection) {
  showStatus('Bridge not running. Start with: overleaf-cc-bridge', 'error');
}
```

**Sync Errors**:
```javascript
try {
  await syncToOverleaf(content);
} catch (error) {
  showStatus(`Sync failed: ${error.message}`, 'error');
  // In auto mode, retry after backoff
  // In manual mode, show retry button
}
```

**Conflict Errors**:
```javascript
if (localChecksum !== remoteChecksum) {
  showConflictWarning(path);
  setSyncStatus('conflict');
  // Disable auto-sync until resolved
}
```

## 8. Security Considerations

### 8.1 Local File Access

- Bridge CLI runs locally with user's permissions
- No cloud file storage
- Files never leave user's machine except via Overleaf

### 8.2 WebSocket Security

- WebSocket binds to `localhost` only
- No external network access required
- Optional: Add authentication token for local connection

### 8.3 Content Script Isolation

- Content script isolated from page JavaScript
- Only accesses DOM, not page variables
- No sensitive data exposure to Overleaf page

## 9. Performance Considerations

### 9.1 Polling Optimization

- Adaptive polling interval:
  - Active editing: 3 seconds
  - Idle: 10 seconds
  - Suspended tab: Stop polling

### 9.2 Debouncing

- File change events debounced by 500ms
- Prevents excessive sync during rapid edits

### 9.3 Memory Management

- xterm.js terminal buffer limited (1000 lines)
- File contents cached only for active document
- Disconnect WebSocket when tab inactive

## 10. Testing Strategy

### 10.1 Unit Tests

- File reading/writing functions
- Checksum calculation
- State management logic
- Message parsing

### 10.2 Integration Tests

- WebSocket communication
- Content script → background → bridge flow
- File sync end-to-end

### 10.3 Manual Testing

- Test on various Overleaf projects
- Different file types (.tex, .bib, images)
- Collaborative editing scenarios
- Conflict detection

## 11. Roadmap

### Phase 1: Current Implementation
- ✅ Basic file reading from Overleaf DOM
- ✅ Claude icon button
- ✅ Terminal window (popup)
- ✅ WebSocket connection to bridge

### Phase 2: Core Sync Features (In Progress)
- [ ] Bidirectional file synchronization
- [ ] Dropdown menu UI
- [ ] Sync mode toggle (auto/manual)
- [ ] Manual sync button
- [ ] Status indicators with color coding
- [ ] Conflict detection (UI only)

### Phase 3: Enhanced UX
- [ ] In-page terminal sidebar
- [ ] Sidebar switcher integration
- [ ] Connection status details view
- [ ] Improved error messages
- [ ] Settings persistence

### Phase 4: Advanced Features
- [ ] Conflict resolution UI
- [ ] File history/diff viewer
- [ ] Multi-file sync batching
- [ ] Keyboard shortcuts

### Phase 5: Claude Code Skill Integration (Future)
- [ ] Refactor bridge as Claude Code skill
- [ ] Direct skill-to-extension communication
- [ ] Claude-assisted conflict resolution
- [ ] Advanced workflow automation

## 12. Future Enhancements

### 12.1 Potential Features

- **Selective Sync**: Choose which files to sync
- **Sync Profiles**: Different settings for different projects
- **Collaboration Tools**: See collaborator cursors in terminal
- **Git Integration**: Sync via Git instead of direct file copy
- **Cloud Bridge**: Optional remote bridge server

### 12.2 Technical Debt

- Migrate from content script messaging to more robust architecture
- Add comprehensive error logging
- Improve Overleaf version compatibility
- Reduce dependency on DOM parsing

## 13. Appendix

### 13.1 File Structure

```
overleaf-cc/
├── src/
│   ├── content/
│   │   ├── injector.ts          # Claude button & dropdown
│   │   ├── file-reader.ts       # File I/O via DOM
│   │   └── sync-manager.ts      # NEW: Sync logic
│   ├── background/
│   │   └── service-worker.ts    # Background script
│   ├── terminal/
│   │   ├── terminal-ui.ts       # xterm.js setup
│   │   ├── websocket-client.ts  # Bridge communication
│   │   └── index.html           # Terminal page
│   └── shared/
│       └── types.ts             # TypeScript types
├── docs/
│   ├── DESIGN.md                # This document
│   └── INSTALLATION.md          # Setup instructions
├── dist/                        # Built extension
└── package.json
```

### 13.2 Related Projects

- **Claude Code**: https://claude.ai/code
- **@lobehub/icons**: https://github.com/lobehub/lobe-icons
- **xterm.js**: https://xtermjs.org/

### 13.3 References

- Chrome Extension Documentation: https://developer.chrome.com/docs/extensions/
- Overleaf API: https://github.com/overleaf/overleaf-api
- WebSocket Protocol: https://websockets.spec.whatwg.org/

---

**Document Version**: 1.0
**Last Updated**: 2025-03-05
**Author**: Claude (with user collaboration)
**Status**: Draft - Pending Review
