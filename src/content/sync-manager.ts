import type { SyncMode, SyncStatus, ExtensionToBridgeMessage, BridgeToExtensionMessage, FileInfoExtended } from '../shared/types';
import { DiffUtils } from '../shared/diff-utils';
import { stateManager } from './state-manager';

interface SyncFile {
  path: string;
  content: string;
  checksum: string;
}

type EventCallback = (...args: any[]) => void;

export class SyncManager {
  private bridge: any;
  private currentMode: SyncMode = 'auto';
  private isPollingActive = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private pollingMs = 3000;
  private listeners: Map<string, Set<EventCallback>> = new Map();

  constructor(bridge: any) {
    this.bridge = bridge;
  }

  /**
   * Check bridge connection status
   */
  async checkConnection(): Promise<boolean> {
    const connected = this.bridge.isConnected();

    await stateManager.setState({
      connection: {
        ...stateManager.getState().connection,
        bridge: connected ? 'connected' : 'disconnected'
      }
    });

    this.emit('connection:changed', connected ? 'connected' : 'disconnected');

    return connected;
  }

  /**
   * Sync local files to Overleaf (Local → Overleaf)
   */
  async syncToOverleaf(files: SyncFile[]): Promise<void> {
    this.emit('sync:started');
    await this.updateSyncStatus('syncing', files.length);

    const conflicts: any[] = [];
    let successCount = 0;

    try {
      for (const file of files) {
        try {
          // Check current state on Overleaf side
          const statusMsg: ExtensionToBridgeMessage = {
            type: 'GET_FILE_STATUS',
            payload: { path: file.path }
          };

          const response = await this.bridge.sendMessage(statusMsg);

          if (response.type === 'FILE_STATUS') {
            const { checksum: remoteChecksum } = response.payload;

            // If checksums match, no need to sync
            if (remoteChecksum === file.checksum) {
              continue;
            }

            // Check for conflict
            if (remoteChecksum && remoteChecksum !== file.checksum) {
              // Fetch remote content to verify it's a real conflict
              const contentMsg: ExtensionToBridgeMessage = {
                type: 'GET_FILE_CONTENT',
                payload: { path: file.path }
              };

              const contentResponse = await this.bridge.sendMessage(contentMsg);

              if (contentResponse.type === 'FILE_CONTENT') {
                const remoteContent = contentResponse.payload.content;
                const remoteHash = await DiffUtils.hashContent(remoteContent);

                // Real conflict detected
                if (remoteHash !== file.checksum) {
                  conflicts.push({
                    path: file.path,
                    localChecksum: file.checksum,
                    remoteChecksum,
                    localContent: file.content,
                    remoteContent
                  });
                  continue;
                }
              }
            }

            // No conflict, send update
            const updateMsg: ExtensionToBridgeMessage = {
              type: 'SET_FILE_CONTENT',
              payload: {
                path: file.path,
                content: file.content,
                source: 'claude'
              }
            };

            await this.bridge.sendMessage(updateMsg);
            successCount++;
          }
        } catch (error) {
          console.error(`[SyncManager] Failed to sync ${file.path}:`, error);
        }
      }

      // Update final status
      if (conflicts.length > 0) {
        await this.updateSyncStatus('conflict');
        conflicts.forEach(conflict => {
          this.emit('conflict:detected', conflict);
        });
      } else {
        await this.updateSyncStatus('synced');
      }

      this.emit('sync:completed', { successCount, conflicts: conflicts.length });

    } catch (error) {
      console.error('[SyncManager] Sync failed:', error);
      await this.updateSyncStatus('error');
      this.emit('sync:error', error);
    }
  }

  /**
   * Sync files from Overleaf (Overleaf → Local)
   */
  async syncFromOverleaf(): Promise<void> {
    if (!this.bridge.isConnected()) {
      console.warn('[SyncManager] Bridge not connected, skipping sync');
      return;
    }

    try {
      const message: ExtensionToBridgeMessage = {
        type: 'GET_ALL_FILES'
      };

      const response = await this.bridge.sendMessage(message);

      if (response.type === 'ALL_FILES') {
        const files = response.payload;
        this.emit('files:received', files);
      }

    } catch (error) {
      console.error('[SyncManager] Failed to sync from Overleaf:', error);
    }
  }

  /**
   * Start automatic polling
   */
  startPolling(): void {
    if (this.isPollingActive) {
      return;
    }

    // Only poll in auto mode
    if (this.currentMode !== 'auto') {
      return;
    }

    this.isPollingActive = true;

    this.pollingInterval = setInterval(async () => {
      if (this.currentMode === 'auto' && this.bridge.isConnected()) {
        await this.syncFromOverleaf();
      }
    }, this.pollingMs);
  }

  /**
   * Stop automatic polling
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isPollingActive = false;
  }

  /**
   * Check if polling is active
   */
  isPolling(): boolean {
    return this.isPollingActive;
  }

  /**
   * Get current sync mode
   */
  getCurrentMode(): SyncMode {
    return this.currentMode;
  }

  /**
   * Set sync mode
   */
  setMode(mode: SyncMode): void {
    const wasPolling = this.isPollingActive;

    // Stop polling if switching to manual
    if (mode === 'manual' && wasPolling) {
      this.stopPolling();
    }

    this.currentMode = mode;

    // Start polling if switching to auto
    if (mode === 'auto' && !wasPolling) {
      this.startPolling();
    }

    this.emit('mode:changed', mode);
  }

  /**
   * Set polling interval
   */
  setPollingInterval(ms: number): void {
    this.pollingMs = ms;

    // Restart polling if active
    if (this.isPollingActive) {
      this.stopPolling();
      this.startPolling();
    }
  }

  /**
   * Handle task completion event from Claude
   */
  async handleTaskCompletion(message: any): Promise<void> {
    if (message.type === 'TASK_COMPLETE' && message.payload) {
      const { modifiedFiles } = message.payload;

      console.log('[SyncManager] Claude completed task, modified files:', modifiedFiles);

      // Trigger sync from Overleaf to get latest state
      await this.syncFromOverleaf();

      this.emit('task:complete', message.payload);
    }
  }

  /**
   * Update sync status in state manager
   */
  private async updateSyncStatus(status: SyncStatus, pendingChanges?: number): Promise<void> {
    await stateManager.setState({
      sync: {
        ...stateManager.getState().sync,
        status,
        pendingChanges: pendingChanges ?? 0
      }
    });

    this.emit('status:changed', status);
  }

  /**
   * Register event listener
   */
  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  /**
   * Unregister event listener
   */
  off(event: string, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  /**
   * Emit event to all listeners
   */
  protected emit(event: string, ...args: any[]): void {
    this.listeners.get(event)?.forEach(callback => {
      try {
        callback(...args);
      } catch (error) {
        console.error(`[SyncManager] Error in event handler for ${event}:`, error);
      }
    });
  }

  /**
   * Destroy sync manager and cleanup
   */
  destroy(): void {
    this.stopPolling();
    this.listeners.clear();
  }
}
