// 深度查找 Overleaf Socket.io 实例
// 复制到浏览器控制台运行

(function() {
  console.log('=== 🔍 深度查找 Overleaf Socket ===\n');

  // 1. 查找所有有 emit 方法的对象
  console.log('1️⃣ 查找所有有 emit 方法的对象:');
  const emitObjects = [];

  for (const key in window) {
    try {
      const obj = window[key];
      if (obj && typeof obj.emit === 'function') {
        emitObjects.push({ key: key, obj: obj });

        // 检查特征
        const hasId = obj.id !== undefined;
        const hasConnected = obj.connected !== undefined;
        const hasIo = obj.io !== undefined;
        const hasOn = typeof obj.on === 'function';

        console.log('\n' + key + ':');
        console.log('  - emit: ✅');
        console.log('  - id: ' + (hasId ? obj.id : '❌'));
        console.log('  - connected: ' + (hasConnected ? obj.connected : '❌'));
        console.log('  - io: ' + (hasIo ? '✅' : '❌'));
        console.log('  - on: ' + (hasOn ? '✅' : '❌'));
        console.log('  - keys: ' + Object.keys(obj).slice(0, 10).join(', '));

        // 尝试调用一次看看
        if (hasOn && hasConnected) {
          console.log('  → 可能是 Socket.io 实例！');
        }
      }
    } catch (e) {
      // 忽略
    }
  }

  // 2. 从 React DevTools 查找（如果有）
  console.log('\n2️⃣ 查找 React 内部实例:');
  const rootElements = document.querySelectorAll('[data-overleaf-editor], #editor, #ide');

  rootElements.forEach(function(el, i) {
    console.log('\n元素 ' + (i + 1) + ':', el.className || el.id);

    // 尝试从 React fiber 找
    const fiberKey = Object.keys(el).find(function(key) {
      return key.indexOf('__reactInternalInstance') === 0 || key.indexOf('_reactRoot') === 0;
    });
    if (fiberKey) {
      console.log('  - 有 React fiber: ' + fiberKey);
    }
  });

  // 3. 拦截 XMLHttpRequest 和 Fetch（备用方案）
  console.log('\n3️⃣ 拦截网络请求（备用方案）:');
  console.log('监听 XMLHttpRequest 和 Fetch 来捕获 WebSocket 消息...');

  // 保存原始方法
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  const originalFetch = window.fetch;

  // 拦截 XHR
  XMLHttpRequest.prototype.open = function(method, url) {
    this._url = url;
    console.log('[XHR] Request to:', url);
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(data) {
    if (this._url && (this._url.indexOf('socket') >= 0 || this._url.indexOf('websocket') >= 0)) {
      console.log('[XHR] Socket data:', data);
    }
    return originalXHRSend.apply(this, arguments);
  };

  // 拦截 Fetch
  window.fetch = function(url) {
    if (typeof url === 'string' && (url.indexOf('socket') >= 0 || url.indexOf('websocket') >= 0)) {
      console.log('[Fetch] Socket request:', url);
    }
    return originalFetch.apply(this, arguments);
  };

  // 4. 拦截 WebSocket 构造函数（最直接！）
  console.log('\n4️⃣ 拦截 WebSocket 构造函数:');
  const OriginalWebSocket = window.WebSocket;

  window.WebSocket = function(url, protocols) {
    console.log('[WebSocket] Creating connection to:', url);
    console.log('[WebSocket] Protocols:', protocols);

    const ws = new OriginalWebSocket(url, protocols);

    // 拦截 send 方法
    const originalSend = ws.send.bind(ws);
    ws.send = function(data) {
      console.log('[WebSocket] Sending:', data);
      try {
        const parsed = JSON.parse(data);
        console.log('[WebSocket] Parsed:', parsed);
      } catch (e) {
        // 不是 JSON
      }
      return originalSend(data);
    };

    // 监听消息
    ws.addEventListener('message', function(event) {
      console.log('[WebSocket] Received:', event.data);
    });

    return ws;
  };

  // 复制原型
  window.WebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

  console.log('✅ WebSocket 拦截器已安装');
  console.log('💡 现在在编辑器中输入文字，查看 WebSocket 消息\n');

  // 5. 延迟查找（等待页面完全加载）
  setTimeout(function() {
    console.log('\n5️⃣ 延迟查找（3秒后）:');

    // 查找 io 对象
    if (typeof window.io !== 'undefined') {
      console.log('  ✅ 找到 io 对象:', window.io);
    }

    // 查找 socket.io 相关的脚本
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    const socketScripts = scripts.filter(function(s) {
      return s.src.indexOf('socket') >= 0 || s.src.indexOf('io') >= 0;
    });

    if (socketScripts.length > 0) {
      console.log('  ✅ 找到 ' + socketScripts.length + ' 个 socket 相关脚本:');
      socketScripts.forEach(function(s, i) {
        console.log('     ' + (i + 1) + '. ' + s.src);
      });
    }

  }, 3000);

})();
