// 监听 Overleaf 的关键请求并查看响应
// 复制到浏览器控制台运行

(function() {
  console.log('=== 📡 监听 Overleaf 请求 ===\n');

  // 拦截 fetch
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : input.url || input.toString();

    // 记录所有 fetch 请求
    console.log('[Fetch] Request:', url);

    // 保存原始 promise
    const originalPromise = originalFetch.apply(this, [input, init]);

    // 拦截响应
    return originalPromise.then(async response => {
      // 克隆响应以便读取
      const clonedResponse = response.clone();

      try {
        // 只对关键请求打印响应
        if (url.indexOf('/editingSession') >= 0 ||
            url.indexOf('/doc/') >= 0 ||
            url.indexOf('/document/') >= 0 ||
            url.indexOf('/project/') >= 0) {

          const data = await clonedResponse.json();
          console.log('[Fetch] Response from:', url);
          console.log('  Data:', data);
        }
      } catch (e) {
        // 不是 JSON，忽略
      }

      return response;
    });
  };

  // 拦截 XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._url = url.toString();
    console.log('[XHR] Open:', method, url);
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    if (this._url) {
      console.log('[XHR] Send to:', this._url);
      if (body) {
        console.log('  Body:', body);
      }

      // 监听响应
      this.addEventListener('load', function() {
        if (this._url.indexOf('/editingSession') >= 0 ||
            this._url.indexOf('/doc/') >= 0 ||
            this._url.indexOf('/document/') >= 0 ||
            this._url.indexOf('/project/') >= 0) {
          console.log('[XHR] Response from:', this._url);
          console.log('  Status:', this.status);
          console.log('  Response:', this.responseText.substring(0, 500));
        }
      });
    }

    return originalSend.apply(this, arguments);
  };

  console.log('✅ 请求监听器已安装');
  console.log('💡 现在在编辑器中切换文件或编辑，查看请求\n');

  // 立即触发一个测试请求
  console.log('\n🔄 触发测试请求...\n');
  fetch('/editingSession/' + window.location.pathname.split('/')[2])
    .then(r => r.json())
    .then(data => {
      console.log('[Test] editingSession 响应:', data);
    })
    .catch(e => {
      console.log('[Test] editingSession 请求失败:', e.message);
    });

})();
