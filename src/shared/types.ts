// Message types for extension communication
export type ExtensionMessage = OpenTerminalMessage | TerminalReadyMessage;

export interface OpenTerminalMessage {
  type: 'OPEN_TERMINAL';
  projectId: string;
  projectUrl: string;
  csrfToken: string;
}

export interface TerminalReadyMessage {
  type: 'TERMINAL_READY';
  windowId: number;
}
