declare module "ws" {
  type RawData = string | Buffer | ArrayBuffer | Buffer[];

  interface WebSocketOptions {
    headers?: Record<string, string>;
    handshakeTimeout?: number;
  }

  class WebSocket {
    constructor(address: string, options?: WebSocketOptions);

    send(data: string | Buffer): void;
    close(code?: number, reason?: string): void;

    on(event: "open", listener: () => void): this;
    on(event: "message", listener: (data: RawData) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: (code: number, reason: Buffer) => void): this;
  }

  export { RawData };
  export default WebSocket;
}
