# Manual Integration Test Plan

## Prerequisites

- Bridge CLI installed and running
- Chrome extension loaded
- Overleaf project open

## Test Cases

### TC1: Bridge Server Startup

**Steps:**
1. Run: `overleaf-cc-bridge`
2. Check console output

**Expected:**
```
[Bridge] WebSocket server listening on port 3456
```

**Status:** ☐ Pass ☐ Fail

---

### TC2: Extension Auth

**Steps:**
1. Open Overleaf project
2. Click Terminal button
3. Check bridge server logs

**Expected:**
```
[Bridge] Client connected
[Bridge] Auth request for project [ID]
[Sync] Fetching project files from Overleaf...
[Sync] Found N documents
[Sync] Downloaded: [file paths]
[Sync] Initial sync complete
[Sync] Watching for file changes...
```

**Status:** ☐ Pass ☐ Fail

---

### TC3: Command Execution

**Steps:**
1. In terminal, type: `node --version`
2. Press Enter
3. Check output

**Expected:**
Terminal shows Node.js version number

**Status:** ☐ Pass ☐ Fail

---

### TC4: Claude Code Execution

**Steps:**
1. In terminal, type: `claude --version`
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
