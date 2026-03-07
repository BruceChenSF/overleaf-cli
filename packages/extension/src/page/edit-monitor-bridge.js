/**
 * EditMonitor Bridge - 页面上下文脚本
 *
 * 这个脚本在 Overleaf 的页面上下文中运行，劫持 WebSocket 来捕获编辑事件。
 */

(function() {
  'use strict';

  console.log('[EditMonitorBridge] Initializing...');

  // 保存原始 send 方法
  const originalSend = WebSocket.prototype.send;

  // 劫持 send 方法
  WebSocket.prototype.send = function(data) {
    // 调用原始方法
    const result = originalSend.apply(this, arguments);

    // 解析消息
    try {
      const dataStr = String(data);

      // 只处理包含 JSON 的消息
      const jsonMatch = dataStr.match(/\{.*\}$/);
      if (!jsonMatch) return result;

      const payload = JSON.parse(jsonMatch[0]);

      // 检查是否是编辑事件
      if (payload.name === 'applyOtUpdate' && payload.args) {
        const docId = payload.args[0];
        const updateObject = payload.args[1];
        const ops = updateObject.op;

        console.log('[EditMonitorBridge] 📝 Edit captured:', docId, 'ops:', ops.length);

        // 通过 postMessage 发送给 Content Script
        window.postMessage({
          type: 'OVERLEAF_CC_EDIT_EVENT',
          data: {
            doc_id: docId,
            ops: ops,
            version: updateObject.v
          }
        }, '*');
      }
    } catch (error) {
      // 忽略解析错误
    }

    return result;
  };

  console.log('[EditMonitorBridge] ✅ Ready');
})();
