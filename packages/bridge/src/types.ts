export interface BridgeMessage {
  type: 'auth' | 'command' | 'response' | 'EXTENSION_MESSAGE';
  data: unknown;
  messageId?: string;
}

export interface AuthMessage {
  type: 'auth';
  data: {
    projectId: string;
    csrfToken: string;
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
