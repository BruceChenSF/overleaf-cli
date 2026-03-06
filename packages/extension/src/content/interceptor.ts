/**
 * API interceptor for Overleaf requests
 * Intercepts both fetch and XMLHttpRequest
 */

import type { MirrorClient } from '../client';
import type { APIRequest } from '../shared/types';

interface InterceptorConfig {
  client: MirrorClient | null;
  projectId: string;
}

// Global reference to the client (can be updated after connection)
let globalClient: MirrorClient | null = null;
let interceptorSetup = false;

export function setupAPIInterceptor(config: InterceptorConfig): void {
  const { client, projectId } = config;

  // Update global client reference
  if (client) {
    globalClient = client;
    console.log('[Interceptor] Client updated');
  }

  // Only setup interceptors once
  if (interceptorSetup) {
    console.log('[Interceptor] Already setup, skipping');
    return;
  }

  console.log('[Interceptor] Setting up interceptors for project:', projectId);

  // 1. Intercept fetch API
  const originalFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    console.log('[Interceptor] Fetch called:', url.substring(0, 100));

    if (shouldInterceptRequest(url)) {
      console.log('[Interceptor] ✅ Intercepting fetch request:', url);

      // Only forward if we have a client connection
      if (globalClient) {
        try {
          const request: APIRequest = {
            url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
            method: init?.method || 'GET',
            body: init?.body ? JSON.parse(init.body as string) : undefined,
            headers: init?.headers ? JSON.parse(JSON.stringify(init.headers)) : undefined,
          };

          globalClient.sendRequest({
            type: 'mirror',
            project_id: projectId,
            api_endpoint: extractApiEndpoint(request.url),
            method: request.method,
            data: request.body,
          });

          console.log('[Interceptor] Successfully forwarded to mirror server');
        } catch (error) {
          console.error('[Interceptor] Failed to forward to mirror server:', error);
        }
      } else {
        console.log('[Interceptor] No client connection yet, skipping forward');
      }
    }

    return originalFetch(input, init);
  };

  console.log('[Interceptor] Fetch API interception setup');

  // 2. Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: any[]
  ) {
    this._method = method;
    this._url = typeof url === 'string' ? url : url.href;
    return originalOpen.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function (body?: any) {
    const url = this._url as string;

    console.log('[Interceptor] XHR called:', this._method, url.substring(0, 100));

    if (shouldInterceptRequest(url)) {
      console.log('[Interceptor] ✅ Intercepting XHR request:', url);

      if (globalClient) {
        try {
          const request: APIRequest = {
            url: url,
            method: this._method || 'GET',
            body: body ? JSON.parse(body) : undefined,
          };

          globalClient.sendRequest({
            type: 'mirror',
            project_id: projectId,
            api_endpoint: extractApiEndpoint(request.url),
            method: request.method,
            data: request.body,
          });

          console.log('[Interceptor] Successfully forwarded XHR to mirror server');
        } catch (error) {
          console.error('[Interceptor] Failed to forward XHR to mirror server:', error);
        }
      } else {
        console.log('[Interceptor] No client connection yet, skipping XHR forward');
      }
    }

    return originalSend.apply(this, [body] as any);
  };

  interceptorSetup = true;
  console.log('[Interceptor] All interceptors setup complete');
}

function shouldInterceptRequest(url: string): boolean {
  const fileApiPatterns = [
    '/api/project/',
    '/api/file/',
    '/api/folder/',
    '/api/compile/',
    '/api/downloads/',
  ];

  return fileApiPatterns.some(pattern => url.includes(pattern));
}

function extractApiEndpoint(fullUrl: string): string {
  try {
    const urlObj = new URL(fullUrl);
    return urlObj.pathname + urlObj.search;
  } catch {
    return fullUrl;
  }
}
