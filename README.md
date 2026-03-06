# Overleaf Mirror

Bidirectional file synchronization between Overleaf and local file system for Claude Code.

## Overview

Overleaf Mirror intercepts API calls from the Overleaf web interface and maintains a local mirror of your project files. This allows Claude Code to access and modify your Overleaf projects with real-time synchronization.

## Architecture

```
Overleaf Browser → Extension (API Interceptor)
                           ↓
                    WebSocket (ws://localhost:3456)
                           ↓
                  Local Mirror Server
                           ↓
                  File System (~/overleaf-mirror/)
                           ↓
                      Claude Code
```

## Quick Start

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/overleaf-cc.git
cd overleaf-cc

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Running the Mirror Server

```bash
cd packages/mirror-server
npm start
```

Server will start on port 3456.

### Loading the Browser Extension

1. Build the extension:
   ```bash
   cd packages/extension
   npm run build
   ```

2. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select `packages/extension/`

### Using with Claude Code

1. Open any Overleaf project
2. Extension will automatically connect to local server
3. Files will be mirrored to `~/overleaf-mirror/<project-id>/`
4. Point Claude Code to this directory
5. Changes made by Claude Code will sync back to Overleaf

## Documentation

- [Design Document](docs/plans/2026-03-06-overleaf-mirror-design.md)
- [Implementation Plan](docs/plans/2026-03-06-overleaf-mirror-implementation.md)
- [API Reference](docs/overleaf-api-reference.md)
- [Testing Guide](docs/testing-guide.md)

## Troubleshooting

### Connection Issues

If the extension cannot connect to the server:
- Ensure the mirror server is running on port 3456
- Check browser console for error messages
- Verify WebSocket is not blocked by firewall/antivirus

### File Sync Issues

If files are not syncing:
- Check server logs for incoming requests
- Verify file permissions in `~/overleaf-mirror/` directory
- Try reloading the extension and reconnecting

## Development

See [Testing Guide](docs/testing-guide.md) for manual testing instructions.

## License

MIT
