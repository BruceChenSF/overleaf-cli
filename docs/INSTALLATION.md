# Installation Guide

## Prerequisites

- Node.js 18+ installed
- npm or yarn
- Google Chrome browser
- Overleaf account (logged in)

## Install Bridge CLI

### From NPM (Recommended)

```bash
npm install -g @overleaf-cc/bridge
```

### From Source

```bash
git clone https://github.com/yourusername/overleaf-cc.git
cd overleaf-cc/packages/bridge
npm install
npm run build
npm link
```

## Install Chrome Extension

### Build Extension

```bash
cd overleaf-cc
npm install
npm run build
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode" toggle (top right)
3. Click "Load unpacked" button
4. Select the `dist` directory
5. Extension should appear in your extensions list

## Verify Installation

1. Start bridge server: `overleaf-cc-bridge`
2. You should see: `[Bridge] WebSocket server listening on port 3456`
3. Open Overleaf project
4. Click Terminal button
5. Terminal should connect and show: `Connected!`

## Troubleshooting

### Bridge server won't start

- Check if port 3456 is already in use
- Try: `overleaf-cc-bridge --port 3457`

### Terminal shows "Failed to connect"

- Make sure bridge server is running
- Check browser console for errors
- Verify WebSocket connection (chrome://extensions → Service Worker)

### Files not syncing

- Check you're logged in to Overleaf
- Verify session cookie is being captured
- Check bridge server logs for sync errors

## Development Setup

For development, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
