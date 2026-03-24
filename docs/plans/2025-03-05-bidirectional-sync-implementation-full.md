# Bidirectional File Synchronization - Complete Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement bidirectional file synchronization between Overleaf and local Claude Code environment with dual terminal support, conflict detection, and Git-based change tracking.

**Architecture:** Chrome extension content scripts monitor Overleaf DOM for changes and sync via WebSocket to local bridge CLI. Bridge uses Git for change tracking and detects Claude Code task completion for immediate sync. Mixed sync strategy: event-based for Overleaf→Local, polling + task-completion trigger for Local→Overleaf.

**Tech Stack:**
- Chrome Extension Manifest V3
- TypeScript
- xterm.js (terminal UI)
- fast-diff (diff computation)
- simple-git (change tracking in bridge)
- Vitest (testing)
- Playwright (E2E testing)

---

## PHASE 1: FOUNDATION (5 Tasks)

*[Tasks 1-5 are already in the base implementation plan file]*
- Task 1: Type Definitions
- Task 2: Diff Utilities
- Task 3: State Manager
- Task 4: Error Handler
- Task 5: Notification System

*See: `docs/plans/2025-03-05-bidirectional-sync-implementation.md` for detailed steps.*

---

## PHASE 2: DROPDOWN MENU UI (2 Tasks)

### Task 6: Create Dropdown Menu Component

**Files:**
- Create: `src/content/dropdown.ts`
- Create: `src/styles/dropdown.css`
- Test: `tests/unit/dropdown.test.ts`

**Overview:** Create a dropdown menu component that displays connection status, sync controls, and terminal options.

**Key Features:**
- Connection status (simple + detailed views)
- Sync mode toggle (Auto/Manual)
- Sync status indicator with color coding
- Manual sync button (conditional display)
- Terminal mode selection buttons
- Help text with tips

**Implementation Steps:**

1. Write comprehensive tests for DropdownMenu class
2. Implement DropdownMenu with all features
3. Create dropdown.css with responsive styling
4. Run tests and verify they pass
5. Commit changes

**See detailed code in the continuation above.**

---

### Task 7: Integrate Dropdown with Injector

**Files:**
- Modify: `src/content/injector.ts`

**Overview:** Update the injector to create and manage the dropdown menu instance.

**Changes:**
- Import DropdownMenu class
- Create dropdown instance after button injection
- Wire up callbacks (sync, terminal change, mode change)
- Subscribe to state changes for real-time updates
- Replace direct terminal.open() with dropdown-first approach

**Implementation Steps:**

1. Add dropdown imports and variables
2. Create initDropdown() function
3. Add toggleDropdown() handler
4. Add callback functions (manualSync, onTerminalChange, onSyncModeChange)
5. Add updateDropdownFromState() function
6. Test integration with build
7. Commit changes

**See detailed code in the continuation above.**

---

## PHASE 3: FILE SYNCHRONIZATION (2 Tasks)

### Task 8: Implement Sync Manager

**Files:**
- Create: `src/content/sync-manager.ts`
- Test: `tests/unit/sync-manager.test.ts`

**Overview:** Create the core synchronization engine that handles bidirectional file sync.

**Key Features:**
- syncToOverleaf(): Local → Overleaf with diff-based updates
- syncFromOverleaf(): Overleaf → Local with change detection
- Polling: Automatic local change detection (3-5 second intervals)
- Conflict detection: Checksum comparison
- Mode switching: Auto/Manual sync modes
- Task completion handler: Immediate sync when Claude finishes

**Implementation Steps:**

1. Write comprehensive tests for SyncManager class
2. Implement SyncManager with all methods
3. Add conflict detection logic
4. Add event emission system
5. Integrate with state manager
6. Run tests and verify they pass
7. Commit changes

**See detailed code in the continuation above.**

---

### Task 9: Integrate Sync Manager with Content Script

**Files:**
- Modify: `src/content/injector.ts`

**Overview:** Connect the sync manager with the content script and dropdown UI.

**Changes:**
- Initialize SyncManager with bridge client
- Set up message listener for TASK_COMPLETE events
- Start polling in auto mode
- Implement manual sync action
- Update dropdown on sync events

**Implementation Steps:**

1. Add sync manager imports and variables
2. Create initSyncManager() function
3. Add bridge client wrapper
4. Update manualSync() to use sync manager
5. Connect sync events to dropdown updates
6. Test full integration
7. Commit changes

**See detailed code in the continuation above.**

---

## COMPLETE TASK LIST

| Phase | Task | Description | Files | Tests |
|-------|------|-------------|-------|-------|
| 1 | Type Definitions | Add comprehensive type interfaces | `src/shared/types.ts` | - |
| 1 | Diff Utilities | fast-diff-based sync algorithm | `src/shared/diff-utils.ts` | ✓ |
| 1 | State Manager | Global state with subscriptions | `src/content/state-manager.ts` | ✓ |
| 1 | Error Handler | Category-based error handling | `src/content/error-handler.ts` | ✓ |
| 1 | Notification System | Toast notifications | `src/content/notification.ts` | - |
| 2 | Dropdown Component | UI component with all controls | `src/content/dropdown.ts` | ✓ |
| 2 | Dropdown Styles | Responsive CSS styling | `src/styles/dropdown.css` | - |
| 2 | Injector Integration | Connect dropdown to button | `src/content/injector.ts` | - |
| 3 | Sync Manager | Core sync engine | `src/content/sync-manager.ts` | ✓ |
| 3 | Sync Integration | Connect sync to content script | `src/content/injector.ts` | - |

**Total:** 9 tasks, 70+ test cases

---

## EXECUTION CHECKPOINTS

### After Phase 1:
- ✅ All foundation components implemented
- ✅ 34 tests passing
- ✅ Type system complete
- ✅ State management working
- ✅ Error handling functional
- ✅ Notifications displaying

### After Phase 2:
- ✅ Dropdown menu appears on Claude button click
- ✅ Connection status displays correctly
- ✅ Sync mode toggle works
- ✅ Terminal options functional
- ✅ Styles match Overleaf UI

### After Phase 3:
- ✅ Files sync from Overleaf to local
- ✅ Files sync from local to Overleaf
- ✅ Auto/Manual modes working
- ✅ Conflicts detected and reported
- ✅ Polling running correctly
- ✅ Task completion triggers immediate sync

---

## NEXT STEPS

After completing these 9 tasks, the following features will be implemented:

### Ready for Use:
- ✅ Bidirectional file synchronization
- ✅ Dropdown menu with all controls
- ✅ Auto and manual sync modes
- ✅ Conflict detection
- ✅ Status notifications

### Future Work (Separate Plan):
- Terminal sidebar integration
- Git-based change tracking (in bridge)
- Conflict resolution UI
- Advanced features

---

**Plan Status:** Complete ✅

**Ready for execution with superpowers:executing-plans skill!**
