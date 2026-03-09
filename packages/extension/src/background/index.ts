console.log('[Background] Overleaf Mirror extension loaded');

// Store project ID from content script via message
let currentProjectId: string | null = null;

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SET_PROJECT_ID') {
    currentProjectId = message.projectId;
    console.log('[Background] Project ID:', currentProjectId);
    sendResponse({ success: true });
  } else if (message.type === 'GET_COOKIES') {
    // 🔧 获取 cookies 请求
    console.log('[Background] 🍪 Received GET_COOKIES request for:', message.url);

    // 直接使用 url 参数获取 cookies（更可靠）
    chrome.cookies.getAll({ url: message.url }, (cookies) => {
      if (chrome.runtime.lastError) {
        console.error('[Background] ❌ Error getting cookies:', chrome.runtime.lastError);
        sendResponse({ cookies: [] });
      } else {
        console.log('[Background] 🍪 Found', cookies?.length || 0, 'cookies');
        if (cookies && cookies.length > 0) {
          console.log('[Background] 🍪 Cookie names:', cookies.map(c => c.name).join(', '));
        }
        sendResponse({ cookies: cookies || [] });
      }
    });

    // 返回 true 表示异步响应
    return true;
  }
});

console.log('[Background] ✅ Background script loaded');
