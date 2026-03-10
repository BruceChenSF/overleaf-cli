/**
 * Terminal Logic for terminal.html
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

  // 连接 WebSocket
  const ws = new WebSocket('ws://localhost:3000/terminal');

  ws.onopen = () => {
    console.log('[Terminal] WebSocket connected');
    terminal.writeln('\r\n\x1b[32m✓ Claude Terminal 已连接\x1b[0m\r\n');

    ws.send(JSON.stringify({
      type: 'start',
      cols: terminal.cols,
      rows: terminal.rows
    }));
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case 'ready':
          console.log('[Terminal] PTY ready, PID:', message.pid);
          break;

        case 'data':
          terminal.write(message.data);
          break;

        case 'exit':
          console.log('[Terminal] PTY exited, code:', message.code);
          terminal.writeln(`\r\n\r\n\x1b[33m进程已退出 (代码: ${message.code})\x1b[0m\r\n`);
          break;
      }
    } catch (error) {
      console.error('[Terminal] Message error:', error);
    }
  };

  ws.onerror = (error) => {
    console.error('[Terminal] WebSocket error:', error);
  };

  ws.onclose = () => {
    console.log('[Terminal] WebSocket closed');
  };

  // 用户输入
  terminal.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'data',
        data: data
      }));
    }
  });

  // 窗口大小改变
  window.addEventListener('resize', () => {
    fitAddon.fit();
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'resize',
        cols: terminal.cols,
        rows: terminal.rows
      }));
    }
  });

  console.log('[Terminal] ✓ Initialized');
});
