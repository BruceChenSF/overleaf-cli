import { MirrorClient } from '../client';
import { setupAPIInterceptor } from './interceptor';

let mirrorClient: MirrorClient | null = null;

async function initializeMirror(): Promise<void> {
  try {
    const projectId = extractProjectId();
    if (!projectId) {
      console.log('[Mirror] Not a project page, skipping initialization');
      return;
    }

    console.log('[Mirror] Initializing for project:', projectId);

    mirrorClient = new MirrorClient();
    await mirrorClient.connect();

    setupAPIInterceptor({
      client: mirrorClient,
      projectId,
    });

    console.log('[Mirror] Initialization complete');
  } catch (error) {
    console.error('[Mirror] Initialization failed:', error);
  }
}

function extractProjectId(): string | null {
  const urlMatch = window.location.pathname.match(/\/project\/([^/]+)/);
  return urlMatch ? urlMatch[1] : null;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeMirror);
} else {
  initializeMirror();
}

window.addEventListener('beforeunload', () => {
  if (mirrorClient) {
    mirrorClient.disconnect();
  }
});
