import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';

export type WebSocketMessageHandler = (message: string) => void;

export class WebSocketConnection extends EventEmitter {
  readonly id = randomUUID();
  roomId?: string;
  playerId?: string;
  isAgent?: boolean;

  private readonly socket: Socket;
  private buffer = Buffer.alloc(0);
  private closed = false;

  constructor(socket: Socket, request: IncomingMessage) {
    super();
    this.socket = socket;

    const key = request.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      throw new Error('Missing Sec-WebSocket-Key header.');
    }

    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n')
    );

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this.handleData(chunk));
    socket.on('close', () => this.handleClose());
    socket.on('end', () => this.handleClose());
    socket.on('error', () => this.close(1011, 'socket-error'));
  }

  onMessage(handler: WebSocketMessageHandler): () => void {
    this.on('message', handler);
    return () => this.off('message', handler);
  }

  sendText(message: string): void {
    this.sendFrame(0x1, Buffer.from(message, 'utf8'));
  }

  sendJson(value: unknown): void {
    this.sendText(JSON.stringify(value));
  }

  close(code = 1000, reason = 'normal'): void {
    if (this.closed) return;
    this.closed = true;

    const reasonBuffer = Buffer.from(reason, 'utf8');
    const payload = Buffer.alloc(2 + Math.min(reasonBuffer.length, 123));
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2, 0, payload.length - 2);

    this.sendFrame(0x8, payload);
    this.socket.end();
    this.emit('close');
  }

  isOpen(): boolean {
    return !this.closed && !this.socket.destroyed;
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  private handleData(chunk: Buffer): void {
    if (this.closed) return;

    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];
      const fin = (firstByte & 0x80) !== 0;
      const opcode = firstByte & 0x0f;
      const masked = (secondByte & 0x80) !== 0;
      let length = secondByte & 0x7f;
      let offset = 2;

      if (!masked) {
        this.close(1002, 'client-frame-must-be-masked');
        return;
      }

      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        const extended = this.buffer.readBigUInt64BE(offset);
        if (extended > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.close(1009, 'frame-too-large');
          return;
        }
        length = Number(extended);
        offset += 8;
      }

      if (this.buffer.length < offset + 4 + length) return;

      const mask = this.buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = this.buffer.subarray(offset, offset + length);
      const unmasked = Buffer.allocUnsafe(length);

      for (let index = 0; index < length; index += 1) {
        unmasked[index] = payload[index] ^ mask[index % 4];
      }

      this.buffer = this.buffer.subarray(offset + length);

      if (!fin && opcode !== 0x0) {
        this.close(1003, 'fragmented-frames-are-not-supported');
        return;
      }

      if (opcode === 0x8) {
        this.close(1000, 'client-close');
        return;
      }

      if (opcode === 0x9) {
        this.sendFrame(0xA, unmasked);
        continue;
      }

      if (opcode !== 0x1) {
        continue;
      }

      this.emit('message', unmasked.toString('utf8'));
    }
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    if (this.socket.destroyed) return;

    const header: number[] = [];
    header.push(0x80 | (opcode & 0x0f));

    if (payload.length < 126) {
      header.push(payload.length);
    } else if (payload.length <= 0xffff) {
      header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff);
    } else {
      const extended = Buffer.allocUnsafe(8);
      extended.writeBigUInt64BE(BigInt(payload.length));
      header.push(127, ...extended);
    }

    this.socket.write(Buffer.concat([Buffer.from(header), payload]));
  }
}
