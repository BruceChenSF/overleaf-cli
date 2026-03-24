export interface BridgeMessage {
  type: 'auth' | 'command' | 'response' | 'EXTENSION_MESSAGE' |
        'GET_ALL_FILES' | 'GET_FILE_CONTENT' | 'SET_FILE_CONTENT' | 'GET_FILE_STATUS' |
        'FILE_CHANGED' | 'FILE_DELETED' | 'FILE_CREATED';
  data: unknown;
  messageId?: string;
  requestId?: string;
  payload?: unknown;
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
  requestId?: string;
}
