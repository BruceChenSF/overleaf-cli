/**
 * Terminal Logic for terminal.html
 * Connects to mirror-server terminal endpoint
 */

// Initialize terminal when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('[Terminal] DOM ready, initializing...');

  const Terminal = window.Terminal;
  const FitAddon = window.FitAddon?.FitAddon;

  if (!Terminal) {
    console.error('[Terminal] Terminal not loaded!');
    return;
  }

  if (!FitAddon) {
    console.error('[Terminal] FitAddon not loaded!');
    return;
  }

  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace',
    scrollback: 10000,
    theme: {
      background: '#000000',
      foreground: '#ffffff',
      cursor: '#ffffff',
      selection: 'rgba(255, 255, 255, 0.3)'
    }
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  terminal.open(document.getElementById('terminal'));
  fitAddon.fit();

  let currentSessionId = null;
  let projectId = null;

  // Get project_id from chrome.storage
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(['working_dir'], (result) => {
      const workingDir = result.working_dir;
      if (workingDir) {
        // Extract project_id from working_dir path
        // Path format: ~/overleaf-mirror/{projectId}
        const match = workingDir.match(/overleaf-mirror[\/\\]([^\/\\]+)$/);
        if (match) {
          projectId = match[1];
          console.log('[Terminal] Extracted project_id:', projectId);

          // Connect to terminal after getting project_id
          connectToTerminal();
        } else {
          console.error('[Terminal] Failed to extract project_id from working_dir:', workingDir);
          terminal.writeln('\r\n\x1b[31m✗ 无法获取项目 ID，请确保已连接到 Overleaf Mirror\x1b[0m\r\n');
        }
      } else {
        console.warn('[Terminal] No working_dir found in storage');
        terminal.writeln('\r\n\x1b[33m⚠️ 未找到工作目录，请先完成 Overleaf 同步\x1b[0m\r\n');
      }
    });
  } else {
    console.error('[Terminal] chrome.storage not available');
    terminal.writeln('\r\n\x1b[31m✗ Chrome Storage API 不可用\x1b[0m\r\n');
  }

  function connectToTerminal() {
    if (!projectId) {
      console.error('[Terminal] No project_id available');
      return;
    }

    // Connect to mirror-server WebSocket (port 3456)
    const ws = new WebSocket('ws://localhost:3456');

    ws.onopen = () => {
      console.log('[Terminal] WebSocket connected to mirror-server');
      terminal.writeln('\r\n\x1b[32m✓ Terminal 已连接到镜像服务器\x1b[0m\r\n');

      // Send terminal_start message
      ws.send(JSON.stringify({
        type: 'terminal_start',
        project_id: projectId,
        cols: terminal.cols,
        rows: terminal.rows,
        timestamp: Date.now()
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case 'terminal_ready':
            console.log('[Terminal] Terminal ready, PID:', message.pid, 'CWD:', message.cwd);
            currentSessionId = message.session_id;
            terminal.writeln(`\x1b[36m工作目录: ${message.cwd}\x1b[0m\r\n`);
            break;

          case 'terminal_data':
            if (message.session_id === currentSessionId) {
              terminal.write(message.data);
            } else {
              console.warn('[Terminal] Received data for different session:', message.session_id);
            }
            break;

          case 'terminal_exit':
            console.log('[Terminal] Terminal exited, code:', message.exit_code);
            if (message.session_id === currentSessionId) {
              terminal.writeln(`\r\n\r\n\x1b[33m进程已退出 (代码: ${message.exit_code})\x1b[0m\r\n`);
              currentSessionId = null;
            }
            break;

          case 'terminal_error':
            console.error('[Terminal] Terminal error:', message.error);
            if (message.session_id === currentSessionId) {
              terminal.writeln(`\r\n\r\n\x1b[31m错误: ${message.error}\x1b[0m\r\n`);
            }
            break;

          default:
            // Ignore other message types (sync, edit_event, etc.)
            break;
        }
      } catch (error) {
        console.error('[Terminal] Message parse error:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[Terminal] WebSocket error:', error);
      terminal.writeln('\r\n\x1b[31m✗ WebSocket 连接错误，请确保镜像服务器正在运行\x1b[0m\r\n');
    };

    ws.onclose = () => {
      console.log('[Terminal] WebSocket closed');
      if (currentSessionId) {
        terminal.writeln('\r\n\x1b[33m连接已关闭\x1b[0m\r\n');
        currentSessionId = null;
      }
    };

    // User input - send to terminal
    terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN && currentSessionId) {
        ws.send(JSON.stringify({
          type: 'terminal_data',
          session_id: currentSessionId,
          data: data,
          timestamp: Date.now()
        }));
      }
    });

    // Window resize - send new dimensions
    window.addEventListener('resize', () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN && currentSessionId) {
        ws.send(JSON.stringify({
          type: 'terminal_resize',
          session_id: currentSessionId,
          cols: terminal.cols,
          rows: terminal.rows,
          timestamp: Date.now()
        }));
      }
    });

    console.log('[Terminal] ✓ Terminal initialized');
  }
});
