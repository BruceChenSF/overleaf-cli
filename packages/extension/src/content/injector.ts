import { MirrorClient } from '../client';
import { setupAPIInterceptor } from './interceptor';

let mirrorClient: MirrorClient | null = null;

// Extract project ID immediately (available at document_start)
function extractProjectId(): string | null {
  const urlMatch = window.location.pathname.match(/\/project\/([^/]+)/);
  return urlMatch ? urlMatch[1] : null;
}

const projectId = extractProjectId();
if (!projectId) {
  console.log('[Mirror] Not a project page, skipping');
} else {
  console.log('[Mirror] Project ID:', projectId);

  // CRITICAL: Setup interceptor IMMEDIATELY before any other code runs
  // We pass a placeholder client initially, will be replaced after connection
  console.log('[Mirror] Setting up API interceptor immediately...');

  // Create a temporary interceptor that will queue requests
  setupAPIInterceptor({
    client: null as any, // Will be replaced after connection
    projectId,
  });

  console.log('[Mirror] API interceptor setup complete, waiting for DOM to connect WebSocket');

  // Now wait for DOM to load before connecting WebSocket
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMirror);
  } else {
    // DOM already loaded, initialize immediately
    initializeMirror();
  }
}

async function initializeMirror(): Promise<void> {
  try {
    console.log('[Mirror] Initializing WebSocket connection...');

    mirrorClient = new MirrorClient();
    await mirrorClient.connect();

    // Update interceptor with the real client
    setupAPIInterceptor({
      client: mirrorClient,
      projectId: extractProjectId()!,
    });

    console.log('[Mirror] Initialization complete');
  } catch (error) {
    console.error('[Mirror] Initialization failed:', error);
  }
}

window.addEventListener('beforeunload', () => {
  if (mirrorClient) {
    mirrorClient.disconnect();
  }
});
