# Actions

Recipes for common tasks. The class in brackets is the `write` permission the action needs (any one of them). `manager show command <Action>` on the CLI shows the full syntax for your version.

All examples assume a connected client:

```ts
import { AsteriskManager } from 'asterisk-manager-ts';
const ami = new AsteriskManager({ host, username, secret });
await ami.connect();
```

## System information

```ts
const settings = await ami.action({ Action: 'CoreSettings' });   // [system, reporting]
settings.AsteriskVersion;  // "24.0.0"
settings.AMIversion;       // "13.0.0"

const status = await ami.action({ Action: 'CoreStatus' });       // [system, reporting]
status.CoreCurrentCalls;

await ami.action({ Action: 'Ping' });                            // no class needed

const output = await ami.command('pjsip show endpoints');        // [command]
```

Prefer a real action over `Command` when one exists: its output is structured, and `command` is a very broad permission.

## Originate a call

`Originate` [originate] calls a channel and, when it answers, sends it to a dialplan extension or an application.

```ts
const id = `click2call-${crypto.randomUUID()}`;
const result = ami.waitFor('OriginateResponse', (e) => e.ActionID === id, { timeout: 40_000 });

await ami.action({
  Action: 'Originate',
  ActionID: id,
  Channel: 'PJSIP/101',            // the phone to ring first
  Context: 'internal',
  Exten: '0951234567',             // then dial this number
  Priority: 1,
  CallerID: 'Click to call <0951234567>',
  Timeout: 30_000,                 // ms to wait for answer (default 30000)
  Async: true,
  ChannelId: crypto.randomUUID(),  // becomes the Uniqueid of the new channel
  Variable: { CRM_TICKET: '4711' },
});

const event = await result;
if (event.Response === 'Success') console.log('answered', event.Channel, event.Uniqueid);
else console.log('failed, reason', event.Reason);
```

- **Always use `Async: true`.** Without it Asterisk handles the Originate inside your AMI session and answers only when the call is answered or fails, up to `Timeout`. Meanwhile the session processes nothing else, so other responses and events are held back, and `actionTimeout` must be longer than `Timeout`.
- With `Async: true` the response is `Originate successfully queued`. The outcome arrives as `OriginateResponse` with your `ActionID`.
- `Reason` in `OriginateResponse`: `0` failed (no such channel or extension, or the channel could not be created), `1` hung up, `3` rang with no answer, `4` answered, `5` busy, `8` congestion.
- `ChannelId` lets you know the `Uniqueid` before the call exists, so you can match every later event of this call. `OtherChannelId` sets the second half when `Channel` is a `Local/` channel.
- Instead of `Context`/`Exten`/`Priority`, use `Application` and `Data`, for example `Application: 'Playback', Data: 'hello-world'`. Applications such as `System`, `Exec` or `AGI`, and functions such as `SHELL` in `Data`, also require the `system` class.
- `Codecs` takes a comma-separated list: `Codecs: 'ulaw,alaw'`.
- `EarlyMedia: true` connects on early media instead of waiting for answer.

## Hang up, redirect, transfer

```ts
await ami.action({ Action: 'Hangup', Channel: 'PJSIP/101-00000012', Cause: 16 });   // [system, call]
await ami.action({ Action: 'Hangup', Channel: '/^PJSIP\\/trunk-.*$/' });            // regex: hang up every match
```

`Hangup` with a regex answers with a list of the channels it hung up (`ChannelsHungupListComplete`), so use `ami.list()` there.

```ts
await ami.action({                                   // [call]
  Action: 'Redirect',
  Channel: 'PJSIP/101-00000012',
  Context: 'internal',
  Exten: '200',
  Priority: 1,
  // ExtraChannel / ExtraContext / ExtraExten / ExtraPriority move the other leg at the same time
});

await ami.action({ Action: 'BlindTransfer', Channel: 'PJSIP/101-00000012', Context: 'internal', Exten: '300' }); // [call]
await ami.action({ Action: 'Atxfer', Channel: 'PJSIP/101-00000012', Context: 'internal', Exten: '300' });        // [call]
```

`Redirect` moves a channel out of whatever it is doing (including a bridge). For a call in progress, transfer the channel that should keep talking to the new destination.

## Channel variables

```ts
const { Value } = await ami.action({ Action: 'Getvar', Channel: 'PJSIP/101-00000012', Variable: 'CALLERID(num)' }); // [call, reporting]
await ami.action({ Action: 'Setvar', Channel: 'PJSIP/101-00000012', Variable: 'CDR(userfield)', Value: 'vip' });     // [call]
```

Without `Channel`, `Getvar`/`Setvar` use global variables. Functions work too (`CALLERID(num)`, `CDR(...)`, `PJSIP_HEADER(read,X-Foo)`).

## Active channels

```ts
const { events } = await ami.list({ Action: 'CoreShowChannels' });   // [system, reporting]
for (const ch of events) {
  console.log(ch.Channel, ch.ChannelStateDesc, ch.Application, ch.Duration, ch.BridgeId, ch.Linkedid);
}
```

`Status` [system, call, reporting] returns more detail per channel and can include variables: `{ Action: 'Status', Channel: 'PJSIP/101-00000012', Variables: 'CDR(accountcode),MYVAR' }`. It answers with `Status` events and `StatusComplete`.

## PJSIP endpoints and registrations

```ts
const endpoints = await ami.list({ Action: 'PJSIPShowEndpoints' });
for (const e of endpoints.events) console.log(e.ObjectName, e.DeviceState, e.Contacts);

const contacts = await ami.list({ Action: 'PJSIPShowContacts' });
for (const c of contacts.events) console.log(c.Endpoint, c.Uri, c.Status, c.RoundtripUsec, c.UserAgent);

const detail = await ami.list({ Action: 'PJSIPShowEndpoint', Endpoint: '101' }); // EndpointDetail, AorDetail, ContactStatusDetail, ...
await ami.action({ Action: 'PJSIPQualify', Endpoint: '101' });
const trunks = await ami.list({ Action: 'PJSIPShowRegistrationsOutbound' });
```

`PJSIPShowEndpoints` answers `Response: Error`, `No endpoints found` when there are none; catch `AmiActionError`. For live changes, listen to `ContactStatus` and `DeviceStateChange` instead of polling.

## Queues

```ts
await ami.action({ Action: 'QueueAdd', Queue: 'support', Interface: 'PJSIP/101', MemberName: 'Alice', Penalty: 0, Paused: false }); // [agent]
await ami.action({ Action: 'QueuePause', Queue: 'support', Interface: 'PJSIP/101', Paused: true, Reason: 'lunch' });             // [agent]
await ami.action({ Action: 'QueueRemove', Queue: 'support', Interface: 'PJSIP/101' });                                           // [agent]

const status = await ami.list({ Action: 'QueueStatus', Queue: 'support' });   // QueueParams, QueueMember, QueueEntry
const summary = await ami.list({ Action: 'QueueSummary', Queue: 'support' }); // QueueSummary
```

Without `Queue` in `QueuePause`, the member is paused in every queue.

## Recording

```ts
await ami.action({ Action: 'MixMonitor', Channel: 'PJSIP/101-00000012', File: 'call-4711.wav', Options: 'b' }); // [system]
await ami.action({ Action: 'StopMixMonitor', Channel: 'PJSIP/101-00000012' });                                   // [system, call]
```

Option `b` records only while the channel is bridged. A relative `File` goes to the monitor spool directory. `MixMonitor` has a `Command` header that runs a shell command after recording, which is why it needs `system`; never put caller-controlled values (such as `CALLERID(num)`) into it.

## AstDB

```ts
await ami.action({ Action: 'DBPut', Family: 'blacklist', Key: '0951234567', Val: '1' });       // [system]
const { events } = await ami.list({ Action: 'DBGet', Family: 'blacklist', Key: '0951234567' }); // [system, reporting]
events[0]?.Val;
await ami.action({ Action: 'DBDel', Family: 'blacklist', Key: '0951234567' });                 // [system]
```

`DBGet` answers `Response: Error`, `Database entry not found` when the key is missing.

## Extension and device state

```ts
const s = await ami.action({ Action: 'ExtensionState', Exten: '101', Context: 'internal' }); // [call, reporting]
s.Status; s.StatusText;
```

The extension needs a hint (`exten => 101,hint,PJSIP/101`).

## Configuration and reloads

```ts
await ami.action({ Action: 'Reload', Module: 'res_pjsip.so' });    // [system, config]
await ami.action({ Action: 'ModuleCheck', Module: 'res_pjsip' });
```

## Custom events from the dialplan

`UserEvent` lets the dialplan (or another AMI client [user]) send your application a message:

```ini
exten => 500,1,UserEvent(CrmLookup,Number: ${CALLERID(num)},Uniqueid: ${UNIQUEID})
```

```ts
ami.on('UserEvent', (e) => {
  if (e.UserEvent === 'CrmLookup') lookup(e.Number, e.Uniqueid);
});
```

## Changing what this session receives

```ts
await ami.action({ Action: 'Events', EventMask: 'call,agent' });                                     // no class needed
await ami.action({ Action: 'Filter', Operation: 'Add', Filter: 'Event: Hangup' });                    // [system], legacy syntax
await ami.action({ Action: 'Filter', Operation: 'Add', MatchCriteria: 'name(Hangup)', Filter: '' });  // [system], advanced syntax
```

Filters added this way last until the session ends; after a reconnect, add them again in a `ready` handler.
