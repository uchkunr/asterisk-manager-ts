# Protocol

What goes over the socket, as implemented in Asterisk's `main/manager.c`. You do not need this to use the library, but it explains its behaviour and helps when reading a packet capture.

## Framing

- Plain text over TCP (port 5038) or TLS (port 5039).
- A message is a set of `Key: Value` lines followed by an empty line. Asterisk sends CRLF and accepts CRLF or LF.
- On connect, Asterisk sends one line without a blank line after it: `Asterisk Call Manager/<AMI version>`.
- Three kinds of messages arrive:
  - **Response**: has `Response:` (`Success`, `Error`, `Goodbye`, or legacy `Follows`).
  - **Event**: has `Event:`.
  - Some events also carry `Response:` (for example `OriginateResponse`). Treat anything with `Event:` as an event.

## Headers

- Asterisk matches header names case-insensitively and uses the **first** occurrence of a header, except for headers it reads as a list (such as `Variable`).
- Asterisk sends header names in a fixed case (`Channel`, `Uniqueid`, `CallerIDNum`, `ActionID`). This library keeps that case, so `event.Uniqueid`, not `event.uniqueid`. `header(message, 'uniqueid')` does a case-insensitive lookup.
- Some headers repeat (`ChanVariable`, `Output`, `Variable`). The library returns those as arrays.
- Values are strings. Numbers such as `Cause: 16` are strings too.

## Limits on actions

Asterisk reads each line into a 1024-byte buffer that includes the CRLF, so a header line can be at most **1022 bytes**. Longer lines are discarded with `Line too long` in the Asterisk log. An action can have at most **128 headers** (`AST_MAX_MANHEADERS`); the rest are ignored. `serializeAction()` throws instead of sending something Asterisk would silently drop.

## Injection

A value containing CR or LF ends the header, and an empty line ends the action. If such a value reaches the socket, the rest of the value is parsed as new headers or a new action:

```text
CallerID: x
                       <- the injected empty line ends Originate
Action: Command        <- a second action, run with your user's permissions
Command: core stop now
```

The library refuses any header name or value containing CR or LF (`TypeError`). If you write your own client, do the same.

## Login

Plain:

```text
Action: Login
ActionID: 1
Username: app
Secret: s3cret
Events: on
```

MD5 challenge, so the secret is not sent:

```text
Action: Challenge          ->  Response: Success
AuthType: MD5                  Challenge: 1883213856

Action: Login
AuthType: MD5
Username: app
Key: md5hex(challenge + secret)
```

- On success: `Response: Success`, `Message: Authentication accepted`. If the user receives `system` events and Asterisk has finished booting, a `FullyBooted` event follows.
- On failure Asterisk waits one second, answers `Response: Error`, `Message: Authentication failed`, and closes the connection.
- With `allowmultiplelogin = no` and the user already logged in: `Login Already In Use`, then the connection is closed.
- Before login, every action except `Login`, `Challenge` and `Logoff` gets `Permission denied`.
- A client that does not log in within `authtimeout` seconds (default 30) is disconnected.

`Events` at login selects event classes: `on` (all of the user's read classes), `off`, or a list such as `call,agent`. Without the header the user's read classes apply. The `Events` action changes it later (`EventMask: off`).

## Responses

```text
Response: Success          Response: Error
ActionID: 42               ActionID: 42
Message: ...               Message: No such channel
```

The `ActionID` you send comes back on the response and on events that belong to the action. The library generates unique IDs (`<random>-<counter>`) unless you pass one.

`Logoff` answers `Response: Goodbye` and Asterisk closes the connection.

## Lists

Actions that return many items answer in three parts, all with the same `ActionID`:

```text
Response: Success
ActionID: 7
EventList: start
Message: Channels will follow

Event: CoreShowChannel        (one per item)
ActionID: 7
Channel: PJSIP/101-00000012
...

Event: CoreShowChannelsComplete
ActionID: 7
EventList: Complete
ListItems: 1
```

Use `ami.list()` for these. `action()` would resolve on the first part and the items would arrive as ordinary events. Some list actions answer `Response: Error` when there is nothing to list (for example `PJSIPShowEndpoints` with no endpoints gives `No endpoints found`), so handle `AmiActionError` there.

Common list actions and their final events: `CoreShowChannels` (`CoreShowChannelsComplete`), `Status` (`StatusComplete`), `PJSIPShowEndpoints` (`EndpointListComplete`), `PJSIPShowEndpoint` (`EndpointDetailComplete`), `PJSIPShowContacts` (`ContactListComplete`), `PJSIPShowRegistrationsOutbound` (`OutboundRegistrationDetailComplete`), `QueueStatus` (`QueueStatusComplete`), `QueueSummary` (`QueueSummaryComplete`), `DBGet` (`DBGetComplete`), `BridgeList` (`BridgeListComplete`).

## Command output

Asterisk 14 and later:

```text
Response: Success
ActionID: 9
Message: Command output follows
Output: Asterisk 24.0.0 built by root @ build on a x86_64 running Linux
```

One `Output:` header per line. If the CLI command fails the response is `Response: Error` and the output, if any, is still in `Output`.

Asterisk 13 and older answered `Response: Follows` with raw text up to `--END COMMAND--`. The parser turns that into the same `Output` headers, so `ami.command()` works on both.

## Variables in Originate and similar actions

`Variable` headers are read as a list. Asterisk splits each value on commas, so `Variable: A=1,B=2` sets two variables, and `Variable: NOTE=a,b` sets `NOTE=a` and drops `b`. Quotes, `()`, `[]` and backslashes also change how it splits.

Send one header per variable and escape the value. Passing an object does both:

```ts
await ami.action({
  Action: 'Originate',
  Channel: 'PJSIP/101',
  Context: 'internal',
  Exten: '102',
  Priority: 1,
  Variable: { CRM_ID: '12345', NOTE: 'callback, urgent' }, // NOTE=callback\, urgent on the wire
});
```

## Events on the wire

```text
Event: Hangup
Privilege: call,all
Channel: PJSIP/101-00000012
ChannelState: 6
ChannelStateDesc: Up
CallerIDNum: 101
...
Uniqueid: 1763284426.42
Linkedid: 1763284420.40
Cause: 16
Cause-txt: Normal Clearing
```

`Privilege` lists the event's classes. `channelvars` in manager.conf add `ChanVariable: name=value` lines; Asterisk escapes their values C-style. With `timestampevents = yes`, events also carry `Timestamp:`.
