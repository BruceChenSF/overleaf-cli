import fs from 'fs-extra';
import { join } from 'path';
import type { ProjectState, PendingSyncTask } from '../types';

const STATE_FILENAME = '.overleaf-state.json';

export class StateManager {
  private statePath: string;
  private state: ProjectState | null = null;

  constructor(
    private projectDir: string,
    private projectId: string
  ) {
    this.statePath = join(projectDir, STATE_FILENAME);
  }

  async initialize(): Promise<void> {
    const exists = await fs.pathExists(this.statePath);

    if (!exists) {
      this.state = {
        projectId: this.projectId,
        lastSync: Date.now(),
        localVersion: {},
        remoteVersion: {},
        pendingSync: [],
      };
      await this.save();
    } else {
      await this.load();
    }
  }

  async load(): Promise<ProjectState> {
    if (!this.state) {
      const content = await fs.readFile(this.statePath, 'utf-8');
      this.state = JSON.parse(content);
    }
    return this.state!;
  }

  private async save(): Promise<void> {
    if (!this.state) {
      throw new Error('State not initialized');
    }
    await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2));
  }

  async updateLocalVersion(path: string, version: string): Promise<void> {
    const state = await this.load();
    state.localVersion[path] = version;
    await this.save();
  }

  async updateRemoteVersion(path: string, version: string): Promise<void> {
    const state = await this.load();
    state.remoteVersion[path] = version;
    await this.save();
  }

  async getLocalVersion(path: string): Promise<string | undefined> {
    const state = await this.load();
    return state.localVersion[path];
  }

  async getRemoteVersion(path: string): Promise<string | undefined> {
    const state = await this.load();
    return state.remoteVersion[path];
  }

  async hasConflict(path: string): Promise<boolean> {
    const local = await this.getLocalVersion(path);
    const remote = await this.getRemoteVersion(path);
    return local !== undefined && remote !== undefined && local !== remote;
  }

  async addPendingSync(task: PendingSyncTask): Promise<void> {
    const state = await this.load();
    state.pendingSync.push(task);
    await this.save();
  }

  async getPendingSync(): Promise<PendingSyncTask[]> {
    const state = await this.load();
    return state.pendingSync;
  }

  async removePendingSync(index: number): Promise<void> {
    const state = await this.load();
    state.pendingSync.splice(index, 1);
    await this.save();
  }

  async updateLastSync(): Promise<void> {
    const state = await this.load();
    state.lastSync = Date.now();
    await this.save();
  }
}
