import { AnyOperation } from '../shared-types';

/**
 * Result of applying operations
 */
export interface OpResult {
  success: boolean;
  error?: string;
  opsApplied: number;
}

/**
 * Document state cache entry
 */
export interface DocCacheEntry {
  content: string;
  version: number;
  lastUpdated: number;
}
