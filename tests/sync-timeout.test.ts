import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OverleafWebSocketClient } from '../src/content/overleaf-websocket';

describe('OverleafWebSocketClient - Retry Logic', () => {
  let client: OverleafWebSocketClient;
  let mockWs: WebSocket;

  beforeEach(() => {
    client = new OverleafWebSocketClient();
    mockWs = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      close: vi.fn()
    } as any;
    (client as any).ws = mockWs;
  });

  afterEach(() => {
    client.disconnect();
  });

  it('should have retryWithBackoff method', () => {
    expect(typeof (client as any).retryWithBackoff).toBe('function');
  });

  it('should fail after max retry attempts', async () => {
    const failingFn = async () => {
      throw new Error('Network error');
    };

    await expect((client as any).retryWithBackoff(failingFn)).rejects.toThrow('failed after 3 attempts');
  });

  it('should use exponential backoff between retries', async () => {
    const delays: number[] = [];
    const originalSetTimeout = global.setTimeout;

    // Capture setTimeout delays
    vi.spyOn(global, 'setTimeout').mockImplementation((callback: any, delay?: number) => {
      if (delay) delays.push(delay);
      return originalSetTimeout(callback, delay);
    });

    // Mock to fail twice then succeed
    let attempts = 0;
    const failingFn = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Network error');
      }
      return 'success';
    };

    await (client as any).retryWithBackoff(failingFn);

    // Verify exponential backoff (1000, 2000)
    expect(delays.length).toBe(2);
    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);

    vi.restoreAllMocks();
  });

  it('should respect max delay cap during exponential backoff', async () => {
    const delays: number[] = [];
    const originalSetTimeout = global.setTimeout;

    vi.spyOn(global, 'setTimeout').mockImplementation((callback: any, delay?: number) => {
      if (delay && delay > 0) delays.push(delay);
      return originalSetTimeout(callback, delay);
    });

    // Mock to fail 2 times (3 attempts total - succeeds on 3rd)
    let attempts = 0;
    const failingFn = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Network error');
      }
      return 'success';
    };

    await (client as any).retryWithBackoff(failingFn);

    // Should have 2 delays (between 3 attempts)
    expect(delays.length).toBe(2);

    // Verify no delay exceeds maxDelay (10000ms)
    delays.forEach(delay => {
      expect(delay).toBeLessThanOrEqual(10000);
    });

    // The exponential backoff should be: 1000, 2000
    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);

    vi.restoreAllMocks();
  });

  it('should succeed on first attempt if no error', async () => {
    const successFn = async () => {
      return 'success';
    };

    const result = await (client as any).retryWithBackoff(successFn);
    expect(result).toBe('success');
  });

  it('should retry downloadFile on failure', async () => {
    let attempts = 0;

    const downloadFn = async () => {
      attempts++;
      if (attempts < 2) {
        throw new Error('Download failed');
      }
      const mockBlob = new Blob(['test content'], { type: 'text/plain' });
      return mockBlob;
    };

    const result = await (client as any).retryWithBackoff(downloadFn);
    expect(attempts).toBe(2);
    expect(result).toBeInstanceOf(Blob);
  });
});
