# Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `ECONNREFUSED` | AMI disabled, wrong port, or bound to another address | `enabled = yes`, check `bindaddr`/`port`, `manager show settings`, firewall |
| `No AMI greeting ... within 10000 ms` | Connected to something that is not AMI (wrong port, TLS port without `tls`, a proxy) | Check host and port; use `tls: true` for 5039 |
| `AmiAuthError: ... Authentication failed` | Wrong username or secret, or the client IP fails `deny`/`permit` | Check manager.conf and the Asterisk log (`failed to pass IP ACL` or `failed to authenticate`); run `manager reload` after editing |
| `Login Already In Use` | `allowmultiplelogin = no` and another session uses this user | Close the other session or use another user |
| `AmiActionError: ... Permission denied` | The user's `write` lacks the action's class | `manager show command <Action>` shows the classes; add one to `write` |
| `Invalid/unknown command: X` | Action name wrong, or its module is not loaded (e.g. `QueueStatus` without `app_queue`, `PJSIP*` without `res_pjsip`) | `manager show commands`, `module show like <name>` |
| No events at all | User has no `read` classes, `events: false`, or an `eventfilter` excludes everything | Check `read`, the `events` option, and filters |
| Some events missing | Their class is not in `read`, they are in `disabledevents`, or a filter excludes them | `manager show event <Name>` shows the class |
| `list()` returns at once with no events | The action does not answer with `EventList: start` on this version | Use `action()` for it |
| `list()` rejects with `No endpoints found` / `No Contacts found` | Empty list | Catch `AmiActionError` and treat it as empty |
| Originate response is fine but nothing rings | The `Channel` cannot be reached, or the dialplan context does not exist | Wait for `OriginateResponse`; `Reason: 0` means the channel or extension failed. Check the Asterisk log |
| Sync Originate makes everything slow | Without `Async: true` the session waits for the call | Always send `Async: true` |
| `AmiTimeoutError` on a busy system | Slow action, or Asterisk is overloaded | Raise `timeout` for that call; check `core show taskprocessors` |
| Client disconnected under load | Asterisk could not write to the client within `writetimeout` (100 ms default) | Raise `writetimeout`, receive fewer events (classes, filters), keep handlers fast |
| `Header ... contains a line break` | A value has `\r` or `\n` | Clean the input; this protects you from AMI injection |
| `Header ... is longer than the 1022 bytes` | Asterisk discards longer lines | Shorten the value; split variables over several headers |
| Variables arrive cut off at a comma | Sent as `Variable: A=x,y` | Pass `Variable` as an object; the library escapes commas |
| `ChanVariable` values look escaped | Asterisk escapes them C-style (`\n`, `\t`, `\\`) | Unescape if you need the raw value |
| `ami.on('NewExten')` never fires | Asterisk sends `Newexten` | Event names are case-sensitive; use the name as sent |
| Events have lower-case keys (`e.channel`) | Code written for 1.x | 2.x keeps Asterisk's case: `e.Channel`. See [migration](client.md#migrating-from-1x) |

## Watching the wire

On the Asterisk side:

```text
manager set debug on
manager show connected
core set verbose 3
```

Or capture plain AMI with `tcpdump -A -i any port 5038`.

A quick manual session with no library involved:

```bash
nc pbx.internal 5038
Action: Login
Username: crm
Secret: ...

Action: CoreSettings

```

(Press Enter twice after each action.)
