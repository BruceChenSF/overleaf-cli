console.log('[Background] Overleaf Mirror extension loaded');

// Store project ID from content script via message
let currentProjectId: string | null = null;

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SET_PROJECT_ID') {
    currentProjectId = message.projectId;
    console.log('[Background] Project ID:', currentProjectId);
    sendResponse({ success: true });
  }
});

// Intercept API requests using webRequest API
// This runs at browser level, before page scripts can execute
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Only intercept POST/PUT/DELETE requests to API endpoints
    if (['POST', 'PUT', 'DELETE'].includes(details.method)) {
      const url = details.url;

      // Check if this is an API request we care about
      if (shouldInterceptRequest(url)) {
        console.log('[Background] Intercepted:', details.method, url.substring(0, 80));

        // Extract project ID from URL if we don't have it
        const urlProjectId = extractProjectIdFromUrl(url);
        const projectId = currentProjectId || urlProjectId;

        if (projectId) {
          // Forward request info to local mirror server
          forwardToMirrorServer({
            url,
            method: details.method,
            projectId,
            requestBody: details.requestBody
          }).catch((error) => {
            console.error('[Background] Failed to forward to mirror server:', error);
          });
        }
      }
    }

    // Important: Return undefined to let the request continue normally
    // We're only observing/sending copy, not blocking
  },
  {
    urls: [
      'https://*.overleaf.com/project/*/doc*',
      'https://*.cn.overleaf.com/project/*/doc*',
      'https://*.overleaf.com/project/*/file*',
      'https://*.cn.overleaf.com/project/*/file*',
      'https://*.overleaf.com/project/*/folder*',
      'https://*.cn.overleaf.com/project/*/folder*',
      // Also keep /api/ endpoints in case they exist
      'https://*.overleaf.com/api/project/*',
      'https://*.cn.overleaf.com/api/project/*',
      'https://*.overleaf.com/api/file/*',
      'https://*.cn.overleaf.com/api/file/*',
      'https://*.overleaf.com/api/folder/*',
      'https://*.cn.overleaf.com/api/folder/*',
    ]
  },
  ['requestBody'] // Include request body in details
);

console.log('[Background] webRequest listener registered');

function shouldInterceptRequest(url: string): boolean {
  const apiPatterns = [
    '/project/',  // Main pattern (e.g., /project/xxx/doc)
    '/api/project/',
    '/api/file/',
    '/api/folder/',
    '/api/compile/',
    '/api/downloads/',
  ];

  return apiPatterns.some(pattern => url.includes(pattern));
}

function extractProjectIdFromUrl(url: string): string | null {
  // Extract project ID from URLs like:
  // https://cn.overleaf.com/project/69a6f132d255a33e681501a5/doc
  // https://cn.overleaf.com/api/project/69a6f132d255a33e681501a5/doc
  const match1 = url.match(/\/project\/([^\/]+)/);
  const match2 = url.match(/\/api\/project\/([^\/]+)/);
  return match1 ? match1[1] : (match2 ? match2[1] : null);
}

async function forwardToMirrorServer(data: {
  url: string;
  method: string;
  projectId: string;
  requestBody?: chrome.webRequest.UploadData[];
}): Promise<void> {
  const { url, method, projectId, requestBody } = data;

  // Extract API endpoint (pathname + search)
  let apiEndpoint: string;
  try {
    const urlObj = new URL(url);
    apiEndpoint = urlObj.pathname + urlObj.search;
  } catch {
    apiEndpoint = url;
  }

  // Parse request body if present
  let body: any;
  if (requestBody && requestBody.length > 0) {
    try {
      const requestBodyItem = requestBody[0];
      if (requestBodyItem.bytes) {
        // If body is bytes, decode it
        const decoder = new TextDecoder();
        body = JSON.parse(decoder.decode(requestBodyItem.bytes));
      } else if (requestBodyItem.file) {
        // If body is a file (upload), skip for now
        body = null;
      } else if (typeof requestBodyItem.raw === 'string') {
        body = JSON.parse(requestBodyItem.raw);
      } else {
        body = null;
      }
    } catch (error) {
      console.error('[Background] Failed to parse request body:', error);
      body = null;
    }
  }

  // Send to local mirror server via HTTP API
  try {
    const response = await fetch('http://localhost:3456/api/mirror', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'mirror',
        project_id: projectId,
        api_endpoint: apiEndpoint,
        method: method,
        data: body,
        timestamp: Date.now()
      })
    });

    if (!response.ok) {
      console.warn('[Background] Mirror server returned:', response.status);
    } else {
      console.log('[Background] ✅ Successfully forwarded to mirror server');
    }
  } catch (error) {
    console.error('[Background] Failed to send to mirror server:', error);
  }
}
