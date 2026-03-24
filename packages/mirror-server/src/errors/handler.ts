import { MirrorError, MirrorErrorType } from './types';

/**
 * Error handling utilities
 */
export class ErrorHandler {
  /**
   * Handle API errors
   */
  static handleAPIError(error: Error, operation: string): void {
    if (error.message.includes('401') || error.message.includes('403')) {
      console.error(`[ErrorHandler] Auth failed for ${operation}`);
      console.error(`[ErrorHandler] Please check your Overleaf session`);
      // TODO: Send notification to browser extension
    } else if (error.message.includes('429')) {
      console.warn(`[ErrorHandler] Rate limited, backing off...`);
      // TODO: Implement backoff retry
    } else {
      console.error(`[ErrorHandler] API error in ${operation}:`, error);
    }
  }

  /**
   * Handle file system errors
   */
  static handleFSError(error: Error, operation: string, path: string): void {
    if (error.message.includes('ENOENT')) {
      console.error(`[ErrorHandler] Path not found: ${path}`);
    } else if (error.message.includes('EACCES')) {
      console.error(`[ErrorHandler] Permission denied: ${path}`);
    } else if (error.message.includes('ENOSPC')) {
      console.error(`[ErrorHandler] Disk full, cannot write to: ${path}`);
    } else {
      console.error(`[ErrorHandler] FS error in ${operation}:`, error);
    }
  }

  /**
   * Handle sync errors
   */
  static handleSyncError(
    error: Error,
    docPath: string,
    ops: any[]
  ): void {
    console.error(`[ErrorHandler] Sync error for ${docPath}`);
    console.error(`[ErrorHandler] Operations:`, JSON.stringify(ops, null, 2));
    console.error(`[ErrorHandler] Error:`, error);

    console.log(`[ErrorHandler] Marking for full re-sync`);
  }

  /**
   * Handle MirrorError instances
   */
  static handleMirrorError(error: MirrorError): void {
    switch (error.type) {
      case MirrorErrorType.API_AUTH_FAILED:
        console.error('[ErrorHandler] Authentication failed:', error.message);
        break;

      case MirrorErrorType.FS_PERMISSION_DENIED:
        console.error('[ErrorHandler] Permission denied:', error.message);
        break;

      case MirrorErrorType.SYNC_INVALID_OP:
        console.error('[ErrorHandler] Invalid operation:', error.message);
        console.error('[ErrorHandler] Details:', error.details);
        break;

      default:
        console.error('[ErrorHandler] Error:', error.message);
    }
  }
}
