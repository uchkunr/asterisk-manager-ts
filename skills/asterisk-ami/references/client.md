# Client reference

```bash
npm install asterisk-manager-ts
```

Node.js 22.12 or later. ESM package; `require()` also works on those versions. No runtime dependencies.

```ts
import { AsteriskManager } from 'asterisk-manager-ts';

const ami = new AsteriskManager({
  host: 'pbx.internal',
  username: 'crm',
  secret: process.env.AMI_SECRET!,
});

ami.on('Hangup', (e) => console.log(e.Channel, e.Cause, e['Cause-txt']));
await ami.connect();

const { AsteriskVersion } = await ami.action({ Action: 'CoreSettings' });
```

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `host` | `127.0.0.1` | |
| `port` | `5038`, or `5039` with `tls` | |
| `username`, `secret` | required | A manager.conf user. |
| `authType` | `'plain'` | `'md5'` uses the Challenge action, so the secret is not sent. |
| `events` | `true` | `true` = `Events: on`, `false` = `off`, or a list of classes such as `['call', 'agent']`. |
| `tls` | off | `true`, or [`tls.ConnectionOptions`](https://nodejs.org/api/tls.html#tlsconnectoptions-callback) (for example `{ ca }` for a private CA). The certificate is verified. |
| `actionTimeout` | `10000` | Milliseconds per action. `0` disables it. |
| `connectTimeout` | `10000` | TCP connect plus greeting. |
| `keepAlive` | `30000` | Sends `Ping` this often; if it times out, the socket is dropped and the client reconnects. Finds half-open connections. `0` disables it. |
| `reconnect` | `true` | `false`, or `{ initialDelay: 1000, maxDelay: 30000, factor: 2, maxAttempts: Infinity }`. Backoff with jitter. |

## Methods

### `connect(): Promise<void>`

Connects, reads the greeting, logs in. Rejects with `AmiAuthError` (wrong credentials, ACL) or `AmiConnectionError` (refused, timeout). A failed first connect is not retried; retry it yourself if you want to.

### `action(action, options?): Promise<AmiResponse>`

Sends one action and resolves with its response. Rejects with `AmiActionError` when Asterisk answers `Response: Error`.

```ts
const res = await ami.action({ Action: 'Getvar', Channel: 'PJSIP/101-00000012', Variable: 'CDR(accountcode)' });
res.Value;
```

Header values may be strings, numbers, booleans, arrays (repeat the header) or objects (one `Name: key=value` line per entry, escaped for comma-splitting headers such as `Variable`). `undefined` and `null` are skipped.

`options`: `{ timeout?: number, signal?: AbortSignal }`.

### `list(action, options?): Promise<AmiList>`

For actions that answer with `EventList: start`. Resolves `{ response, events, complete }` once the `...Complete` event arrives. `timeout` is the time allowed between items. Items of the list are not emitted as normal events.

```ts
const { events } = await ami.list({ Action: 'PJSIPShowContacts' });
```

### `command(cli, options?): Promise<string>`

Runs a CLI command (needs `write = command`) and returns the output lines joined with `\n`.

### `waitFor(eventName, predicate?, options?): Promise<AmiEvent>`

Resolves with the next matching event. `options`: `{ timeout?, signal? }`; no timeout by default. Rejects if the client closes. Subscribe before you send the action that causes the event:

```ts
const id = `call-${Date.now()}`;
const done = ami.waitFor('OriginateResponse', (e) => e.ActionID === id, { timeout: 45_000 });
await ami.action({ Action: 'Originate', ActionID: id, Channel: 'PJSIP/101', Context: 'internal', Exten: '102', Priority: 1, Async: true });
const result = await done;
```

### `close(): Promise<void>`

Sends `Logoff`, closes the socket, stops reconnecting and rejects queued actions. You can call `connect()` again later.

### Properties

- `state`: `idle`, `connecting`, `ready`, `reconnecting` or `closed`.
- `connected`: `state === 'ready'`.
- `version`: AMI version from the greeting (not the Asterisk version).

## Events

```ts
ami.on('event', (e) => {});              // every AMI event
ami.on('DialEnd', (e) => e.DialStatus);  // one event, typed
ami.on('MyCustomEvent', (e) => {});      // any name, typed as AmiEvent
```

AMI events are emitted under their exact name as Asterisk sends it (case-sensitive, so `Newexten`, not `NewExten`). Typed names are listed in `KnownEvents`: `Newchannel`, `Newstate`, `Hangup`, `HangupRequest`, `SoftHangupRequest`, `Newexten`, `VarSet`, `DialBegin`, `DialEnd`, `BridgeCreate`, `BridgeDestroy`, `BridgeEnter`, `BridgeLeave`, `DTMFBegin`, `DTMFEnd`, `Hold`, `Unhold`, `DeviceStateChange`, `PeerStatus`, `ContactStatus`, `OriginateResponse`, `UserEvent`, `QueueCallerJoin`, `QueueCallerLeave`, `QueueCallerAbandon`, `QueueMemberStatus`, `AgentCalled`, `AgentConnect`, `AgentComplete`, `AgentRingNoAnswer`, `CoreShowChannel`, `FullyBooted`.

Lifecycle events:

| Event | Arguments | When |
| --- | --- | --- |
| `ready` | | Logged in (first connect and every reconnect) |
| `disconnect` | `error?` | Connection lost after being ready |
| `reconnecting` | `{ attempt, delay, error? }` | A reconnect is scheduled |
| `close` | `error?` | Stopped for good: `close()`, `reconnect: false`, gave up, or the login was rejected on reconnect |

The client never emits `error`, so a missing `error` listener cannot crash your process. Errors reach you through rejected promises and the `disconnect`/`close` arguments.

## Behaviour on connection loss

1. Actions waiting for a response are rejected with `AmiConnectionError`. They are not resent, because Asterisk may already have run them.
2. `disconnect` fires, then `reconnecting`.
3. Actions sent while reconnecting are queued and sent after `ready`. Their timeout still runs.
4. After a successful login, `ready` fires again. Events that happened while disconnected are lost; resynchronise with `CoreShowChannels`, `QueueStatus`, `PJSIPShowContacts` or similar.
5. If the reconnect login is rejected (secret changed, ACL), the client stops and emits `close` with the `AmiAuthError`.

## Errors

| Class | When | Useful fields |
| --- | --- | --- |
| `AmiActionError` | `Response: Error` | `action`, `response` (has `Message`) |
| `AmiAuthError` | Login rejected | `response` |
| `AmiTimeoutError` | No response in time, or `waitFor` timeout | `action`, `actionId` |
| `AmiConnectionError` | Not connected, connection lost, client closed | `cause` |
| `TypeError`, `RangeError` | Invalid action: CR/LF in a value, bad header name, line over 1022 bytes, more than 128 headers | |

All library errors extend `AmiError`.

A timeout does not mean the action failed. For actions with side effects (Originate, Hangup, Redirect), check the state before retrying.

## Helpers

```ts
import { header, headerValues, variables } from 'asterisk-manager-ts';

header(event, 'uniqueid');          // first value, case-insensitive
headerValues(response, 'Output');   // always an array
variables(event);                   // ChanVariable lines as an object
```

`AmiParser` and `serializeAction` are exported for tests and custom transports.

## Migrating from 1.x

| 1.x | 2.x |
| --- | --- |
| `new AsteriskManager(port, host, user, secret, events)` | `new AsteriskManager({ port, host, username, secret, events })` |
| Connects in the constructor | Call `await ami.connect()` |
| `ami.keepConnected()` | On by default (`reconnect` option) |
| `ami.action(obj, callback)` | Promises only: `await ami.action(obj)` |
| Lower-case keys: `evt.event`, `evt.channel` | Asterisk's case: `evt.Event`, `evt.Channel` |
| Lower-case event names: `ami.on('hangup')` | `ami.on('Hangup')` |
| `managerevent` | `event` |
| `userevent-<name>` | `ami.on('UserEvent', e => e.UserEvent === name && ...)` |
| `variable` objects in events | Arrays of `name=value`; use `variables(event, 'Variable')` |
| List actions resolve with the first response | `ami.list()` returns all items |
| `ami.disconnect()` | `await ami.close()` |
| `import am from 'asterisk-manager-ts'` (CommonJS) | `import { AsteriskManager } from 'asterisk-manager-ts'` (ESM; `require` works on Node 22.12+) |
