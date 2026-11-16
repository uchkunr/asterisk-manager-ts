# Security

An AMI user with `originate` can make calls at your expense; one with `command` or `system` can do almost anything Asterisk can, including running shell commands through `System()`. Treat AMI credentials like root credentials scoped by class.

## Network

- **Never expose 5038 to the internet.** Bind to loopback or a private interface (`bindaddr = 127.0.0.1`) and reach it over a VPN, SSH tunnel or private network. Asterisk's own sample config says the same.
- Plain AMI sends the secret, and everything else, unencrypted. Across any network you do not control, enable TLS (`tlsenable = yes`, port 5039) and connect with `tls: true`. The library verifies the certificate; pass `tls: { ca }` for a private CA rather than turning verification off.
- On a trusted network without TLS, use `authType: 'md5'` so the secret is not sent in clear text. The rest of the session is still readable.
- Set `deny`/`permit` (or `acl`) on every user so only your application hosts can log in.
- Firewall the port as well; ACLs are checked only after the TCP connection is accepted.

## Users and permissions

- One user per application, with only the classes it needs (see [Setup](setup.md#permissions)). A wallboard needs `read = call,agent` and no `write`.
- Avoid `write = command` and `write = all` for applications. `command` runs any CLI command, so it overlaps every other class.
- Originate to `System`, `Exec`, `AGI` and similar applications, or with functions like `SHELL` in the data, needs `system`. Do not grant `system` just to make an Originate work; send the call to a dialplan context instead.
- Use long random secrets, keep them out of source control, and rotate them. After changing manager.conf run `manager reload`; existing sessions keep their old permissions until they reconnect.
- Watch the `security` event class (`InvalidPassword`, `FailedACL`, `ChallengeResponseFailed`) or the Asterisk security log for brute-force attempts.

## Input from users

AMI is a line-based protocol. A CR or LF in a header value ends the header and lets the rest of the value become new headers or a whole new action, executed with your AMI user's permissions. This library throws a `TypeError` for such values instead of sending them. Even so:

- Validate numbers, extensions and channel names coming from a web form or API before putting them in an action (`/^[0-9+*#]{1,32}$/` for a dialled number, an allow-list for contexts).
- Do not pass user input into `Command`, into `Application`/`Data` of an Originate, or into `MixMonitor`'s `Command`.
- Values in `Variable` are split on commas by Asterisk. Pass variables as an object so the library escapes them.

## Dialplan

The AMI user is only part of the picture. A click-to-call Originate into `Context: 'from-internal'` can reach every route that context reaches, including international trunks. Originate into a dedicated context that allows only the destinations your application should call.
