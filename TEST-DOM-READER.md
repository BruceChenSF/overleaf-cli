# DOM-Based File Reader Testing Guide

## Overview

We've implemented a new DOM-based file reading approach that bypasses Overleaf's API entirely. Instead, it reads file content directly from the editor's DOM, similar to how PaperDebugger works.

## What Changed

### New Components

1. **`src/content/file-reader.ts`** - Content script that reads/writes Overleaf files from the DOM
   - Reads document content from the editor
   - Extracts file information from Overleaf's internal state
   - Writes content back to the editor

2. **`packages/bridge/src/sync-manager-dom.ts`** - New sync manager using DOM approach
   - Communicates with content script via extension
   - No longer depends on Overleaf API
   - Works with both overleaf.com and cn.overleaf.com

3. **Updated Communication Flow**
   ```
   Overleaf Tab ←→ Content Script ←→ Extension ←→ Bridge ←→ Claude Code
   ```

## Testing Steps

### 1. Start the Bridge Server

```bash
cd packages/bridge
node dist/cli.js
```

Expected output:
```
[Bridge] WebSocket server listening on port 3456
```

### 2. Load the Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist` folder in the project root

### 3. Open Overleaf

1. Navigate to any Overleaf project (e.g., cn.overleaf.com)
2. The extension should automatically inject the file-reader content script
3. Open browser DevTools (F12) → Console
4. You should see: `[FileReader] File reader content script loaded`

### 4. Open Terminal

1. Click the "Terminal" button injected by the extension
2. The terminal window should open
3. Bridge connection should be established
4. Initial sync will attempt to read the current document

### 5. Verify File Reading

Check the bridge server output for:
```
[Bridge] Client connected
[Bridge] Auth request for project <project-id>
[Bridge] Starting initial sync...
[SyncManagerDOM] Fetching all files from Overleaf...
[SyncManagerDOM] Found X files
[SyncManagerDOM] Syncing main file: <filename>
```

Check browser console for:
```
[FileReader] Received message: GET_ALL_FILES
[FileReader] Found files: [...]
[FileReader] Received message: GET_FILE_CONTENT
[FileReader] Got content, length: <number>
```

### 6. Test Terminal Commands

In the terminal window, try:
- `clear` - Clear terminal
- `help` - Show available commands
- `ls` - List files in local workspace
- `cat main.tex` - View synced file content

## Architecture Advantages

✅ **Works with cn.overleaf.com** - No API dependencies
✅ **No authentication issues** - Reads directly from what user sees
✅ **Simpler architecture** - Fewer moving parts
✅ **Proven approach** - Same method used by PaperDebugger

## Troubleshooting

### No files found

**Problem**: `[FileReader] Found files: 0`

**Solution**:
- Make sure you have an Overleaf project open
- Try switching to a different document in the project
- Check if the content script loaded: Look for `[FileReader] File reader content script loaded` in console

### Cannot read document content

**Problem**: `[FileReader] Could not extract document content`

**Solution**:
- Make sure the editor has fully loaded
- Try refreshing the page
- Check if you're on the editor page (not just the project overview)

### Extension message timeout

**Problem**: Bridge shows "Extension message timeout"

**Solution**:
- Make sure the extension is loaded
- Check that the Overleaf tab is still open
- Verify the terminal window is open
- Try clicking the Terminal button again

## Next Steps

Once basic file reading is working:
1. Implement file watching for automatic sync
2. Add support for multiple files
3. Implement file writing from bridge to editor
4. Add conflict resolution for concurrent edits

## Status

- ✅ File reader content script created
- ✅ Bridge server updated with DOM sync manager
- ✅ Extension manifest updated
- ✅ WebSocket communication enhanced
- ✅ Bridge server builds successfully
- ⏳ Testing in progress
