# Known Issues

## File Sync
- Two-way sync not yet implemented (only WebContainer → Overleaf)
- Conflict resolution not implemented
- Large files may fail silently

## Terminal
- Copy/paste not configured
- Scrollback buffer size not set
- Shell exit handling not implemented

## Authentication
- Session expiration not handled gracefully
- No user-visible error messages for auth failures

## Build Configuration
- xterm.js packages have deprecation warnings
- Should migrate to @xterm/xterm and @xterm/addon-fit
