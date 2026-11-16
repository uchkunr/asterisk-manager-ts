# Events

Events describe what Asterisk is doing. They are the reason most applications use AMI.

```ts
ami.on('Newchannel', (e) => {});
ami.on('Hangup', (e) => {});
ami.on('event', (e) => {}); // all of them
```

## Which events you get

Three things decide it:

1. The user's `read` classes in manager.conf (see [Setup](setup.md#permissions)).
2. The `events` option at login (`true`, `false` or a list of classes), and the `Events` action later.
3. `eventfilter` entries for the user, and `Filter` actions on the session.

`manager show events` lists every event the running Asterisk can send; `manager show event Hangup` shows its fields.

## Channels and calls

Every channel-oriented event carries the channel's state:

| Header | Meaning |
| --- | --- |
| `Channel` | Name, e.g. `PJSIP/101-0000002a`. Can change (masquerade, `Rename` event). |
| `Uniqueid` | ID of this channel. Never changes. Use it as the key. |
| `Linkedid` | `Uniqueid` of the channel that started the call. Shared by every channel in the call, including transfers. |
| `ChannelState`, `ChannelStateDesc` | `0 Down`, `4 Ring`, `5 Ringing`, `6 Up`, ... |
| `CallerIDNum`, `CallerIDName` | This channel's caller ID |
| `ConnectedLineNum`, `ConnectedLineName` | The other party |
| `Context`, `Exten`, `Priority` | Current dialplan position |
| `AccountCode`, `Language`, `Tenantid` | |

A call usually produces:

```text
Newchannel        PJSIP/101-01   caller picks up and dials
Newexten ...      PJSIP/101-01   dialplan steps (dialplan class)
DialBegin         PJSIP/101-01 -> DestChannel PJSIP/102-02
Newchannel        PJSIP/102-02
Newstate          PJSIP/102-02   Ringing
DialEnd           DialStatus ANSWER
BridgeEnter       both channels, same BridgeUniqueid
...
BridgeLeave
Hangup            each channel, with Cause
```

### Tracking calls

Group events by `Linkedid` to follow one call across all its channels, and key channels by `Uniqueid`:

```ts
const calls = new Map<string, Set<string>>();

ami.on('Newchannel', (e) => {
  const channels = calls.get(e.Linkedid) ?? new Set();
  calls.set(e.Linkedid, channels.add(e.Uniqueid));
});

ami.on('Hangup', (e) => {
  const channels = calls.get(e.Linkedid);
  channels?.delete(e.Uniqueid);
  if (channels?.size === 0) {
    calls.delete(e.Linkedid);
    console.log('call ended', e.Linkedid);
  }
});
```

- `Local/` channels come in pairs (`;1` and `;2`) and appear in many PBX dialplans (queues, follow-me, ring groups). Filter them out (`e.Channel.startsWith('Local/')`) if you only care about real endpoints, or exclude them with an event filter.
- After a reconnect, rebuild state from `CoreShowChannels`; events sent while you were disconnected are gone.
- Use `ChannelId` on Originate to know the `Uniqueid` of a call you start (see [Actions](actions.md#originate-a-call)).

### DialEnd

`DialStatus`: `ANSWER`, `BUSY`, `NOANSWER`, `CANCEL` (caller hung up first), `CONGESTION`, `CHANUNAVAIL` (endpoint unreachable or unregistered), `ABORT`, `CONTINUE`, `GOTO`. `Forward` is set when the call was forwarded.

The caller fields (`Channel`, `Uniqueid`, ...) are missing when there is no calling channel, for example on the first leg of an Originate. The called channel is in `DestChannel`, `DestUniqueid`, `DestCallerIDNum`, ...

### Hangup

`Cause` is the Q.850 code and `Cause-txt` its name:

| Cause | Cause-txt |
| --- | --- |
| 16 | Normal Clearing |
| 17 | User busy |
| 18 | No user responding |
| 19 | User alerting, no answer |
| 21 | Call Rejected |
| 1 | Unallocated (unassigned) number |
| 27 | Destination out of order |
| 34 | Circuit/channel congestion |
| 38 | Network out of order |

On Asterisk 20.17, 22.7, 23.1 and later, `TechCause` carries the technology's own code when the call ended abnormally (for PJSIP, the SIP response code such as `486`).

`HangupRequest` and `SoftHangupRequest` tell you who asked for the hangup before `Hangup` arrives.

### Other channel events

| Event | Useful headers |
| --- | --- |
| `Newstate` | `ChannelStateDesc` (`Ringing`, `Up`, ...) |
| `Newexten` (class `dialplan`) | `Extension`, `Application`, `AppData`. The documentation calls it `NewExten`, but Asterisk sends `Newexten`. Very frequent; filter it if you do not need it. |
| `VarSet` (class `dialplan`) | `Variable`, `Value`. Very frequent. |
| `NewCallerid`, `NewConnectedLine` | Caller ID changes |
| `BridgeEnter`, `BridgeLeave` | `BridgeUniqueid`, `BridgeNumChannels`, `BridgeTechnology` |
| `Hold`, `Unhold` | `MusicClass` |
| `DTMFBegin`, `DTMFEnd` (class `dtmf`) | `Digit`, `Direction` (`Received`/`Sent`), `DurationMs` on end |
| `Rename` | Channel name changed |

## Endpoints and devices

| Event | Use |
| --- | --- |
| `ContactStatus` | PJSIP contact `Reachable`, `Unreachable`, `Removed`, `Updated`, ...; `AOR`, `EndpointName`, `URI`, `RoundtripUsec`. Best source for "is the phone registered". |
| `PeerStatus` | Endpoint state (`Peer: PJSIP/101`, `PeerStatus`). Generic across channel drivers. |
| `DeviceStateChange` | `Device` (`PJSIP/101`, `Queue:support_avail`, ...), `State` (`NOT_INUSE`, `INUSE`, `RINGING`, `UNAVAILABLE`, `ONHOLD`, ...). Good for BLF-style presence. |

## Queues (class `agent`)

| Event | When |
| --- | --- |
| `QueueCallerJoin` | Caller enters a queue (`Queue`, `Position`, `Count`) |
| `QueueCallerLeave` | Caller leaves, answered or not |
| `QueueCallerAbandon` | Caller hung up while waiting (`HoldTime`, `OriginalPosition`) |
| `AgentCalled` | A member is rung (`Interface`, `MemberName`, `DestChannel`) |
| `AgentRingNoAnswer` | Member did not answer (`RingTime`) |
| `AgentConnect` | Member answered (`HoldTime`, `RingTime`) |
| `AgentComplete` | Call finished (`TalkTime`, `HoldTime`, `Reason`: `caller`, `agent`, `transfer`) |
| `QueueMemberStatus` | Member state changed (`Status` 0-8 device state, `Paused`, `InCall`, `CallsTaken`) |
| `QueueMemberAdded`, `QueueMemberRemoved`, `QueueMemberPause`, `QueueMemberPenalty` | Membership changes |

`QueueMemberStatus.Status`: `0` unknown, `1` not in use, `2` in use, `3` busy, `4` invalid, `5` unavailable, `6` ringing, `7` ring in use, `8` on hold.

## System

| Event | When |
| --- | --- |
| `FullyBooted` | After login if Asterisk has finished starting (class `system`) |
| `Reload` | A module was reloaded |
| `Shutdown` | Asterisk is stopping; expect the connection to drop |
| `UserEvent` | Sent by the `UserEvent()` dialplan application or action |
| `OriginateResponse` | Result of an `Async` Originate, with its `ActionID` |
| `Cdr` | One per CDR, if `cdr_manager` is enabled (class `cdr`) |
| Security events (class `security`) | `InvalidPassword`, `FailedACL`, `ChallengeResponseFailed`, `SuccessfulAuth`, ... useful for fail2ban-style tooling |

## Performance

- On a busy system, `Newexten`, `VarSet`, and `channelvars` produce most of the traffic. Leave out the `dialplan` class unless you need it, or filter on the Asterisk side.
- Keep event handlers fast. A slow client makes Asterisk wait up to `writetimeout` per write and then disconnect it.
- Do the heavy work (database writes, HTTP calls) off the event handler, for example through a queue.
