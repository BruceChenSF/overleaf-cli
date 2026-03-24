# Release Notes - v0.1.0 (Alpha)

## Overview

This is the first alpha release of Overleaf CC, a hybrid system that enables running Claude Code CLI in Overleaf with automatic file synchronization.

## What's New

### Architecture
- Split into two packages: bridge CLI tool and Chrome extension
- WebSocket-based communication between extension and local tool
- Automatic bidirectional file synchronization

### Bridge CLI (`@overleaf-cc/bridge`)
- WebSocket server on port 3456
- Overleaf API client with session authentication
- File synchronization manager with chokidar
- Command execution in isolated workspace
- Support for both overleaf.com and cn.overleaf.com

### Chrome Extension
- xterm.js-based terminal UI
- WebSocket client for bridge communication
- Automatic session cookie detection
- Project context management
- Fallback simple terminal mode

## Known Issues

- File sync conflicts are not resolved (last write wins)
- No support for binary files
- Claude Code must be installed separately
- Bridge server must be started manually

## Installation

See [README.md](README.md) for quick start guide.

## Requirements

- Node.js 18+
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- Google Chrome
- Overleaf account

## Next Steps

- [ ] Add conflict resolution for file sync
- [ ] Support for binary files (images, etc.)
- [ ] Auto-installation of Claude Code
- [ ] Background service for bridge server
- [ ] File sync status indicator in UI

## Feedback

Please report issues at: https://github.com/yourusername/overleaf-cc/issues
