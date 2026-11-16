# Changelog

## 2.0.0

A rewrite. The API is not compatible with 1.x; see [the migration table](docs/client.md#migrating-from-1x).

### Breaking

- Options object: `new AsteriskManager({ host, port, username, secret, ... })`. The constructor no longer connects; call `await connect()`.
- Promises only; callbacks are gone.
- Message keys keep Asterisk's case (`e.Channel`, `e.Uniqueid`); event names are emitted as sent (`Hangup`, not `hangup`). `managerevent` is now `event`.
- ESM package with an `exports` map. `require()` still works on Node.js 22.12+. Node.js 22.12 or later is required.
- `disconnect()` is replaced by `close()`, which sends `Logoff`.

### Fixed

- Named ESM imports failed (`Named export 'AsteriskManager' not found`).
- A rejected login caused an unhandled promise rejection and crashed the process.
- CR/LF in header values allowed AMI action injection. Such values now throw a `TypeError`.
- Pending actions never settled when the connection dropped, and there was no timeout.
- List actions (`CoreShowChannels`, `QueueStatus`, `PJSIPShowEndpoints`, ...) resolved with only the first response.
- Partial data from a previous connection could corrupt parsing after a reconnect.
- Events that carry a `Response` header (`OriginateResponse`) were treated as responses.
- The library logged to the console and silently swallowed errors.
- Exported types did not match runtime data.

### Added

- `list()`, `command()`, `waitFor()`.
- Per-call `timeout` and `signal`; `actionTimeout` and `connectTimeout` options.
- Reconnect with exponential backoff and jitter, `disconnect`/`reconnecting`/`close` lifecycle events; stops on authentication failure.
- Keep-alive `Ping` to detect half-open connections.
- TLS (`tls` option) and MD5 challenge login (`authType: 'md5'`).
- Typed events for common channel, bridge, dial, queue, PJSIP and system events.
- Object values for `Variable` headers, escaped so Asterisk does not split them on commas.
- Validation of Asterisk's limits (1022-byte lines, 128 headers).
- Error classes: `AmiActionError`, `AmiAuthError`, `AmiTimeoutError`, `AmiConnectionError`.
- Helpers: `header()`, `headerValues()`, `variables()`.
- Documentation, runnable examples, and an Agent Skill for Claude Code and Codex.

## 1.0.4

Last release of the 1.x line, a TypeScript port of NodeJS-AsteriskManager.
