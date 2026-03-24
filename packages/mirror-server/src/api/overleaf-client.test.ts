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

    it('should throw on authentication failure (401)', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 })
      );

      await expect(
        client.getDocContent('project-123', 'doc-456')
      ).rejects.toThrow(OverleafAPIError);
    });

    it('should throw on 403 forbidden error', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Forbidden', { status: 403 })
      );

      await expect(
        client.getDocContent('project-123', 'doc-456')
      ).rejects.toThrow(OverleafAPIError);
    });

    it('should throw on malformed JSON response', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('not valid json', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );

      await expect(
        client.getDocContent('project-123', 'doc-456')
      ).rejects.toThrow(OverleafAPIError);
    });

    it('should throw when response is missing content field', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ version: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );

      await expect(
        client.getDocContent('project-123', 'doc-456')
      ).rejects.toThrow(OverleafAPIError);
    });

    it('should throw on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        client.getDocContent('project-123', 'doc-456')
      ).rejects.toThrow('Network error');
    });

    it('should throw on invalid projectId parameter', async () => {
      await expect(
        client.getDocContent('', 'doc-456')
      ).rejects.toThrow('projectId must be a non-empty string');
    });

    it('should throw on invalid docId parameter', async () => {
      await expect(
        client.getDocContent('project-123', '')
      ).rejects.toThrow('docId must be a non-empty string');
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

    it('should throw on invalid projectId parameter', async () => {
      await expect(
        client.getProjectFiles('')
      ).rejects.toThrow('projectId must be a non-empty string');
    });
  });

  describe('getFileContent', () => {
    it('should fetch file content successfully', async () => {
      const mockBuffer = Buffer.from('test file content');
      mockFetch.mockResolvedValueOnce(
        new Response(mockBuffer, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' }
        })
      );

      const content = await client.getFileContent('project-123', 'image.png');

      expect(content).toEqual(mockBuffer);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should URL-encode file path', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(Buffer.from('test'), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' }
        })
      );

      await client.getFileContent('project-123', 'folder with spaces/image.png');

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain(encodeURIComponent('folder with spaces/image.png'));
    });

    it('should throw on invalid projectId parameter', async () => {
      await expect(
        client.getFileContent('', 'image.png')
      ).rejects.toThrow('projectId must be a non-empty string');
    });

    it('should throw on invalid path parameter', async () => {
      await expect(
        client.getFileContent('project-123', '')
      ).rejects.toThrow('path must be a non-empty string');
    });

    it('should throw on fetch error', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Not found', { status: 404 })
      );

      await expect(
        client.getFileContent('project-123', 'image.png')
      ).rejects.toThrow(OverleafAPIError);
    });
  });
});
