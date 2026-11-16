---
name: asterisk-ami
description: Build, debug and review code that talks to the Asterisk Manager Interface (AMI) on TCP 5038/5039, in Node.js with the asterisk-manager-ts package or in any language. Covers manager.conf users and permission classes, login (plain and MD5), ActionID matching, EventList actions, Originate with OriginateResponse, Hangup/Redirect/transfer, queues, PJSIP status, call tracking with Uniqueid and Linkedid, event filters, reconnects, and AMI header injection. Use when code connects to Asterisk, FreePBX or Issabel over AMI, handles AMI events, or edits manager.conf. Not for ARI (REST/WebSocket) or AGI.
license: MIT
metadata:
  source: https://github.com/uchkunr/asterisk-manager-ts
---

# Asterisk Manager Interface

AMI is line-based text over TCP: `Key: Value` lines, CRLF, an empty line ends each message. The client sends actions with an `ActionID`; Asterisk answers with a response carrying the same ID, and sends events at any time in between.

For Node.js use `asterisk-manager-ts` (v2, ESM, Node 22.12+). See [references/client.md](references/client.md).

References:
- [references/client.md](references/client.md): asterisk-manager-ts API, options, errors, reconnect behaviour, migration from 1.x
- [references/actions.md](references/actions.md): common actions with exact headers and required write classes
- [references/events.md](references/events.md): event fields, call flow, Hangup causes, DialStatus, queue events
- [references/manager-conf.md](references/manager-conf.md): manager.conf, permission classes, event filters
- [references/protocol.md](references/protocol.md): wire format, login, lists, Command output, Variable splitting, limits

## Rules

**Protocol**
- Treat any message with `Event:` as an event, even if it also has `Response:` (`OriginateResponse` does).
- Match responses by `ActionID`, never by order. Generate unique IDs.
- Actions that answer `EventList: start` send items as events with the same ActionID and finish with an event that has `EventList: Complete` (`CoreShowChannels`, `QueueStatus`, `PJSIPShowEndpoints`, `PJSIPShowContacts`, `Status`, `DBGet`, regex `Hangup`). Collect them (`ami.list()`); do not resolve on the first response. Some answer `Response: Error` with `No ... found` when empty.
- `Response: Error` can come for any action; read `Message`. `Permission denied` means the user's `write` lacks the action's class.
- Header names are case-insensitive in Asterisk; Asterisk sends them in fixed case (`Uniqueid`, `Linkedid`, `CallerIDNum`, `Cause-txt`). Event names are exact: `Newexten`, not `NewExten`.
- Repeated headers (`Output`, `ChanVariable`, `Variable`) are lists.
- Command output is `Output:` headers on Asterisk 14+; older versions used `Response: Follows` ... `--END COMMAND--`.

**Safety**
- Never put CR or LF from input into a header value: it starts new headers or a whole new action (AMI injection). Validate dialled numbers, contexts and channel names.
- Asterisk splits `Variable` values on commas and treats `"()[]\` specially; send one header per variable and backslash-escape those characters (asterisk-manager-ts does this for object values).
- A header line may be at most 1022 bytes; at most 128 headers per action.
- Never expose 5038 publicly. Use TLS (5039) or a private network, `deny`/`permit` on every user, least-privilege classes. `write=command`, `system` and `all` are effectively root.
- Originate into a restricted dialplan context. Originate to `System`/`Exec`/`AGI` or with `SHELL()` etc. needs `system`; do not grant it to make that work.

**Originate**
- Always `Async: true`. Without it, the whole session blocks until the call is answered or fails.
- Success of the action only means "queued". Wait for `OriginateResponse` with the same ActionID: `Response: Success|Failure`, `Reason` 0 failed, 1 hung up, 3 no answer, 4 answered, 5 busy, 8 congestion.
- Set `ChannelId` to know the new channel's `Uniqueid` in advance. `Timeout` is in ms (default 30000). `Codecs` is comma-separated.

**Events and state**
- Key channels by `Uniqueid`, group a call by `Linkedid`. Channel names can change.
- `Local/` channels come in `;1`/`;2` pairs; filter them for user-facing views.
- Events missed while disconnected are gone. After reconnect, rebuild state from `CoreShowChannels`, `QueueStatus`, `PJSIPShowContacts`.
- `dialplan` class (`Newexten`, `VarSet`) and `channelvars` are high volume. Prefer `eventfilter(name(...))` (Asterisk 20.11/21.6/22.1+) or `Events: call,agent` at login.
- Keep handlers fast; Asterisk drops clients that cannot keep up within `writetimeout`.
- `chan_sip` is gone since Asterisk 21: use PJSIP actions and `ContactStatus`/`DeviceStateChange`, not `SIPpeers`/`PeerStatus` from `SIP/`.

**Connections**
- Reuse one long-lived connection. Reconnect with backoff; reject in-flight actions on disconnect instead of resending them (they may have run).
- On login failure Asterisk waits 1 s, answers `Authentication failed` and closes; stop retrying on auth errors.
- Detect half-open connections with periodic `Ping`.
- Do not retry Originate, Hangup or Redirect after a timeout without checking state.

## Quick start (asterisk-manager-ts)

```ts
import { AsteriskManager } from 'asterisk-manager-ts';

const ami = new AsteriskManager({ host: 'pbx.internal', username: 'crm', secret: process.env.AMI_SECRET!, events: ['call'] });
ami.on('Hangup', (e) => console.log(e.Linkedid, e.Cause, e['Cause-txt']));
await ami.connect();

const { events } = await ami.list({ Action: 'CoreShowChannels' });
const id = `c2c-${crypto.randomUUID()}`;
const done = ami.waitFor('OriginateResponse', (e) => e.ActionID === id, { timeout: 40_000 });
await ami.action({ Action: 'Originate', ActionID: id, Channel: 'PJSIP/101', Context: 'click2call', Exten: '0951234567', Priority: 1, Async: true });
console.log((await done).Reason);
```
