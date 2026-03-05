import { v4 as uuidv4 } from 'uuid';
import type { ErrorRecord, ErrorContext } from '../shared/types';
import { stateManager } from './state-manager';

export class ErrorHandler {
  private errorLog: ErrorRecord[] = [];
  private maxLogSize = 100;

  /**
   * Handle an error
   */
  handleError(error: Error | string, context: ErrorContext): void {
    const errorRecord: ErrorRecord = {
      id: uuidv4(),
      message: typeof error === 'string' ? error : error.message,
      stack: typeof error === 'string' ? undefined : error.stack,
      context,
      timestamp: Date.now()
    };

    // Log error
    this.logError(errorRecord);

    // Dispatch based on error type
    this.dispatchError(errorRecord);
  }

  /**
   * Log error to internal log
   */
  private logError(record: ErrorRecord): void {
    this.errorLog.push(record);

    // Limit log size
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize);
    }

    // Also log to console
    console.error(`[ErrorHandler] ${record.context.category}:`, record.message, record.context);
  }

  /**
   * Dispatch error handling based on category
   */
  private dispatchError(record: ErrorRecord): void {
    const { category } = record.context;

    switch (category) {
      case 'connection':
        this.handleConnectionError(record);
        break;

      case 'sync':
        this.handleSyncError(record);
        break;

      case 'file':
        this.handleFileError(record);
        break;

      default:
        this.handleGenericError(record);
    }
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(record: ErrorRecord): void {
    stateManager.setState({
      connection: {
        bridge: 'error',
        websocket: 'disconnected',
        lastError: record.message
      }
    });

    // TODO: Show notification to user (will be implemented with notification system)
    console.warn('Connection error:', record.message);
  }

  /**
   * Handle sync errors
   */
  private handleSyncError(record: ErrorRecord): void {
    stateManager.setState({
      sync: {
        ...stateManager.getState().sync,
        status: 'error'
      }
    });

    console.error('Sync error:', record.message);
  }

  /**
   * Handle file operation errors
   */
  private handleFileError(record: ErrorRecord): void {
    console.error('File operation error:', record.message);
  }

  /**
   * Handle generic errors
   */
  private handleGenericError(record: ErrorRecord): void {
    console.error('Error:', record.message);
  }

  /**
   * Get error log
   */
  getErrors(limit?: number): ErrorRecord[] {
    return limit ? this.errorLog.slice(-limit) : [...this.errorLog];
  }

  /**
   * Clear error log
   */
  clearErrors(): void {
    this.errorLog = [];
  }
}

// Export singleton
export const errorHandler = new ErrorHandler();
