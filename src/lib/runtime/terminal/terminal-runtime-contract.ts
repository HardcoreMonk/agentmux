export interface ITerminalRuntimeCreateInput {
  sessionName: string;
  cols: number;
  rows: number;
  cwd?: string;
}

export interface ITerminalRuntimeSessionRef {
  sessionName: string;
}

export interface ITerminalRuntimeAttachResult extends ITerminalRuntimeSessionRef {
  attached: boolean;
}

export interface ITerminalRuntimeDetachResult extends ITerminalRuntimeSessionRef {
  detached: boolean;
}

export interface ITerminalRuntimeKillResult extends ITerminalRuntimeSessionRef {
  killed: boolean;
}

export interface ITerminalRuntimePresenceResult extends ITerminalRuntimeSessionRef {
  exists: boolean;
}

export interface ITerminalRuntimeWriteResult {
  written: number;
}

export interface ITerminalRuntimeCaptureResult extends ITerminalRuntimeSessionRef {
  content: string;
}

export interface ITerminalRuntimeSendTextResult extends ITerminalRuntimeSessionRef {
  sent: boolean;
}

export interface ITerminalRuntimeResizeResult extends ITerminalRuntimeSessionRef {
  cols: number;
  rows: number;
}

export interface ITerminalRuntimeSessionInfo extends ITerminalRuntimePresenceResult {
  cwd: string | null;
  command: string | null;
  pid: number | null;
  startedAt: number | null;
  metadataSource: 'terminal-runtime' | 'process-inspector' | 'unavailable';
}

export interface ITerminalRuntimeAdapter {
  health(): Promise<unknown>;
  createSession(input: ITerminalRuntimeCreateInput): Promise<ITerminalRuntimeSessionRef>;
  attach(
    sessionName: string,
    cols: number,
    rows: number,
    onData: (data: string) => void,
  ): Promise<ITerminalRuntimeAttachResult>;
  detach(sessionName: string): Promise<ITerminalRuntimeDetachResult>;
  killSession(sessionName: string): Promise<ITerminalRuntimeKillResult>;
  hasSession(sessionName: string): Promise<ITerminalRuntimePresenceResult>;
  writeStdin(sessionName: string, data: string): Promise<ITerminalRuntimeWriteResult>;
  capturePane(sessionName: string): Promise<ITerminalRuntimeCaptureResult>;
  sendText(sessionName: string, text: string, enter: boolean): Promise<ITerminalRuntimeSendTextResult>;
  resize(sessionName: string, cols: number, rows: number): Promise<ITerminalRuntimeResizeResult>;
  getSessionInfo?(sessionName: string): Promise<ITerminalRuntimeSessionInfo>;
}
