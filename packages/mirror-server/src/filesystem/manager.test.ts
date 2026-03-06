import fs from 'fs-extra';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileSystemManager } from './manager';

describe('FileSystemManager', () => {
  const testDir = join(tmpdir(), 'overleaf-mirror-fs-test');

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it('should create file with content', async () => {
    const manager = new FileSystemManager(testDir);
    await manager.createFile('main.tex', '\\documentclass{article}');

    const content = await fs.readFile(join(testDir, 'main.tex'), 'utf-8');
    expect(content).toBe('\\documentclass{article}');
  });

  it('should update existing file', async () => {
    const manager = new FileSystemManager(testDir);
    await manager.createFile('main.tex', 'old content');
    await manager.updateFile('main.tex', 'new content');

    const content = await fs.readFile(join(testDir, 'main.tex'), 'utf-8');
    expect(content).toBe('new content');
  });

  it('should delete file', async () => {
    const manager = new FileSystemManager(testDir);
    await manager.createFile('main.tex', 'content');
    await manager.deleteFile('main.tex');

    const exists = await fs.pathExists(join(testDir, 'main.tex'));
    expect(exists).toBe(false);
  });

  it('should rename file', async () => {
    const manager = new FileSystemManager(testDir);
    await manager.createFile('old.tex', 'content');
    await manager.renameFile('old.tex', 'new.tex');

    const oldExists = await fs.pathExists(join(testDir, 'old.tex'));
    const newExists = await fs.pathExists(join(testDir, 'new.tex'));
    expect(oldExists).toBe(false);
    expect(newExists).toBe(true);
  });

  it('should create nested directories', async () => {
    const manager = new FileSystemManager(testDir);
    await manager.createFile('chapters/intro.tex', 'content');

    const exists = await fs.pathExists(join(testDir, 'chapters/intro.tex'));
    expect(exists).toBe(true);
  });

  it('should throw error when creating unsupported file type', async () => {
    const manager = new FileSystemManager(testDir);
    await expect(manager.createFile('test.zip', 'content'))
      .rejects.toThrow('File type not supported for sync');
  });

  it('should throw error when updating non-existent file', async () => {
    const manager = new FileSystemManager(testDir);
    await expect(manager.updateFile('missing.tex', 'content'))
      .rejects.toThrow('File does not exist');
  });

  it('should throw error when reading non-existent file', async () => {
    const manager = new FileSystemManager(testDir);
    await expect(manager.readFile('missing.tex'))
      .rejects.toThrow();
  });

  it('should throw error when renaming non-existent file', async () => {
    const manager = new FileSystemManager(testDir);
    await expect(manager.renameFile('missing.tex', 'new.tex'))
      .rejects.toThrow('Source file does not exist');
  });

  it('should throw error when renaming to unsupported type', async () => {
    const manager = new FileSystemManager(testDir);
    await manager.createFile('old.tex', 'content');
    await expect(manager.renameFile('old.tex', 'new.zip'))
      .rejects.toThrow('File type not supported for sync');
  });

  it('should check file existence', async () => {
    const manager = new FileSystemManager(testDir);
    expect(await manager.fileExists('existing.tex')).toBe(false);

    await manager.createFile('existing.tex', 'content');
    expect(await manager.fileExists('existing.tex')).toBe(true);
  });

  it('should read file content', async () => {
    const manager = new FileSystemManager(testDir);
    await manager.createFile('test.tex', 'content');
    const content = await manager.readFile('test.tex');
    expect(content).toBe('content');
  });
});
