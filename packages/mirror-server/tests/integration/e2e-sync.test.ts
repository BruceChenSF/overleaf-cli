import { TestServer } from './test-server';
import type { MirrorRequestMessage } from '../../src/types';

describe('E2E: Mirror Communication', () => {
  let testServer: TestServer;
  let ws: WebSocket;

  beforeAll(async () => {
    testServer = new TestServer();
    ws = await testServer.connect();
  });

  afterAll(async () => {
    ws.close();
    await testServer.close();
  });

  it('should receive mirror request from client', (done) => {
    const message: MirrorRequestMessage = {
      type: 'mirror',
      project_id: 'test-project',
      api_endpoint: '/project/test/doc',
      method: 'POST',
      data: { content: 'test content' },
    };

    ws.send(JSON.stringify(message));

    setTimeout(() => {
      done();
    }, 100);
  });
});
