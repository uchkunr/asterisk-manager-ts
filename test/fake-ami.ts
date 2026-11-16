import { createHash } from 'node:crypto';
import net from 'node:net';

export type Headers = Record<string, string[]>;

export interface Session {
  socket: net.Socket;
  send(lines: Record<string, string> | string): void;
  authenticated: boolean;
}

type Handler = (headers: Headers, session: Session, id: string) => void;

/** Minimal AMI server that behaves like Asterisk's manager.c for the actions tests need. */
export class FakeAmi {
  readonly received: Headers[] = [];
  readonly raw: string[] = [];
  readonly sessions: Session[] = [];
  readonly handlers = new Map<string, Handler>();
  greeting = 'Asterisk Call Manager/11.0.0';
  username = 'admin';
  secret = 'secret';
  challenge = '123456789';
  #server = net.createServer((socket) => this.#accept(socket));

  constructor() {
    this.on('login', (h, s) => {
      const user = first(h, 'username');
      let ok = user === this.username;
      if (first(h, 'authtype')?.toLowerCase() === 'md5') {
        const key = createHash('md5').update(this.challenge + this.secret).digest('hex');
        ok &&= first(h, 'key') === key;
      } else {
        ok &&= first(h, 'secret') === this.secret;
      }
      if (!ok) {
        s.send({ Response: 'Error', ActionID: first(h, 'actionid') ?? '', Message: 'Authentication failed' });
        s.socket.end();
        return;
      }
      s.authenticated = true;
      s.send({ Response: 'Success', ActionID: first(h, 'actionid') ?? '', Message: 'Authentication accepted' });
      s.send({ Event: 'FullyBooted', Privilege: 'system,all', Uptime: '10', LastReload: '10', Status: 'Fully Booted' });
    });
    this.on('challenge', (h, s, id) => {
      s.send(`Response: Success\r\nActionID: ${id}\r\nChallenge: ${this.challenge}\r\n\r\n`);
    });
    this.on('ping', (_h, s, id) => {
      s.send({ Response: 'Success', ActionID: id, Ping: 'Pong', Timestamp: '1763284426.000000' });
    });
    this.on('logoff', (_h, s, id) => {
      s.send({ Response: 'Goodbye', ActionID: id, Message: 'Thanks for all the fish.' });
      s.socket.end();
    });
  }

  on(action: string, handler: Handler): this {
    this.handlers.set(action.toLowerCase(), handler);
    return this;
  }

  listen(): Promise<number> {
    return new Promise((resolve) => {
      this.#server.listen(0, '127.0.0.1', () => resolve((this.#server.address() as net.AddressInfo).port));
    });
  }

  close(): Promise<void> {
    for (const s of this.sessions) s.socket.destroy();
    return new Promise((resolve) => this.#server.close(() => resolve()));
  }

  /** Drops every open connection without a Logoff, like a restart or network failure. */
  dropAll(): void {
    for (const s of this.sessions) s.socket.destroy();
  }

  get last(): Session {
    const session = this.sessions.at(-1);
    if (!session) throw new Error('no session');
    return session;
  }

  #accept(socket: net.Socket): void {
    const session: Session = {
      socket,
      authenticated: false,
      send: (lines) => {
        if (socket.destroyed) return;
        socket.write(
          typeof lines === 'string'
            ? lines
            : Object.entries(lines)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\r\n') + '\r\n\r\n',
        );
      },
    };
    this.sessions.push(session);
    if (this.greeting) socket.write(this.greeting + '\r\n');
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\r\n\r\n')) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 4);
        this.raw.push(block);
        const headers: Headers = {};
        for (const line of block.split('\r\n')) {
          const colon = line.indexOf(':');
          const key = line.slice(0, colon).toLowerCase();
          (headers[key] ??= []).push(line.slice(colon + 1).trimStart());
        }
        this.received.push(headers);
        const action = first(headers, 'action')?.toLowerCase() ?? '';
        const id = first(headers, 'actionid') ?? '';
        if (!session.authenticated && action !== 'login' && action !== 'challenge') {
          session.send({ Response: 'Error', ActionID: id, Message: 'Permission denied' });
          continue;
        }
        const handler = this.handlers.get(action);
        if (handler) handler(headers, session, id);
        else
          session.send({
            Response: 'Error',
            ActionID: id,
            Message: `Invalid/unknown command: ${first(headers, 'action')}. Use Action: ListCommands to show available commands.`,
          });
      }
    });
  }
}

export function first(headers: Headers, name: string): string | undefined {
  return headers[name]?.[0];
}
