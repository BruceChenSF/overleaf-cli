import fs from 'fs-extra';
import { join, dirname } from 'path';
import { homedir } from 'os';
import {
  ProjectConfig,
  GlobalConfig,
  ProjectConfigNotFoundError
} from './types';

const CONFIG_FILE = 'config.json';
const CONFIG_VERSION = '1.0.0';

export class ProjectConfigStore {
  private configPath: string;
  private config: GlobalConfig;

  constructor(baseDir: string = join(homedir(), '.overleaf-mirror')) {
    this.configPath = join(baseDir, CONFIG_FILE);
    this.config = this.loadOrCreate();
  }

  /**
   * Get project configuration, creating default if not exists
   */
  getProjectConfig(projectId: string): ProjectConfig {
    if (!this.config.projects[projectId]) {
      // Create default config
      const defaultPath = join(this.config.defaultMirrorDir, projectId);
      this.config.projects[projectId] = {
        projectId,
        localPath: defaultPath,
        createdAt: Date.now(),
        lastSyncAt: 0,
        syncBinaryFiles: false
      };
    }

    return this.config.projects[projectId];
  }

  /**
   * Set custom path for a project
   */
  async setProjectPath(projectId: string, localPath: string): Promise<void> {
    const config = this.getProjectConfig(projectId);
    config.localPath = localPath;

    // Ensure directory exists
    await fs.ensureDir(localPath);

    await this.save();
  }

  /**
   * Update last sync timestamp
   */
  async updateLastSync(projectId: string): Promise<void> {
    const config = this.getProjectConfig(projectId);
    config.lastSyncAt = Date.now();

    await this.save();
  }

  /**
   * List all configured projects
   */
  listProjects(): ProjectConfig[] {
    return Object.values(this.config.projects);
  }

  /**
   * Load existing config or create new one
   */
  private loadOrCreate(): GlobalConfig {
    if (fs.pathExistsSync(this.configPath)) {
      try {
        const data = fs.readJsonSync(this.configPath);
        return data;
      } catch (error) {
        console.warn(`Failed to load config, creating new one: ${error}`);
      }
    }

    // Create default config
    return {
      version: CONFIG_VERSION,
      defaultMirrorDir: join(homedir(), 'overleaf-mirror'),
      projects: {}
    };
  }

  /**
   * Persist configuration to disk
   */
  async save(): Promise<void> {
    await fs.ensureDir(dirname(this.configPath));
    await fs.writeJson(this.configPath, this.config, { spaces: 2 });
  }
}
