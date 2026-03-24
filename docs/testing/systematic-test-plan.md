# Overleaf CC Systematic Test Plan

> **Based on:** superpowers:systematic-debugging
> **Date:** 2026-03-03
> **Version:** v0.1.0 Alpha

## Testing Philosophy

遵循 systematic-debugging 原则：
- **每次测试一个功能点** - 不要同时测试多个功能
- **理解失败根因** - 测试失败时先调查原因
- **复现问题** - 记录可靠的复现步骤
- **证据优先** - 收集日志、截图、错误信息

---

## Phase 1: Pre-Test Preparation (根因调查准备)

### 1.1 Environment Verification

在开始测试前，验证环境配置：

```bash
# Check Node.js version (need 18+)
node --version
# Expected: v18.x.x or higher

# Check npm version
npm --version

# Verify bridge package is built
ls packages/bridge/dist/
# Expected: index.js, cli.js, bridge-server.js, etc.

# Verify extension is built
ls dist/
# Expected: manifest.json, assets/, src/terminal/
```

### 1.2 Component Availability Check

验证所有组件是否存在并正确配置：

**Bridge CLI:**
```bash
# Check if bridge is installed globally
which overleaf-cc-bridge
# Expected: /path/to/overleaf-cc-bridge OR not found (if not installed)

# If not found, install from local build
cd packages/bridge
npm link
# Expected: globally linked to local build
```

**Chrome Extension:**
```bash
# Check extension manifest
cat dist/manifest.json | jq '.name, .version, .permissions'
# Expected: valid JSON with correct fields

# Check WebSocket client file
ls -la src/terminal/websocket-client.ts
# Expected: file exists
```

### 1.3 Diagnostic Tools Setup

准备诊断工具：

```bash
# Create logs directory
mkdir -p test-logs

# Bridge server log monitor
cat > test-logs/start-bridge-with-logs.sh << 'EOF'
#!/bin/bash
echo "=== Starting Bridge Server ===" | tee test-logs/bridge.log
echo "Timestamp: $(date)" | tee -a test-logs/bridge.log
echo "PID: $$" | tee -a test-logs/bridge.log
overleaf-cc-bridge 2>&1 | tee -a test-logs/bridge.log
EOF
chmod +x test-logs/start-bridge-with-logs.sh
```

---

## Phase 2: Component Isolation Testing (隔离测试)

### 2.1 Test Bridge Server Independently

**目标:** 验证 bridge 服务器本身可以正常启动

```bash
# Test 1: Start bridge server
cd /c/Home/CodeProjects/overleaf-cc
cd packages/bridge
npm run build
node dist/cli.js

# Expected Output:
# [Bridge] WebSocket server listening on port 3456

# Test 2: Verify port is listening
netstat -an | grep 3456
# OR on Windows:
netstat -an | findstr 3456
# Expected: TCP 0.0.0.0:3456 LISTENING

# Test 3: Check for port conflicts
# If port 3456 is already in use:
node dist/cli.js --port 3457
```

**Success Criteria:**
- ✅ Server starts without errors
- ✅ Port is listening
- ✅ No crash on startup

**If Fails:**
- 🔍 Check error message
- 🔍 Verify dependencies are installed (`npm list`)
- 🔍 Try alternative port
- 🔍 Check firewall/antivirus blocking

### 2.2 Test Extension Loading

**目标:** 验证扩展可以正确加载到 Chrome

```bash
# Test 1: Build extension
npm run build

# Expected: No errors, dist/ updated

# Test 2: Verify manifest
cat dist/manifest.json | jq .

# Expected: Valid JSON, all fields present

# Test 3: Load in Chrome (manual)
# 1. Open chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select dist/ directory
# 5. Check for errors in Extensions page
```

**Success Criteria:**
- ✅ Extension loads without errors
- ✅ No warnings in chrome://extensions/
- ✅ Icon appears in toolbar

**If Fails:**
- 🔍 Check dist/manifest.json syntax
- 🔍 Verify all referenced files exist
- 🔍 Check browser console for errors
- 🔍 Review manifest.json structure

---

## Phase 3: Integration Testing (按序集成测试)

### 3.1 Test Case: Authentication Flow

**目标:** 验证扩展和 bridge 之间的认证

**Steps:**

1. **Start bridge server**
   ```bash
   cd packages/bridge
   node dist/cli.js
   ```

2. **Open Chrome DevTools**
   - Navigate to `chrome://extensions/`
   - Find "Overleaf CC" extension
   - Click "Service worker" link to open DevTools

3. **Open Overleaf project**
   - Go to https://cn.overleaf.com/project/YOUR_PROJECT_ID
   - Open browser console (F12)

4. **Click Terminal button**

5. **Check logs on both sides:**

   **Bridge server output:**
   ```
   [Bridge] Client connected
   [Bridge] Auth request for project [ID]
   [Sync] Fetching project files from Overleaf...
   [Sync] Found N documents
   ```

   **Extension console output:**
   ```
   [Terminal UI] Starting initialization...
   [Terminal UI] Terminal opened
   [WebSocket] Connected to bridge server
   ```

**Success Criteria:**
- ✅ WebSocket connection established
- ✅ Authentication message sent
- ✅ No "Failed to connect" error in terminal

**If Fails:**

**症状 1: "Failed to connect to bridge server"**
- 🔍 Is bridge server running? (`netstat -an | grep 3456`)
- 🔍 Check WebSocket URL in code (`ws://localhost:3456`)
- 🔍 Check browser console network tab
- 🔍 Verify CORS not blocking (should be same origin for extensions)

**症状 2: "Not authenticated" error**
- 🔍 Check session cookie is being retrieved
- 🔍 Verify Overleaf API is reachable from bridge
- 🔍 Check auth message format in bridge logs

---

### 3.2 Test Case: File Synchronization

**目标:** 验证文件在 Overleaf 和本地之间同步

**Steps:**

1. **Prepare test environment**
   ```bash
   # Check workspace directory
   ls packages/bridge/overleaf-workspace/
   # Expected: [PROJECT_ID]/ directory

   # If exists, clean it
   rm -rf packages/bridge/overleaf-workspace/[PROJECT_ID]/
   ```

2. **Start bridge server**
   ```bash
   cd packages/bridge
   node dist/cli.js
   ```

3. **Connect from extension** (open terminal in Overleaf)

4. **Check initial sync:**
   ```bash
   # Bridge should show:
   [Sync] Fetching project files from Overleaf...
   [Sync] Found N documents
   [Sync] Downloaded: file1.tex
   [Sync] Downloaded: file2.tex
   [Sync] Initial sync complete

   # Verify files exist locally:
   ls packages/bridge/overleaf-workspace/[PROJECT_ID]/
   ```

5. **Test upload sync:**
   - In terminal, run: `echo "test" >> test.txt`
   - Wait 2 seconds
   - Check bridge logs for: `[Sync] Uploading: test.txt`
   - Refresh Overleaf editor
   - Verify file appears (may need to check file list)

**Success Criteria:**
- ✅ Initial download shows correct file count
- ✅ Files exist in local workspace
- ✅ File modifications trigger upload
- ✅ No errors in sync logs

**If Fails:**

**症状 1: "Failed to fetch docs" error**
- 🔍 Check Overleaf session cookie is valid
- 🔍 Verify project ID is correct
- 🔍 Test Overleaf API manually:
  ```bash
  curl -H "Cookie: overleaf_session_id=YOUR_COOKIE" \
    https://cn.overleaf.com/api/project/[PROJECT_ID]/docs
  ```

**症状 2: Files not downloading**
- 🔍 Check bridge logs for API response
- 🔍 Verify network connectivity to Overleaf
- 🔍 Check if project is empty (no docs)

**症状 3: Upload not working**
- 🔍 Check if chokidar is watching files
- 🔍 Verify file actually changed on disk
- 🔍 Check Overleaf API update call succeeds

---

### 3.3 Test Case: Command Execution

**目标:** 验证可以通过终端执行命令

**Steps:**

1. **Ensure bridge server is running**

2. **Open terminal in Overleaf**

3. **Test basic commands:**

   ```bash
   # Test 1: Node.js version
   node --version
   # Expected: v18.x.x (in terminal output)

   # Test 2: npm version
   npm --version
   # Expected: npm version number

   # Test 3: Simple echo (via node)
   node -e "console.log('Hello from terminal')"
   # Expected: Hello from terminal
   ```

4. **Check bridge logs:**
   ```
   [Bridge] Executing: node --version
   [Bridge] Command exited with code 0
   ```

**Success Criteria:**
- ✅ Commands execute successfully
- ✅ Output appears in terminal
- ✅ No timeout errors
- ✅ Exit code is 0

**If Fails:**

**症状 1: Command hangs/timeout**
- 🔍 Check if Node.js is installed on system
- 🔍 Verify workspace directory exists
- 🔍 Check if command is blocking (needs input)

**症状 2: "Command not found"**
- 🔍 Verify command is in system PATH
- 🔍 Test command in regular terminal first
- 🔍 Check spawn() is using correct shell

**症状 3: No output in terminal**
- 🔍 Check if stdout is being piped correctly
- 🔍 Verify WebSocket message is being sent
- 🔍 Check terminal onData handler

---

### 3.4 Test Case: Claude Code Integration

**目标:** 验证可以运行 Claude Code CLI

**Prerequisites:**
- Claude Code CLI must be installed:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude --version
  ```

**Steps:**

1. **Start bridge server**

2. **Open terminal in Overleaf**

3. **Run Claude Code:**
   ```bash
   claude --version
   ```

4. **Try simple Claude command:**
   ```bash
   claude "Say hello"
   ```

**Success Criteria:**
- ✅ Claude Code version displayed
- ✅ Simple commands work
- ✅ Can see file system via Claude
- ✅ Can edit files via Claude

**If Fails:**

**症状 1: "claude: command not found"**
- 🔍 Verify Claude Code is installed globally
- 🔍 Check it's in PATH: `which claude`
- 🔍 Try with full path

**症状 2: Claude starts but can't access files**
- 🔍 Check workspace directory permissions
- 🔍 Verify files are synced from Overleaf
- 🔍 Check Claude working directory

---

## Phase 4: Error Handling Testing

### 4.1 Test: Bridge Server Not Running

**Steps:**
1. Ensure bridge server is **NOT** running
2. Open terminal in Overleaf
3. Observe error message

**Expected:**
```
Failed to connect to bridge server

Please make sure the bridge server is running:
  1. Install: npm install -g @overleaf-cc/bridge
  2. Run: overleaf-cc-bridge
```

**Success Criteria:**
- ✅ Clear error message
- ✅ Installation instructions shown
- ✅ No crash/undefined errors

### 4.2 Test: Invalid Session Cookie

**Steps:**
1. Manually delete Overleaf cookies
2. Open terminal in Overleaf
3. Observe error message

**Expected:**
```
Error: Could not find Overleaf session cookie
Please make sure you are logged in to Overleaf.
```

**Success Criteria:**
- ✅ Graceful error handling
- ✅ User-friendly message
- ✅ No silent failure

### 4.3 Test: Network Disconnection

**Steps:**
1. Start bridge server
2. Open terminal in Overleaf
3. Kill bridge server (Ctrl+C)
4. Type a command in terminal
5. Observe reconnection behavior

**Expected:**
- WebSocket tries to reconnect (up to 5 times)
- Shows "Connection lost" message after max attempts
- Doesn't crash the terminal

**Success Criteria:**
- ✅ Automatic reconnection attempts
- ✅ Clear error message on permanent failure
- ✅ Graceful degradation

---

## Phase 5: Edge Cases and Stress Testing

### 5.1 Test: Large File Sync

**Steps:**
1. Create large file in Overleaf (>1MB)
2. Open terminal
3. Check sync logs

**Expected:**
- File downloads successfully
- No timeout errors
- Reasonable sync time

### 5.2 Test: Multiple Files Changed Simultaneously

**Steps:**
1. Use Claude Code to modify multiple files
2. Check bridge logs

**Expected:**
- All files uploaded
- No race conditions
- Changes appear in Overleaf

### 5.3 Test: Special Characters in File Names

**Steps:**
1. Create file with special chars: `test (1).tex`
2. Sync and verify

**Expected:**
- File name preserved correctly
- No path traversal issues
- Upload/download works

---

## Phase 6: Documentation Verification

### 6.1 Verify Installation Instructions

**Follow README.md quick start exactly:**

```bash
# Step 1: Install bridge
npm install -g @overleaf-cc/bridge
# Or from local: cd packages/bridge && npm link

# Step 2: Start bridge
overleaf-cc-bridge

# Step 3: Build extension
cd /c/Home/CodeProjects/overleaf-cc
npm run build

# Step 4: Load in Chrome
# (manual steps)
```

**Success Criteria:**
- ✅ Each step works as documented
- ✅ No missing dependencies
- ✅ Clear instructions

### 6.2 Verify Troubleshooting Guide

For each issue in `docs/INSTALLATION.md` troubleshooting section:

1. Reproduce the issue
2. Follow the suggested fix
3. Verify it resolves the issue

---

## Test Results Summary

### Test Execution Log

| Test Case | Status | Notes | Timestamp |
|-----------|--------|-------|-----------|
| 2.1 Bridge Server Start | ☐ Pass ☐ Fail | | |
| 2.2 Extension Loading | ☐ Pass ☐ Fail | | |
| 3.1 Authentication | ☐ Pass ☐ Fail | | |
| 3.2 File Sync | ☐ Pass ☐ Fail | | |
| 3.3 Command Execution | ☐ Pass ☐ Fail | | |
| 3.4 Claude Code | ☐ Pass ☐ Fail | | |
| 4.1 Bridge Not Running | ☐ Pass ☐ Fail | | |
| 4.2 Invalid Session | ☐ Pass ☐ Fail | | |
| 4.3 Network Disconnect | ☐ Pass ☐ Fail | | |
| 5.1 Large Files | ☐ Pass ☐ Fail | | |
| 5.2 Multiple Changes | ☐ Pass ☐ Fail | | |
| 5.3 Special Characters | ☐ Pass ☐ Fail | | |
| 6.1 Installation Docs | ☐ Pass ☐ Fail | | |
| 6.2 Troubleshooting | ☐ Pass ☐ Fail | | |

### Overall Assessment

**Total Tests:** 14
**Passed:** ___
**Failed:** ___
**Blocked:** ___

**Critical Issues:**
1.
2.
3.

**Ready for Release:** ☐ Yes ☐ No

---

## Debugging Failed Tests

When a test fails, follow systematic-debugging Phase 1:

1. **Read Error Message** - What exactly failed?
2. **Reproduce Consistently** - Can you trigger it every time?
3. **Check Recent Changes** - What just changed?
4. **Gather Evidence** - Logs, screenshots, network traces

**Document each failure:**

```
## Test Failure: [Test Name]

**Symptom:**
[What went wrong]

**Error Message:**
[Paste exact error]

**Steps to Reproduce:**
1.
2.
3.

**Evidence Collected:**
- Bridge logs: [paste]
- Browser console: [paste]
- Network tab: [describe]

**Hypothesis:**
[I think X is the root cause because Y]

**Investigation:**
[What you checked]

**Root Cause:**
[Actual root cause after investigation]

**Fix Applied:**
[What fixed it]
```

---

## Next Steps After Testing

**If all tests pass:**
- Tag release: `git tag -a v0.1.0 -m "First alpha release"`
- Publish to npm: `npm publish --access public`
- Create GitHub release
- Announce to users

**If tests fail:**
- For 1-2 failures: Fix and re-test
- For 3+ failures: Reconsider architecture (see Phase 4.5 of systematic-debugging)

**Questions to ask before release:**
- Does this solve the user's core problem?
- Is the installation process smooth?
- Are error messages helpful?
- Is the documentation complete?
