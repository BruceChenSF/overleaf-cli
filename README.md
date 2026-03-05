# Overleaf CC

Run Claude Code CLI in Overleaf with bidirectional file synchronization and dual terminal support.

## Features

- **🔄 Bidirectional Sync** - Seamless synchronization between Overleaf and local Claude Code environment
- **🎯 Dual Terminal Modes** - Choose between local terminal or integrated in-page terminal
- **⚡ Smart Sync Modes** - Auto-sync for trusted workflows or manual sync for controlled changes
- **🔌 Native Integration** - Terminal sidebar integrates with Overleaf's UI
- **🎨 Claude Icon** - Clean, recognizable interface using official Claude branding

## Architecture

This project consists of two parts:

1. **@overleaf-cc/bridge** - Local CLI tool that runs Claude Code and manages file sync
2. **overleaf-cc-extension** - Chrome extension providing UI and terminal integration

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Overleaf 网页                           │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │  Claude 按钮  │ ────▶  │  下拉菜单 UI  │                 │
│  └──────────────┘         └──────────────┘                 │
│         │                        │                          │
│         ▼                        ▼                          │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │ 侧边栏切换器  │         │ Content      │                 │
│  │ + 终端按钮    │         │ Script       │                 │
│  └──────────────┘         └──────────────┘                 │
│         │                        │                          │
│         ▼                 ┌──────┴──────┐                   │
│  ┌──────────────┐         │             │                   │
│  │ 终端侧边栏    │         │文件监听+同步 │                   │
│  │ (xterm.js)   │         │  (DOM操作)   │                   │
│  └──────────────┘         └──────────────┘                 │
└─────────────────────────────────────────────────────────────┘
                          │
                    Chrome Extension API
                          │
┌─────────────────────────────────────────────────────────────┐
│                   Bridge CLI (本地)                          │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │文件监听      │         │Claude Code   │                 │
│  │本地变化检测  │         │执行环境      │                 │
│  └──────────────┘         └──────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Install the Bridge CLI

```bash
npm install -g @overleaf-cc/bridge
```

### 2. Start the Bridge Server

```bash
overleaf-cc-bridge
```

### 3. Install the Chrome Extension

1. Build the extension: `npm run build`
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist` directory

### 4. Use in Overleaf

1. Open any Overleaf project
2. Click the Claude icon in the toolbar
3. Choose your terminal mode (local or in-page)
4. Start using Claude Code!

## Troubleshooting

### File Sync Timeouts

If you see "Request timeout" errors during sync:
- The extension automatically retries failed downloads up to 3 times
- Check your internet connection
- Try reloading the extension
- See [Troubleshooting Guide](docs/troubleshooting.md) for details

### Files Not Deleting

If deleted files remain in local workspace:
- Check browser console for error messages
- Ensure Bridge is running and connected
- Try manual sync: Click the extension icon → Sync Now

### Excessive Sync Triggers

If sync triggers when expanding folders:
- This is fixed in v1.2.0 - update the extension
- The file tree watcher now distinguishes between folder expansion and file changes

## Sync Modes

### Auto Sync (Default)
- Changes automatically sync between Overleaf and local environment
- Immediate sync when Claude Code completes a task
- Perfect for users who trust Claude's suggestions

### Manual Sync
- Review changes before syncing
- Click "Sync to Overleaf" button when ready
- Ideal for collaborative projects requiring review

## How It Works

### Bidirectional Synchronization

**Overleaf → Local:**
- Event listeners detect edits in Overleaf editor
- Changes immediately sync to local environment

**Local → Overleaf:**
- Polling every 3-5 seconds detects local changes
- Immediate sync when Claude Code completes tasks
- Manual sync button available in manual mode

### Conflict Detection

- Detects when both Overleaf and local files are modified
- Shows warning in dropdown menu
- Respects collaborators' changes
- Future: Full conflict resolution via Claude Code skill

## Development

See [docs/DESIGN.md](docs/DESIGN.md) for detailed design documentation.

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for detailed setup instructions.

## Roadmap

- [x] Basic file reading from Overleaf DOM
- [x] Claude icon button
- [ ] Bidirectional file synchronization
- [ ] Dropdown menu with sync controls
- [ ] In-page terminal sidebar
- [ ] Conflict detection UI
- [ ] Claude Code skill integration (future)

## License

MIT
