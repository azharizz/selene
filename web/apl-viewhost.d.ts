declare module 'apl-viewhost-web' {
  export function initEngine(): Promise<void>;
  export class Content {
    static create(document: string): Content;
    delete(): void;
  }
  export default class APLWASMRenderer {
    static create(options: {content: Content; view: HTMLElement; viewport: {width: number; height: number; dpi: number; isRound: boolean; shape: 'RECTANGLE'}; environment: {agentName: string; agentVersion: string; disallowVideo: boolean; disallowDialog: boolean; disallowEditText: boolean}; theme: string; mode: 'TV'; notLoadFonts: boolean; logLevel: 'error'; onRunTimeError: (errors: object[]) => void; onSendEvent: (event: {arguments: unknown[]}) => void}): APLWASMRenderer;
    init(): Promise<void>;
    executeCommands(commands: string): unknown;
    cancelExecution(): void;
    stopUpdate(): Promise<void>;
    destroy(): void;
  }
}
