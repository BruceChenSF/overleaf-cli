// 拦截 Socket.io 的实际连接
// 复制到浏览器控制台运行

(function() {
  console.log('=== 🔌 Socket.io 拦截器 ===\n');

  // 1. 找到 io 对象
  const io = window.io;
  if (!io) {
    console.error('❌ 找不到 io 对象');
    return;
  }

  console.log('✅ 找到 io 对象:', io.version);
  console.log('   - sockets:', Object.keys(io.sockets || {}));
  console.log('   - 已连接数:', io.sockets ? Object.keys(io.sockets).length : 0);

  // 2. 查找所有已存在的 socket 连接
  console.log('\n2️⃣ 查找已存在的 socket 连接:');

  // 方法1: 从 io.sockets 查找
  if (io.sockets) {
    for (const key in io.sockets) {
      const socket = io.sockets[key];
      console.log('\nSocket:', key);
      console.log('  - type:', typeof socket);
      console.log('  - keys:', Object.keys(socket).slice(0, 15).join(', '));

      // 检查是否有 emit 方法
      if (typeof socket.emit === 'function') {
        console.log('  - ✅ 有 emit 方法！');

        // 保存原始 emit
        const originalEmit = socket.emit.bind(socket);

        // 替换 emit 方法
        socket.emit = function(event) {
          console.log('\n📤 [Socket.io emit] 事件:', event);
          console.log('   参数:', Array.from(arguments).slice(1));

          // 特别关注 applyOtUpdate 事件
          if (event === 'applyOtUpdate') {
            console.log('   🎯 捕获到 applyOtUpdate！');
            console.log('   数据:', JSON.stringify(arguments, null, 2));
          }

          // 调用原始方法
          return originalEmit.apply(this, arguments);
        };

        console.log('  - ✅ 已安装拦截器！');
      }
    }
  }

  // 3. 拦截 io.socket() 创建
  console.log('\n3️⃣ 拦截新的 socket 创建:');

  // 保存原始方法
  const originalSocket = io.socket ? io.socket.bind(io) : null;

  if (originalSocket) {
    io.socket = function() {
      console.log('\n🆕 [新 Socket] 创建连接');
      const socket = originalSocket.apply(this, arguments);

      // 拦截 emit
      const originalEmit = socket.emit.bind(socket);
      socket.emit = function(event) {
        console.log('\n📤 [新 Socket emit] 事件:', event);
        console.log('   参数:', Array.from(arguments).slice(1));

        if (event === 'applyOtUpdate') {
          console.log('   🎯 捕获到 applyOtUpdate！');
        }

        return originalEmit.apply(this, arguments);
      };

      console.log('   ✅ 已拦截新 socket');

      return socket;
    };

    console.log('✅ 已拦截 io.socket()');
  }

  // 4. 全局查找所有 socket 对象
  console.log('\n4️⃣ 全局查找 socket 对象:');

  // 查找所有可能有 socket 的地方
  const possibleContainers = [
    'ide',
    'editor',
    'document',
    'app',
    'Editor',
    'Document',
    'App'
  ];

  possibleContainers.forEach(function(key) {
    const obj = window[key];
    if (obj && typeof obj === 'object') {
      console.log('\n检查 window.' + key + ':');

      // 查找嵌套的 socket
      function findSockets(obj, path, depth) {
        if (depth > 3) return;

        for (const k in obj) {
          try {
            const val = obj[k];
            if (val && typeof val === 'object' && typeof val.emit === 'function') {
              console.log('  ✅ 找到 emit 方法: ' + path + '.' + k);

              // 拦截
              const originalEmit = val.emit.bind(val);
              val.emit = function(event) {
                console.log('\n📤 [' + path + '.' + k + ' emit]', event);
                if (event === 'applyOtUpdate') {
                  console.log('   🎯 捕获到 applyOtUpdate！');
                  console.log('   数据:', arguments);
                }
                return originalEmit.apply(this, arguments);
              };
            } else if (val && typeof val === 'object' && depth < 3) {
              findSockets(val, path + '.' + k, depth + 1);
            }
          } catch (e) {
            // 忽略
          }
        }
      }

      findSockets(obj, key, 0);
    }
  });

  // 5. 监听所有 DOM 事件（最后手段）
  console.log('\n5️⃣ 监听 DOM 事件:');

  // 监听 doc:changed 事件
  document.addEventListener('doc:changed', function(e) {
    console.log('\n📝 [DOM Event] doc:changed', e.detail);
  }, true);

  console.log('\n✅ 所有拦截器已安装');
  console.log('💡 现在在编辑器中输入文字\n');

})();
