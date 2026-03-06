# Contributing to Overleaf Mirror

## Development Setup

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Build all packages
pnpm build

# Development mode (watch)
pnpm dev:server   # Watch mirror-server
pnpm dev:extension  # Watch extension
```

## Project Structure

```
packages/
├── mirror-server/    # Local backend service
│   └── src/
│       ├── server.ts          # WebSocket server
│       ├── filesystem/        # File system operations
│       └── types.ts           # Shared types
│
└── extension/        # Browser extension
    └── src/
        ├── content/           # Content scripts
        │   └── interceptor.ts # API interception
        └── client.ts          # WebSocket client
```

## Code Style

- Use TypeScript for all new code
- Follow existing code style
- Write tests for new features
- Commit messages should follow conventional commits

## Testing

```bash
# Run all tests
pnpm test

# Run tests for specific package
cd packages/mirror-server
npm test

# Run integration tests
npm run test:integration
```

## Pull Requests

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request
