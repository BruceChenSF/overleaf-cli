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
    // 🔍 调试：记录所有 WebSocket 消息（前几个）
    if (!window.__overleaf_ws_msg_count) {
      window.__overleaf_ws_msg_count = 0;
    }
    if (window.__overleaf_ws_msg_count < 5) {
      console.log('[EditMonitorBridge] 🔍 WebSocket message sent:', String(data).substring(0, 200));
      window.__overleaf_ws_msg_count++;
    }

    // 调用原始方法
    const result = originalSend.apply(this, arguments);

    // 解析消息
    try {
      const dataStr = String(data);

      // 只处理包含 JSON 的消息
      const jsonMatch = dataStr.match(/\{.*\}$/);
      if (!jsonMatch) {
        console.log('[EditMonitorBridge] ⏭️ Skipped: No JSON found in message');
        return result;
      }

      const payload = JSON.parse(jsonMatch[0]);
      console.log('[EditMonitorBridge] 🔍 Parsed payload:', payload.name || '(no name)');

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

        console.log('[EditMonitorBridge] ✅ Edit event sent to content script');
      } else if (payload.name === 'joinDoc' && payload.args) {
        // 🔥 监听 joinDoc 事件 - 当用户点击文件切换文档时触发
        const docId = payload.args[0];
        console.log('[EditMonitorBridge] 📄 joinDoc captured:', docId);

        // 通过 postMessage 发送给 Content Script
        window.postMessage({
          type: 'OVERLEAF_CC_JOIN_DOC',
          data: {
            doc_id: docId
          }
        }, '*');

        console.log('[EditMonitorBridge] ✅ joinDoc event sent to content script');
      } else {
        console.log('[EditMonitorBridge] ⏭️ Skipped: Not an edit event (name:', payload.name, ')');
      }
    } catch (error) {
      console.error('[EditMonitorBridge] ❌ Error parsing message:', error);
    }

    return result;
  };

  console.log('[EditMonitorBridge] ✅ Ready');
})();
