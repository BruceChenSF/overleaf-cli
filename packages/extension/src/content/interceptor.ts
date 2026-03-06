/**
 * Fetch API interceptor for Overleaf requests
 */

import type { MirrorClient } from '../client';
import type { APIRequest } from '../shared/types';

interface InterceptorConfig {
  client: MirrorClient;
  projectId: string;
}

export function setupAPIInterceptor(config: InterceptorConfig): void {
  const { client, projectId } = config;

  // Store original fetch
  const originalFetch = window.fetch;

  // Override fetch
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    // Check if this is an Overleaf API request we care about
    if (shouldInterceptRequest(url)) {
      console.log('[Interceptor] Intercepting request:', url);

      try {
        // Forward to mirror server
        const request: APIRequest = {
          url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          method: init?.method || 'GET',
          body: init?.body ? JSON.parse(init.body as string) : undefined,
          headers: init?.headers ? JSON.parse(JSON.stringify(init.headers)) : undefined,
        };

        await client.sendRequest({
          type: 'mirror',
          project_id: projectId,
          api_endpoint: request.url,
          method: request.method,
          data: request.body,
        });

        console.log('[Interceptor] Successfully forwarded to mirror server');
      } catch (error) {
        console.error('[Interceptor] Failed to forward to mirror server:', error);
        // Continue with original request even if forwarding fails
      }
    }

    // Execute original fetch
    return originalFetch(input, init);
  };

  console.log('[Interceptor] Fetch API interception setup complete');
}

function shouldInterceptRequest(url: string): boolean {
  // Intercept file-related API calls
  const fileApiPatterns = [
    '/api/project/',
    '/api/file/',
    '/api/folder/',
    '/api/compile/',
    '/api/downloads/',
  ];

  // Only intercept if URL matches our patterns
  return fileApiPatterns.some(pattern => url.includes(pattern));
}
