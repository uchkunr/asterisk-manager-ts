import type { ConnectionOptions } from 'node:tls';

/** A header value. A header that appears more than once becomes an array. */
export type AmiHeaderValue = string | string[];

/** Any message from Asterisk. Header names keep the case Asterisk sent. */
export interface AmiMessage {
  readonly [header: string]: AmiHeaderValue | undefined;
}

/** A reply to an action. */
export interface AmiResponse extends AmiMessage {
  readonly Response: string;
  readonly ActionID?: string;
  readonly Message?: string;
}

/** An asynchronous event. */
export interface AmiEvent extends AmiMessage {
  readonly Event: string;
  readonly Privilege?: string;
  readonly ActionID?: string;
}

export type AmiScalar = string | number | boolean;

/**
 * A value you can send in an action header.
 *
 * - `undefined` and `null` skip the header.
 * - An array sends the header once per item.
 * - An object sends one `Header: name=value` line per entry. Use it for
 *   `Variable` on Originate and similar actions; commas, quotes, brackets and
 *   backslashes in values are escaped so Asterisk does not split them.
 */
export type AmiActionValue =
  | AmiScalar
  | null
  | undefined
  | readonly AmiScalar[]
  | Readonly<Record<string, AmiScalar>>;

/** An action to send. `Action` is required; any other header is allowed. */
export interface AmiAction {
  readonly Action: string;
  readonly ActionID?: string;
  readonly [header: string]: AmiActionValue;
}

/** Event classes from manager.conf. Use them in the `events` option. */
export type EventClass =
  | 'system'
  | 'call'
  | 'log'
  | 'verbose'
  | 'command'
  | 'agent'
  | 'user'
  | 'config'
  | 'dtmf'
  | 'reporting'
  | 'cdr'
  | 'dialplan'
  | 'originate'
  | 'agi'
  | 'cc'
  | 'aoc'
  | 'test'
  | 'security'
  | 'message'
  | 'all'
  | (string & {});

export interface ReconnectOptions {
  /** First delay in ms. Default 1000. */
  initialDelay?: number;
  /** Largest delay in ms. Default 30000. */
  maxDelay?: number;
  /** Multiplier per attempt. Default 2. */
  factor?: number;
  /** Give up after this many failed attempts. Default Infinity. */
  maxAttempts?: number;
}

export interface ManagerOptions {
  /** Default `127.0.0.1`. */
  host?: string;
  /** Default 5038, or 5039 when `tls` is set. */
  port?: number;
  username: string;
  secret: string;
  /** `md5` uses the Challenge action so the secret never crosses the wire. Default `plain`. */
  authType?: 'plain' | 'md5';
  /**
   * Which events to receive: `true` (all your read classes), `false` (none),
   * or a list of classes. Default `true`.
   */
  events?: boolean | readonly EventClass[];
  /** Connect with TLS (manager.conf `tlsenable`). Pass options for a private CA. */
  tls?: boolean | ConnectionOptions;
  /** Per-action timeout in ms. `0` disables it. Default 10000. */
  actionTimeout?: number;
  /** Time allowed for TCP connect plus greeting, in ms. Default 10000. */
  connectTimeout?: number;
  /** Send `Ping` this often (ms) and reconnect if it fails. `0` disables it. Default 30000. */
  keepAlive?: number;
  /** Reconnect after the connection drops. Default `true`. */
  reconnect?: boolean | ReconnectOptions;
}

export interface CallOptions {
  /** Overrides `actionTimeout` for this call. For `list()`, it is the time allowed between items. */
  timeout?: number;
  signal?: AbortSignal;
}

export interface WaitOptions {
  /** Time to wait in ms. No limit by default. */
  timeout?: number;
  signal?: AbortSignal;
}

/** The result of `list()`. */
export interface AmiList<E extends AmiEvent = AmiEvent> {
  response: AmiResponse;
  /** The list items, without the final `...Complete` event. */
  events: E[];
  /** The final event, such as `CoreShowChannelsComplete`. Missing if the action did not return a list. */
  complete: AmiEvent | undefined;
}

export type ConnectionState = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'closed';
