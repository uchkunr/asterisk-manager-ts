# Overview

The Asterisk Manager Interface (AMI) is a TCP text protocol for controlling Asterisk and receiving its events. A client logs in, sends **actions** (Originate, Hangup, QueueAdd, ...), gets a **response** for each one, and receives **events** (Newchannel, Hangup, DialEnd, ...) as calls happen.

## AMI, ARI or AGI

| Interface | Use it for | Notes |
| --- | --- | --- |
| **AMI** (this library) | Monitoring calls, click-to-call, queue dashboards, CRM pop-ups, hanging up or redirecting calls, running CLI commands | One connection sees the whole system. Does not control media. |
| ARI | Building your own call flows in code (IVR, conferencing, custom applications) | REST + WebSocket. Channels must enter `Stasis()` in the dialplan. |
| AGI / FastAGI | Running a script for one call, step by step, from the dialplan | One process or socket per call. |

AMI and ARI are often used together: ARI for the calls your application owns, AMI for everything else.

## The protocol in one screen

```text
C: (TCP connect to port 5038)
S: Asterisk Call Manager/11.0.0

C: Action: Login
C: ActionID: 1
C: Username: app
C: Secret: s3cret
C: Events: on
C:
S: Response: Success
S: ActionID: 1
S: Message: Authentication accepted
S:
S: Event: FullyBooted
S: Privilege: system,all
S: Status: Fully Booted
S:
C: Action: Ping
C: ActionID: 2
C:
S: Response: Success
S: ActionID: 2
S: Ping: Pong
S: Timestamp: 1763284426.512730
S:
```

- Every message is a block of `Key: Value` lines ending with an empty line. Lines end with CRLF.
- The client puts an `ActionID` on each action; Asterisk copies it into the response, so responses can be matched even while events keep arriving.
- Events arrive at any time, in between responses.

[Protocol](protocol.md) has the details.

## Versions

The greeting shows the **AMI protocol version**, not the Asterisk version. On the current branch heads:

| Asterisk | AMI version |
| --- | --- |
| 20 (LTS) | 9.0.0 |
| 22 (LTS) | 11.0.0 |
| 23 | 12.0.0 |
| 24 (LTS, released 2026-11-05) | 13.0.0 |

To get the Asterisk version, send `CoreSettings` and read `AsteriskVersion`.

Changes that affect AMI clients:

- **`chan_sip` was removed in Asterisk 21.** Use PJSIP: channels are `PJSIP/<endpoint>-<id>`, and registration state comes from `ContactStatus` events and `PJSIPShowContacts`, not `SIPpeers`/`SIPshowpeer`.
- **Command output** is `Output:` headers since Asterisk 14. Older versions answered `Response: Follows` with raw text ending in `--END COMMAND--`. This library turns both into the same shape.
- **Advanced event filters** (`eventfilter(name(...))`) were added in 20.11.0, 21.6.0 and 22.1.0. See [Setup](setup.md#event-filters).
- **`TechCause`** (for example the SIP status code) was added to `Hangup` and `HangupRequest` events in 20.17.0, 22.7.0 and 23.1.0.

Check which actions and events a running system has with the CLI: `manager show commands`, `manager show command Originate`, `manager show events`, `manager show event Hangup`.

## Where to go next

1. [Setup](setup.md): enable AMI and create a least-privilege user.
2. [Client](client.md): connect with this library.
3. [Actions](actions.md) and [Events](events.md): recipes for common tasks.
4. [Security](security.md) before you expose anything.
