import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';
import { AmiActionError, AmiAuthError, AmiConnectionError, AmiTimeoutError } from './errors.js';
import type { KnownEvents } from './events.js';
import { header, headerValues } from './headers.js';
import { AmiParser } from './parser.js';
import { serializeAction } from './serialize.js';
import type {
  AmiAction,
  AmiEvent,
  AmiList,
  AmiMessage,
  AmiResponse,
  CallOptions,
  ConnectionState,
  ManagerOptions,
  WaitOptions,
} from './types.js';

/** Lifecycle events. AMI events use their own names (`Hangup`, `Newchannel`, ...) and `event`. */
export interface ManagerEvents {
  /** Logged in. Fires after the first connect and after every reconnect. */
  ready: [];
  /** The connection dropped. A reconnect follows if it is enabled. */
  disconnect: [error: Error | undefined];
  /** A reconnect is scheduled. */
  reconnecting: [info: { attempt: number; delay: number; error: Error | undefined }];
  /** The client stopped for good: `close()` was called, or reconnecting gave up. */
  close: [error: Error | undefined];
  /** Every AMI event that is not part of a `list()` result. */
  event: [event: AmiEvent];
}

type Listener<K extends keyof ManagerEvents> = (...args: ManagerEvents[K]) => void;

export interface AsteriskManager {
  on<K extends keyof ManagerEvents>(event: K, listener: Listener<K>): this;
  on<K extends keyof KnownEvents>(event: K, listener: (event: KnownEvents[K]) => void): this;
  on(event: string, listener: (event: AmiEvent) => void): this;
  once<K extends keyof ManagerEvents>(event: K, listener: Listener<K>): this;
  once<K extends keyof KnownEvents>(event: K, listener: (event: KnownEvents[K]) => void): this;
  once(event: string, listener: (event: AmiEvent) => void): this;
  off<K extends keyof ManagerEvents>(event: K, listener: Listener<K>): this;
  off<K extends keyof KnownEvents>(event: K, listener: (event: KnownEvents[K]) => void): this;
  off(event: string, listener: (event: AmiEvent) => void): this;
}

interface Pending {
  id: string;
  action: string;
  list: boolean;
  response: AmiResponse | undefined;
  events: AmiEvent[];
  arm(): void;
  resolve(value: AmiResponse | AmiList): void;
  reject(error: unknown): void;
}

interface Queued {
  pending: Pending;
  payload: string;
}

interface Resolved {
  host: string;
  port: number;
  username: string;
  secret: string;
  authType: 'plain' | 'md5';
  events: string;
  tls: tls.ConnectionOptions | undefined;
  actionTimeout: number;
  connectTimeout: number;
  keepAlive: number;
  reconnect: Required<ReconnectSettings> | undefined;
}

interface ReconnectSettings {
  initialDelay: number;
  maxDelay: number;
  factor: number;
  maxAttempts: number;
}

/**
 * Client for the Asterisk Manager Interface.
 *
 * ```ts
 * const ami = new AsteriskManager({ host: 'pbx.local', username: 'app', secret: '...' });
 * ami.on('Hangup', (e) => console.log(e.Channel, e['Cause-txt']));
 * await ami.connect();
 * const { events } = await ami.list({ Action: 'CoreShowChannels' });
 * ```
 */
export class AsteriskManager extends EventEmitter {
  readonly #options: Resolved;
  readonly #parser = new AmiParser();
  readonly #pending = new Map<string, Pending>();
  readonly #prefix = randomBytes(4).toString('hex');
  #queue: Queued[] = [];
  #seq = 0;
  #state: ConnectionState = 'idle';
  #socket: net.Socket | undefined;
  #lastError: Error | undefined;
  #version: string | undefined;
  #connecting: Promise<void> | undefined;
  #greeting: { resolve(): void; reject(error: Error): void } | undefined;
  #closing = false;
  #attempt = 0;
  #reconnectTimer: NodeJS.Timeout | undefined;
  #keepAliveTimer: NodeJS.Timeout | undefined;
  #pinging = false;

  constructor(options: ManagerOptions) {
    super();
    this.#options = resolveOptions(options);
  }

  /** `idle`, `connecting`, `ready`, `reconnecting` or `closed`. */
  get state(): ConnectionState {
    return this.#state;
  }

  /** True when logged in and able to send actions right away. */
  get connected(): boolean {
    return this.#state === 'ready';
  }

  /** AMI protocol version from the greeting, e.g. `11.0.0`. Not the Asterisk version. */
  get version(): string | undefined {
    return this.#version;
  }

  /** Connects and logs in. Rejects with `AmiAuthError` on bad credentials. */
  connect(): Promise<void> {
    if (this.#state === 'ready') return Promise.resolve();
    if (this.#connecting) return this.#connecting;
    if (this.#state === 'reconnecting') return this.#waitReady();

    this.#closing = false;
    this.#state = 'connecting';
    this.#connecting = this.#open()
      .then(
        () => this.#onReady(),
        (error: unknown) => {
          this.#socket?.destroy();
          this.#state = this.#closing ? 'closed' : 'idle';
          this.#rejectQueue(error);
          throw error;
        },
      )
      .finally(() => {
        this.#connecting = undefined;
      });
    return this.#connecting;
  }

  /** Sends `Logoff`, closes the socket and stops reconnecting. Pending actions are rejected. */
  async close(): Promise<void> {
    this.#closing = true;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    const socket = this.#socket;

    if (this.#state === 'ready' && socket) {
      await this.#request({ Action: 'Logoff' }, { timeout: 2000 }, false, true).catch(() => {});
    }
    if (socket && !socket.destroyed) {
      await new Promise<void>((resolve) => {
        socket.once('close', () => resolve());
        socket.end();
        setTimeout(() => socket.destroy(), 2000).unref();
      });
    }
    if (this.#state !== 'closed') this.#finalClose(undefined);
  }

  /**
   * Sends an action and resolves with its response.
   * Rejects with `AmiActionError` when Asterisk answers `Response: Error`.
   * For actions that return a list of events, use `list()`.
   */
  action(action: AmiAction, options?: CallOptions): Promise<AmiResponse> {
    return this.#request(action, options, false, false) as Promise<AmiResponse>;
  }

  /**
   * Sends an action that answers with `EventList: start` and collects every
   * event up to the final `...Complete` event.
   */
  list<E extends AmiEvent = AmiEvent>(action: AmiAction, options?: CallOptions): Promise<AmiList<E>> {
    return this.#request(action, options, true, false) as Promise<AmiList<E>>;
  }

  /** Runs a CLI command (needs the `command` write class) and returns its output. */
  async command(command: string, options?: CallOptions): Promise<string> {
    const response = await this.action({ Action: 'Command', Command: command }, options);
    return headerValues(response, 'Output').join('\n');
  }

  /**
   * Resolves with the next matching event. Rejects on timeout, abort, or when
   * the client closes.
   */
  waitFor<K extends keyof KnownEvents>(
    event: K,
    predicate?: (event: KnownEvents[K]) => boolean,
    options?: WaitOptions,
  ): Promise<KnownEvents[K]>;
  waitFor(event: string, predicate?: (event: AmiEvent) => boolean, options?: WaitOptions): Promise<AmiEvent>;
  waitFor(event: string, predicate?: (event: AmiEvent) => boolean, options: WaitOptions = {}): Promise<AmiEvent> {
    const { timeout, signal } = options;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      let timer: NodeJS.Timeout | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        this.off(event, onEvent);
        this.off('close', onClose);
        signal?.removeEventListener('abort', onAbort);
      };
      const onEvent = (message: AmiEvent) => {
        let matched: boolean;
        try {
          matched = predicate ? predicate(message) : true;
        } catch (error) {
          cleanup();
          return reject(error);
        }
        if (!matched) return;
        cleanup();
        resolve(message);
      };
      const onClose = (error: Error | undefined) => {
        cleanup();
        reject(new AmiConnectionError(`Client closed while waiting for ${event}`, { cause: error }));
      };
      const onAbort = () => {
        cleanup();
        reject(signal?.reason);
      };
      this.on(event, onEvent);
      this.on('close', onClose);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (timeout !== undefined && timeout > 0) {
        timer = setTimeout(() => {
          cleanup();
          reject(new AmiTimeoutError(`No ${event} event within ${timeout} ms`));
        }, timeout);
      }
    });
  }

  #request(action: AmiAction, options: CallOptions = {}, list: boolean, internal: boolean): Promise<AmiResponse | AmiList> {
    return new Promise((resolve, reject) => {
      const { signal } = options;
      if (signal?.aborted) return reject(signal.reason);

      let id: string;
      let payload: string;
      try {
        id = action.ActionID ?? `${this.#prefix}-${++this.#seq}`;
        if (this.#pending.has(id) || this.#queue.some((item) => item.pending.id === id)) {
          throw new Error(`ActionID ${id} is already in use`);
        }
        payload = serializeAction(action, id);
      } catch (error) {
        return reject(error);
      }

      const timeout = options.timeout ?? this.#options.actionTimeout;
      let timer: NodeJS.Timeout | undefined;
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.#pending.delete(id);
        this.#queue = this.#queue.filter((item) => item.pending !== pending);
      };
      const pending: Pending = {
        id,
        action: action.Action,
        list,
        response: undefined,
        events: [],
        arm: () => {
          clearTimeout(timer);
          if (timeout > 0 && Number.isFinite(timeout)) {
            timer = setTimeout(
              () =>
                pending.reject(
                  new AmiTimeoutError(`${action.Action} (ActionID ${id}) got no response within ${timeout} ms`, {
                    action: action.Action,
                    actionId: id,
                  }),
                ),
              timeout,
            );
          }
        },
        resolve: (value) => {
          finish();
          resolve(value);
        },
        reject: (error) => {
          finish();
          reject(error);
        },
      };
      const onAbort = () => pending.reject(signal?.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      pending.arm();

      if (internal || this.#state === 'ready') {
        this.#write(pending, payload);
      } else if (this.#state === 'connecting' || this.#state === 'reconnecting') {
        this.#queue.push({ pending, payload });
      } else {
        pending.reject(new AmiConnectionError('Not connected; call connect() first'));
      }
    });
  }

  #write(pending: Pending, payload: string): void {
    const socket = this.#socket;
    if (!socket || socket.destroyed || !socket.writable) {
      pending.reject(new AmiConnectionError('Not connected'));
      return;
    }
    this.#pending.set(pending.id, pending);
    socket.write(payload);
  }

  async #open(): Promise<void> {
    const { host, port, connectTimeout } = this.#options;
    const tlsOptions = this.#options.tls;
    const socket = tlsOptions
      ? tls.connect({ servername: net.isIP(host) ? undefined : host, ...tlsOptions, host, port })
      : net.connect({ host, port });

    this.#socket = socket;
    this.#parser.reset();
    this.#lastError = undefined;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 15_000);
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.#onData(socket, chunk));
    socket.on('error', (error) => {
      if (socket === this.#socket) this.#lastError = error;
    });
    socket.once('close', () => this.#onClose(socket));

    const greeting = new Promise<void>((resolve, reject) => {
      this.#greeting = { resolve, reject };
    });
    const timer = setTimeout(() => {
      socket.destroy(new AmiConnectionError(`No AMI greeting from ${host}:${port} within ${connectTimeout} ms`));
    }, connectTimeout);
    try {
      await greeting;
    } finally {
      clearTimeout(timer);
      this.#greeting = undefined;
    }
    await this.#login();
  }

  async #login(): Promise<void> {
    const { username, secret, authType, events } = this.#options;
    const login: { Action: string; [header: string]: string } = { Action: 'Login', Username: username, Events: events };
    if (authType === 'md5') {
      const challenge = await this.#request({ Action: 'Challenge', AuthType: 'MD5' }, {}, false, true);
      const value = header(challenge as AmiResponse, 'Challenge') ?? '';
      login.AuthType = 'MD5';
      login.Key = createHash('md5').update(value + secret).digest('hex');
    } else {
      login.Secret = secret;
    }
    try {
      await this.#request(login, {}, false, true);
    } catch (error) {
      if (error instanceof AmiActionError) {
        throw new AmiAuthError(`Login as ${username} failed: ${error.response.Message ?? 'rejected'}`, error.response);
      }
      throw error;
    }
  }

  #onReady(): void {
    this.#state = 'ready';
    this.#attempt = 0;
    this.#startKeepAlive();
    const queued = this.#queue;
    this.#queue = [];
    for (const item of queued) this.#write(item.pending, item.payload);
    this.emit('ready');
  }

  #onData(socket: net.Socket, chunk: string): void {
    if (socket !== this.#socket) return;
    let items;
    try {
      items = this.#parser.push(chunk);
    } catch (error) {
      socket.destroy(error as Error);
      return;
    }
    for (const item of items) {
      if (item.type === 'greeting') {
        this.#version = item.version;
        this.#greeting?.resolve();
      } else {
        this.#greeting?.resolve();
        this.#dispatch(item.message);
      }
    }
  }

  #dispatch(message: AmiMessage): void {
    const actionId = header(message, 'ActionID');
    const pending = actionId === undefined ? undefined : this.#pending.get(actionId);
    const eventName = header(message, 'Event');

    if (eventName !== undefined) {
      if (pending?.list && pending.response) {
        const flag = header(message, 'EventList')?.toLowerCase();
        if (flag === 'complete') {
          pending.resolve({ response: pending.response, events: pending.events, complete: message as AmiEvent });
        } else if (flag === 'cancelled') {
          pending.reject(new AmiActionError(pending.action, { ...message, Response: 'Error', Message: 'List cancelled' }));
        } else {
          pending.events.push(message as AmiEvent);
          pending.arm();
        }
        return;
      }
      this.emit('event', message as AmiEvent);
      this.emit(eventName, message as AmiEvent);
      return;
    }

    const status = header(message, 'Response');
    if (status === undefined || !pending) return;
    const response = message as AmiResponse;

    if (status.toLowerCase() === 'error') {
      pending.reject(new AmiActionError(pending.action, response));
    } else if (!pending.list) {
      pending.resolve(response);
    } else if (header(message, 'EventList')?.toLowerCase() === 'start') {
      pending.response = response;
      pending.arm();
    } else {
      pending.resolve({ response, events: [], complete: undefined });
    }
  }

  #onClose(socket: net.Socket): void {
    if (socket !== this.#socket) return;
    this.#socket = undefined;
    this.#stopKeepAlive();
    this.#parser.reset();

    const cause = this.#lastError;
    this.#lastError = undefined;
    const error = new AmiConnectionError(
      cause ? `Connection to Asterisk closed: ${cause.message}` : 'Connection to Asterisk closed',
      { cause },
    );
    for (const pending of [...this.#pending.values()]) pending.reject(error);
    this.#greeting?.reject(error);

    if (this.#state !== 'ready') return; // connect() or a reconnect attempt handles it
    if (this.#closing) {
      this.#finalClose(undefined);
      return;
    }
    this.emit('disconnect', cause);
    if (this.#options.reconnect) {
      this.#state = 'reconnecting';
      this.#scheduleReconnect(cause);
    } else {
      this.#finalClose(cause ?? error);
    }
  }

  #scheduleReconnect(error: Error | undefined): void {
    const settings = this.#options.reconnect;
    if (!settings || this.#closing) return;
    this.#attempt += 1;
    if (this.#attempt > settings.maxAttempts) {
      this.#finalClose(new AmiConnectionError(`Gave up after ${settings.maxAttempts} reconnect attempts`, { cause: error }));
      return;
    }
    const base = Math.min(settings.maxDelay, settings.initialDelay * settings.factor ** (this.#attempt - 1));
    const delay = Math.round(base / 2 + (Math.random() * base) / 2);
    this.emit('reconnecting', { attempt: this.#attempt, delay, error });

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      if (this.#closing) return;
      this.#open().then(
        () => this.#onReady(),
        (failure: unknown) => {
          this.#socket?.destroy();
          if (this.#closing || this.#state === 'closed') return;
          if (failure instanceof AmiAuthError) {
            this.#finalClose(failure);
            return;
          }
          this.#scheduleReconnect(failure instanceof Error ? failure : undefined);
        },
      );
    }, delay);
  }

  #finalClose(error: Error | undefined): void {
    this.#state = 'closed';
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#stopKeepAlive();
    this.#rejectQueue(new AmiConnectionError('Client closed', { cause: error }));
    this.emit('close', error);
  }

  #rejectQueue(error: unknown): void {
    const queued = this.#queue;
    this.#queue = [];
    for (const item of queued) item.pending.reject(error);
  }

  #waitReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onReady = () => {
        this.off('close', onClose);
        resolve();
      };
      const onClose = (error: Error | undefined) => {
        this.off('ready', onReady);
        reject(error ?? new AmiConnectionError('Client closed'));
      };
      this.once('ready', onReady);
      this.once('close', onClose);
    });
  }

  #startKeepAlive(): void {
    const interval = this.#options.keepAlive;
    if (!interval) return;
    this.#keepAliveTimer = setInterval(() => {
      const socket = this.#socket;
      if (this.#pinging || this.#state !== 'ready' || !socket) return;
      this.#pinging = true;
      this.#request({ Action: 'Ping' }, { timeout: Math.min(interval, this.#options.actionTimeout || interval) }, false, true)
        .catch((error: unknown) => {
          if (error instanceof AmiTimeoutError) {
            socket.destroy(new AmiConnectionError('Keep-alive Ping timed out'));
          }
        })
        .finally(() => {
          this.#pinging = false;
        });
    }, interval);
    this.#keepAliveTimer.unref();
  }

  #stopKeepAlive(): void {
    clearInterval(this.#keepAliveTimer);
    this.#keepAliveTimer = undefined;
    this.#pinging = false;
  }
}

function resolveOptions(options: ManagerOptions): Resolved {
  if (!options || typeof options !== 'object') {
    throw new TypeError('AsteriskManager expects an options object: { host, port, username, secret }');
  }
  if (!options.username) throw new TypeError('username is required');
  if (typeof options.secret !== 'string') throw new TypeError('secret is required');

  const tlsOptions = options.tls === true ? {} : options.tls || undefined;
  const events = options.events ?? true;
  const reconnect = options.reconnect ?? true;

  return {
    host: options.host ?? '127.0.0.1',
    port: options.port ?? (tlsOptions ? 5039 : 5038),
    username: options.username,
    secret: options.secret,
    authType: options.authType ?? 'plain',
    events: events === true ? 'on' : events === false ? 'off' : events.length ? events.join(',') : 'off',
    tls: tlsOptions,
    actionTimeout: options.actionTimeout ?? 10_000,
    connectTimeout: options.connectTimeout ?? 10_000,
    keepAlive: options.keepAlive ?? 30_000,
    reconnect: reconnect
      ? {
          initialDelay: 1000,
          maxDelay: 30_000,
          factor: 2,
          maxAttempts: Number.POSITIVE_INFINITY,
          ...(reconnect === true ? {} : reconnect),
        }
      : undefined,
  };
}
