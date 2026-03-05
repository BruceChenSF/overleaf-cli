# Troubleshooting Guide

This guide helps you diagnose and resolve common issues with Overleaf CC.

## Sync Issues

### Timeout Errors

**Problem:** Files fail to sync with "Request timeout" errors

**Solutions:**
1. Wait for automatic retry (up to 3 attempts with exponential backoff)
2. Check network connection
3. Reload the extension
4. Check if Overleaf is experiencing issues

**Technical Details:**
- WebSocket requests timeout after 3 seconds
- Retry attempts: 3 (configurable)
- Backoff: 1s → 2s → 4s (exponential)

**How Automatic Retry Works:**

When a file download times out, the extension automatically retries with exponential backoff:
- Attempt 1: Immediate (with 3s timeout)
- Attempt 2: After 1 second delay
- Attempt 3: After 2 seconds delay
- Attempt 4: After 4 seconds delay

This gives each file up to 4 chances to download successfully before reporting an error.

### File Deletion Not Working

**Problem:** Files deleted in Overleaf remain in local workspace

**Solutions:**
1. Check browser console for "removeEntity" messages
2. Verify Bridge WebSocket is connected
3. Check file permissions in workspace directory
4. Try manual sync: Click extension icon → Sync Now

**Debug Commands:**
```javascript
// In browser console
chrome.runtime.sendMessage({ type: 'GET_DEBUG_INFO' })
```

**Expected Behavior:**
When a file is deleted in Overleaf:
1. Extension detects change in file tree
2. Sends "removeEntity" message to Bridge
3. Bridge deletes file from local workspace
4. Console log: `[Overleaf CC] Deleted file: filename.tex`

### Excessive Sync Triggers

**Problem:** Sync triggers when just expanding/collapsing folders

**Solution:**
- Fixed in version 1.2.0
- Update extension: `npm run build && npm run package`
- File tree watcher now:
  - Ignores class/style attribute changes
  - Tracks file count
  - Compares file names before triggering sync

**How the Fix Works:**

The file tree watcher uses a smart comparison algorithm:
1. Counts total files in tree (ignores class/style changes)
2. Compares file names between old and new state
3. Only triggers sync when actual file changes detected
4. Expanding/collapsing folders no longer triggers sync

**Pre-1.2.0 Behavior:**
- Folder expansion changed DOM class attributes
- Watcher detected any DOM change
- Sync triggered unnecessarily

**Post-1.2.0 Behavior:**
- Class/style changes ignored
- Only file count and names compared
- Sync only triggers for real changes

## Performance Optimization

### Incremental Sync

The extension uses incremental sync to avoid unnecessary downloads:

1. **Hash Comparison**: Only downloads files with changed hashes
2. **File Tree Comparison**: Detects additions/deletions without re-downloading
3. **Batch Processing**: Processes files in batches of 10

**Performance Comparison:**
- **First Sync**: Downloads all files (~30-60 seconds for 100 files)
- **Subsequent Syncs**: Only changed files (~1-5 seconds)

**How It Works:**

```javascript
// Pseudo-code for incremental sync
1. Get file tree from Overleaf DOM
2. Compare with previous state:
   - New files → Download
   - Deleted files → Remove locally
   - Modified files → Compare hash
3. Download only files with changed hashes
4. Process in batches of 10 for better performance
```

### Monitoring Sync Performance

```javascript
// In browser console
console.log('[Overleaf CC] Sync state:', syncStateTracker.getAllFiles());
```

**Output Example:**
```javascript
{
  "main.tex": { hash: "abc123", lastSync: "2025-01-15T10:30:00Z" },
  "chapter1.tex": { hash: "def456", lastSync: "2025-01-15T10:30:01Z" }
}
```

## Common Error Messages

### "Bridge not connected"

**Cause:** Extension can't communicate with Bridge CLI

**Solutions:**
1. Check if Bridge is running: `overleaf-cc-bridge`
2. Check Bridge terminal for errors
3. Restart Bridge
4. Reload extension

### "Failed to download file: filename.tex"

**Cause:** Network issue or Overleaf API error

**Solutions:**
1. Check internet connection
2. Wait for automatic retry (up to 3 attempts)
3. Check if file exists in Overleaf
4. Try manual sync: Click extension icon → Sync Now

### "Workspace directory not found"

**Cause:** Bridge can't access the local workspace directory

**Solutions:**
1. Check Bridge configuration
2. Verify workspace directory exists
3. Check file permissions
4. Restart Bridge with correct workspace path

## Debug Mode

### Enable Debug Logging

```javascript
// In browser console
chrome.storage.local.set({ debugMode: true });
```

This enables verbose logging for:
- File tree changes
- Sync operations
- WebSocket messages
- Error details

### View Logs

**Browser Console (F12 → Console tab):**
- Extension activity logs
- Sync operation logs
- Error messages

**Bridge Terminal:**
- File system operations
- WebSocket communication
- Claude Code execution

### Collect Debug Information

```javascript
// In browser console
chrome.runtime.sendMessage({ type: 'GET_DEBUG_INFO' }, (response) => {
  console.log('Debug Info:', response);
});
```

**Response includes:**
- Extension version
- Bridge connection status
- Current sync state
- Recent sync history
- Error counts

## Getting Help

If issues persist after trying these solutions:

1. **Check Logs:**
   - Browser console (F12 → Console tab)
   - Bridge terminal output

2. **Collect Information:**
   - Extension version (in dropdown menu)
   - Browser version
   - Operating system
   - Error messages
   - Steps to reproduce

3. **Open Issue on GitHub:**
   - Include browser console logs
   - Include Bridge logs
   - Include extension version
   - Include Overleaf project URL (anonymized if needed)
   - Describe expected vs actual behavior

4. **Useful Debug Commands:**
```javascript
// Get current sync state
chrome.runtime.sendMessage({ type: 'GET_DEBUG_INFO' })

// Check Bridge connection
chrome.runtime.sendMessage({ type: 'PING_BRIDGE' })

// Force manual sync
chrome.runtime.sendMessage({ type: 'SYNC_NOW' })

// Clear sync state
chrome.runtime.sendMessage({ type: 'CLEAR_SYNC_STATE' })
```

## Version-Specific Issues

### Version 1.0.x - 1.1.x

**Known Issues:**
- Excessive sync triggers when expanding folders
- No retry logic for failed downloads
- File deletion not supported

**Solution:** Upgrade to v1.2.0 or later

### Version 1.2.0+

**Features:**
- Automatic retry with exponential backoff
- File deletion synchronization
- Incremental sync for better performance
- Fixed excessive sync triggers

**If you still have issues:**
- Check if you're using the latest version
- Try clearing sync state: `chrome.runtime.sendMessage({ type: 'CLEAR_SYNC_STATE' })`
- Reinstall extension if needed

## Performance Tips

### For Large Projects (100+ files)

1. **Use incremental sync** - Only changed files download
2. **Enable debug mode** - Monitor sync performance
3. **Check network** - Faster connection = faster sync
4. **Batch processing** - Extension processes 10 files at a time

### For Slow Networks

1. **Increase timeout** - Modify extension settings (if needed)
2. **Use manual sync** - Sync only when needed
3. **Monitor retry attempts** - Check if retries are exhausted
4. **Check connection stability** - Intermittent issues cause retries

### For Collaborative Projects

1. **Use manual sync mode** - Review changes before syncing
2. **Check for conflicts** - Look for conflict warnings in dropdown
3. **Communicate with collaborators** - Let them know when you're syncing
4. **Respect others' changes** - Don't overwrite their work
