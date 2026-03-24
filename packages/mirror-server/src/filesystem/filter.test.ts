import { shouldSyncFile, SYNCABLE_EXTENSIONS } from './filter';

describe('File Extension Filter', () => {
  it('should allow text files', () => {
    expect(shouldSyncFile('main.tex')).toBe(true);
    expect(shouldSyncFile('references.bib')).toBe(true);
    expect(shouldSyncFile('README.md')).toBe(true);
  });

  it('should allow image files', () => {
    expect(shouldSyncFile('figure1.png')).toBe(true);
    expect(shouldSyncFile('diagram.jpg')).toBe(true);
    expect(shouldSyncFile('plot.pdf')).toBe(true);
  });

  it('should reject archive files', () => {
    expect(shouldSyncFile('data.zip')).toBe(false);
    expect(shouldSyncFile('backup.tar.gz')).toBe(false);
  });

  it('should reject office documents', () => {
    expect(shouldSyncFile('notes.docx')).toBe(false);
    expect(shouldSyncFile('data.xlsx')).toBe(false);
  });

  it('should be case insensitive', () => {
    expect(shouldSyncFile('MAIN.TEX')).toBe(true);
    expect(shouldSyncFile('Figure1.PNG')).toBe(true);
  });

  it('should handle files without extension', () => {
    expect(shouldSyncFile('Makefile')).toBe(false);
    expect(shouldSyncFile('.gitignore')).toBe(false);
  });
});
