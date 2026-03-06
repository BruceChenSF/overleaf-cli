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
