export interface BridgeMessage {
  type: 'auth' | 'command' | 'response' | 'sync';
  data: unknown;
}

export interface AuthMessage {
  type: 'auth';
  data: {
    projectId: string;
    sessionCookie: string;
    domain: 'overleaf.com' | 'cn.overleaf.com';
  };
}

export interface CommandMessage {
  type: 'command';
  data: {
    command: string;
    args: string[];
  };
}

export interface ResponseMessage {
  type: 'response';
  data: {
    success: boolean;
    output?: string;
    error?: string;
  };
}
