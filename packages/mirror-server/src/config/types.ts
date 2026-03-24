/**
 * Project configuration stored in config file
 */
export interface ProjectConfig {
  /** Overleaf project ID */
  projectId: string;
  /** Project name (optional, from Overleaf) */
  projectName?: string;
  /** Local filesystem path for this project */
  localPath: string;
  /** Unix timestamp when config was created */
  createdAt: number;
  /** Unix timestamp of last sync */
  lastSyncAt: number;
  /** Whether to sync binary files (.pdf, .png, etc.) */
  syncBinaryFiles: boolean;
  /** Whether to enable file sync (default: false) */
  enableFileSync?: boolean;
}

/**
 * Global configuration structure
 */
export interface GlobalConfig {
  /** Config file format version */
  version: string;
  /** Default base directory for projects */
  defaultMirrorDir: string;
  /** All project configurations keyed by projectId */
  projects: Record<string, ProjectConfig>;
}

/** Error thrown when project config not found */
export class ProjectConfigNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project configuration not found: ${projectId}`);
    this.name = 'ProjectConfigNotFoundError';
  }
}
