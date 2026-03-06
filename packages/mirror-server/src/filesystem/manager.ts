import fs from 'fs-extra';
import { join } from 'path';
import { shouldSyncFile } from './filter';

export class FileSystemManager {
  constructor(private projectDir: string) {}

  async createFile(path: string, content: string): Promise<void> {
    if (!shouldSyncFile(path)) {
      throw new Error(`File type not supported for sync: ${path}`);
    }

    const fullPath = join(this.projectDir, path);
    await fs.ensureFile(fullPath);
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async updateFile(path: string, content: string): Promise<void> {
    const fullPath = join(this.projectDir, path);
    const exists = await fs.pathExists(fullPath);

    if (!exists) {
      throw new Error(`File does not exist: ${path}`);
    }

    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async readFile(path: string): Promise<string> {
    const fullPath = join(this.projectDir, path);
    const exists = await fs.pathExists(fullPath);

    if (!exists) {
      throw new Error(`File does not exist: ${path}`);
    }

    return await fs.readFile(fullPath, 'utf-8');
  }

  async deleteFile(path: string): Promise<void> {
    const fullPath = join(this.projectDir, path);
    await fs.remove(fullPath);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    if (!shouldSyncFile(newPath)) {
      throw new Error(`File type not supported for sync: ${newPath}`);
    }

    const oldFullPath = join(this.projectDir, oldPath);
    const newFullPath = join(this.projectDir, newPath);

    const exists = await fs.pathExists(oldFullPath);
    if (!exists) {
      throw new Error(`Source file does not exist: ${oldPath}`);
    }

    await fs.move(oldFullPath, newFullPath);
  }

  async fileExists(path: string): Promise<boolean> {
    const fullPath = join(this.projectDir, path);
    return await fs.pathExists(fullPath);
  }

  getProjectDir(): string {
    return this.projectDir;
  }
}
