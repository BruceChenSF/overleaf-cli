# Overleaf CC

Browser extension that brings a terminal to Overleaf, powered by WebContainer.

## Features

- Terminal button injected into Overleaf toolbar
- xterm.js-based terminal in standalone window
- WebContainer provides isolated Node.js environment
- Run Claude Code CLI in your Overleaf projects
- Real-time file sync with Overleaf

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev
```

## Installation

1. Build the extension: `npm run build`
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist/` folder

## Usage

1. Login to Overleaf
2. Open any project
3. Click the "Terminal" button in the toolbar
4. Claude Code CLI will be installed automatically
5. Use the terminal to run commands and Claude Code

## Architecture

- **Content Script**: Injects terminal button into Overleaf UI
- **Background Service Worker**: Manages Overleaf API and file sync
- **Terminal Window**: Standalone window with xterm.js
- **WebContainer**: Isolated Node.js environment

## Known Issues

See [docs/known-issues.md](docs/known-issues.md)

## License

MIT
