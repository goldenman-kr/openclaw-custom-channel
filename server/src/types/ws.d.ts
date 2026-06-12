declare module "ws" {
  export class WebSocket {
    static OPEN: number;
    constructor(url: string);
    readyState: number;
    on(event: "open", listener: () => void): this;
    on(event: "message", listener: (data: unknown) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: (code: number, reason: Buffer) => void): this;
    send(data: string): void;
    close(): void;
    terminate(): void;
  }
  const WebSocketDefault: typeof WebSocket;
  export default WebSocketDefault;
}
