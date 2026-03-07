/**
 * Mirror error types
 */
export enum MirrorErrorType {
  // API related
  API_AUTH_FAILED = 'API_AUTH_FAILED',
  API_NETWORK_ERROR = 'API_NETWORK_ERROR',
  API_RATE_LIMIT = 'API_RATE_LIMIT',

  // Filesystem related
  FS_PATH_NOT_FOUND = 'FS_PATH_NOT_FOUND',
  FS_PERMISSION_DENIED = 'FS_PERMISSION_DENIED',
  FS_DISK_FULL = 'FS_DISK_FULL',

  // Sync related
  SYNC_CONFLICT = 'SYNC_CONFLICT',
  SYNC_INVALID_OP = 'SYNC_INVALID_OP',

  // Config related
  CONFIG_INVALID_PATH = 'CONFIG_INVALID_PATH',
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
}

/**
 * Base error class for all Mirror errors
 */
export class MirrorError extends Error {
  constructor(
    public type: MirrorErrorType,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'MirrorError';
  }
}

/**
 * API authentication error
 */
export class AuthFailedError extends MirrorError {
  constructor(details?: any) {
    super(
      MirrorErrorType.API_AUTH_FAILED,
      'Overleaf authentication failed. Please check your session.',
      details
    );
    this.name = 'AuthFailedError';
  }
}

/**
 * File system permission error
 */
export class PermissionDeniedError extends MirrorError {
  constructor(path: string, details?: any) {
    super(
      MirrorErrorType.FS_PERMISSION_DENIED,
      `Permission denied: ${path}`,
      details
    );
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Invalid OT operation error
 */
export class InvalidOperationError extends MirrorError {
  constructor(details?: any) {
    super(
      MirrorErrorType.SYNC_INVALID_OP,
      'Invalid operation in sync',
      details
    );
    this.name = 'InvalidOperationError';
  }
}
