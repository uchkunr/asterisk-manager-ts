# Setup

AMI is configured in `/etc/asterisk/manager.conf`. It is disabled by default.

## Minimal configuration

```ini
[general]
enabled = yes
port = 5038
bindaddr = 127.0.0.1        ; listen on loopback only; see Security

[crm]                       ; the username
secret = use-a-long-random-secret
deny = 0.0.0.0/0.0.0.0
permit = 10.0.10.25/255.255.255.255
read = call,agent
write = call,originate,agent
writetimeout = 5000
```

Apply it with `manager reload` on the CLI (`asterisk -rx "manager reload"`). Check the result:

```text
manager show settings
manager show users
manager show user crm
manager show connected
```

## Permissions

`read` decides which **events** the user receives. `write` decides which **actions** the user may send. An action lists one or more classes; having any one of them is enough. `manager show command <Action>` prints the classes an action needs.

| Class | Read (events) | Write (actions) |
| --- | --- | --- |
| `system` | System events (FullyBooted, Reload, ...) | Shutdown, Restart, Reload, dialplan changes, DBPut/DBDel, MixMonitor, CoreShowChannels |
| `call` | Channel events (Newchannel, Hangup, Dial*, Bridge*, Hold, ...) | Hangup, Redirect, Setvar, Getvar, BlindTransfer, Atxfer, Status |
| `originate` | | Originate |
| `agent` | Queue and agent events | QueueAdd, QueueRemove, QueuePause, ... |
| `user` | UserEvent | UserEvent |
| `config` | | GetConfig, UpdateConfig, Reload |
| `command` | | Command (any CLI command) |
| `reporting` | | CoreSettings, CoreStatus, Getvar, Status, DBGet, ... |
| `dialplan` | Newexten, VarSet | |
| `dtmf` | DTMFBegin, DTMFEnd | |
| `cdr` | Cdr (with cdr_manager) | |
| `security` | Security events (failed logins, ACL failures) | |
| `agi`, `cc`, `aoc`, `message`, `log`, `verbose`, `test` | Module-specific | |
| `all` | Everything | Everything |

Notes from the Asterisk sample configuration:

- Classes overlap; they are not separate security boundaries. `write = command` runs any CLI command, including `channel originate` and `module reload`, so treat it like `all`.
- Originating to sensitive applications (`System`, `Exec`, `AGI`, `MixMonitor`, `Originate`, ...) or with sensitive functions in the data (`SHELL`, `EVAL`, `FILE`, `DB`, `CURL`, `ODBC`, ...) also needs `system`.
- `read` does not limit what an action's response returns.

Typical users:

| Use | read | write |
| --- | --- | --- |
| Call monitoring / wallboard | `call,agent` | (none, or `reporting`) |
| Click-to-call | `call` | `originate,call` |
| Queue panel | `agent,call` | `agent` |
| Admin tools | as needed | as needed, never `all` for an internet-facing app |

## Per-user options

| Option | Effect |
| --- | --- |
| `secret` | Password. MD5 challenge login (`authType: 'md5'`) also needs it. |
| `deny`, `permit`, `acl` | IP restrictions. Always set them. `acl` names an entry in `acl.conf`. |
| `writetimeout` | Milliseconds Asterisk waits to write to a slow client before dropping it (default 100). Raise it for clients on slow links or receiving many events. |
| `eventfilter` | Include or exclude events for this user. See below. |
| `setvar` | Channel variables set on calls this user originates. |
| `allowmultiplelogin` | `no` rejects a second login for the same user (`Login Already In Use`). Default from `[general]`, which defaults to `yes`. |
| `displayconnects` | Log logins and logoffs on the CLI. |

## General options worth knowing

| Option | Effect |
| --- | --- |
| `bindaddr`, `port` | Where AMI listens. Default `0.0.0.0:5038`. |
| `tlsenable`, `tlsbindaddr`, `tlscertfile`, `tlsprivatekey` | AMI over TLS, default port 5039. Use `tls: true` in this library. |
| `authtimeout` | Seconds a client has to log in (default 30). |
| `authlimit` | Maximum unauthenticated connections (default 50). |
| `channelvars` | Channel variables added to every channel event as `ChanVariable: name=value`. Costs performance; keep the list short. Read them with `variables(event)`. |
| `timestampevents` | Adds `Timestamp:` (Unix epoch) to events. |
| `disabledevents` | Disables events globally, e.g. `Newexten,VarSet`. Event names are case-sensitive. |

## Event filters

Filters cut the event stream for one user on the Asterisk side, which saves bandwidth and parsing.

**Advanced filters** (Asterisk 20.11.0, 21.6.0, 22.1.0 and later) match on the event name by hash, and optionally on one header:

```ini
[dashboard]
; only these events
eventfilter(action(include),name(Newchannel)) =
eventfilter(action(include),name(Hangup)) =
eventfilter(action(include),name(DialEnd)) =
; but not for Local channels
eventfilter(action(exclude),header(Channel),method(starts_with)) = Local/
```

Methods: `regex`, `exact`, `starts_with`, `ends_with`, `contains`, `none` (default). With only include filters, an event that matches any of them is sent. With only exclude filters, an event that matches any of them is dropped. With both, includes are applied first, then excludes.

**Legacy filters** run a regular expression over the whole event text. They still work but cost more on a busy system, and they are whitespace-sensitive: `Event: Newchannel` matches, `Event:Newchannel` does not.

```ini
eventfilter = Event: Newchannel
eventfilter = !Channel: Local/
```

A client can also add filters for its own session with the `Filter` action (needs `system`):

```js
await ami.action({ Action: 'Filter', Operation: 'Add', Filter: 'Event: Hangup' });
```

## Tell the client what it gets

Pick events at login too. The library sends `Events: on` by default (all of the user's `read` classes). Pass a list to narrow it, or `false` for an action-only client:

```ts
new AsteriskManager({ username: 'crm', secret, events: ['call', 'agent'] });
new AsteriskManager({ username: 'dialer', secret, events: false });
```
