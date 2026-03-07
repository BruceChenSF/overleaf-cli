import fetch from 'node-fetch';
import { OverleafAPIClient } from './overleaf-client';
import { OverleafAPIError } from './types';

// Mock node-fetch
jest.mock('node-fetch');
const { Response } = jest.requireActual('node-fetch');

describe('OverleafAPIClient', () => {
  let client: OverleafAPIClient;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    const cookies = new Map([['overleaf_session2', 'test-session-token']]);
    client = new OverleafAPIClient(cookies);
    mockFetch = fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockClear();
  });

  describe('getDocContent', () => {
    it('should fetch document content successfully', async () => {
      const mockContent = '\\documentclass{article}';
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ content: mockContent, version: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );

      const content = await client.getDocContent('project-123', 'doc-456');

      expect(content).toBe(mockContent);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain('/project/project-123/doc/doc-456');
    });

    it('should throw on authentication failure', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 })
      );

      await expect(
        client.getDocContent('project-123', 'doc-456')
      ).rejects.toThrow(OverleafAPIError);
    });

    it('should include cookies in request', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ content: '', version: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );

      await client.getDocContent('project-123', 'doc-456');

      const callArgs = mockFetch.mock.calls[0];
      const options = callArgs[1] as RequestInit;
      expect(options.headers).toBeDefined();
      expect((options.headers as Record<string, string>)['Cookie'])
        .toContain('overleaf_session2=test-session-token');
    });
  });

  describe('getProjectFiles', () => {
    it('should fetch project file list', async () => {
      const mockFiles = [
        { _id: 'doc1', name: 'main.tex', path: 'main.tex', type: 'doc' },
        { _id: 'doc2', name: 'refs.bib', path: 'refs.bib', type: 'doc' }
      ];

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockFiles), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );

      const files = await client.getProjectFiles('project-123');

      expect(files).toHaveLength(2);
      expect(files[0].name).toBe('main.tex');
    });
  });
});
