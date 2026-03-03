# Overleaf CC

Run Claude Code CLI in Overleaf with automatic file synchronization.

## Architecture

This project consists of two parts:

1. **@overleaf-cc/bridge** - Local CLI tool that runs Claude Code and syncs files
2. **overleaf-cc-extension** - Chrome extension that provides terminal UI

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
2. Click the "Terminal" button in the toolbar
3. Start using Claude Code!

## How It Works

```
Overleaf Web Page
    ↓ (click Terminal)
Chrome Extension Terminal
    ↓ (WebSocket)
Local Bridge Server
    ↓ (executes)
Claude Code CLI
    ↓ (reads/writes)
Local File System
    ↓ (synced by)
Overleaf API
```

## Development

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for detailed setup instructions.

## License

MIT
