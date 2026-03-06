// Mock @overleaf-cc/shared module
jest.mock('@overleaf-cc/shared', () => ({
  EditEventData: {},
  TEXT_FILE_EXTENSIONS: new Set(['.tex', '.bib', '.txt']),
  AnyOperation: {}
}), { virtual: true });
