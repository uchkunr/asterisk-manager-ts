# asterisk-manager-ts

[![npm version](https://img.shields.io/npm/v/asterisk-manager-ts.svg?style=flat)](https://www.npmjs.com/package/asterisk-manager-ts)
[![CI](https://github.com/uchkunr/asterisk-manager-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/uchkunr/asterisk-manager-ts/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/asterisk-manager-ts.svg?style=flat)](LICENSE)

A typed, dependency-free client for the Asterisk Manager Interface (AMI), plus a practical guide to AMI and a skill that teaches it to Claude Code and Codex.

- Promises, typed events, and `list()` for actions that return many items
- Reconnects with backoff, keep-alive `Ping`, timeouts and `AbortSignal` on every call
- Refuses CR/LF in header values, so user input cannot inject AMI actions
- TLS and MD5 challenge login
- ESM, Node.js 22.12 or later (`require()` works too)

```bash
npm install asterisk-manager-ts
```

```ts
import { AsteriskManager } from 'asterisk-manager-ts';

const ami = new AsteriskManager({
  host: 'pbx.internal',
  username: 'crm',
  secret: process.env.AMI_SECRET!,
  events: ['call'],
});

ami.on('Hangup', (e) => console.log(e.Channel, e.Cause, e['Cause-txt']));
await ami.connect();

const { AsteriskVersion } = await ami.action({ Action: 'CoreSettings' });
const { events: channels } = await ami.list({ Action: 'CoreShowChannels' });
const output = await ami.command('pjsip show endpoints');

await ami.close();
```

Upgrading from 1.x? The API changed; see [the migration table](docs/client.md#migrating-from-1x).

## Docs

| Page | What it covers |
| --- | --- |
| [Overview](docs/overview.md) | What AMI is, AMI vs ARI vs AGI, the protocol in one screen, version differences |
| [Setup](docs/setup.md) | manager.conf, users, permission classes, TLS, event filters |
| [Client](docs/client.md) | This library: options, methods, events, errors, reconnect behaviour, migration from 1.x |
| [Actions](docs/actions.md) | Originate, Hangup, Redirect, transfers, variables, channels, PJSIP, queues, recording, AstDB |
| [Events](docs/events.md) | Call flow, tracking calls by Linkedid, DialEnd and Hangup causes, endpoints, queues |
| [Protocol](docs/protocol.md) | Wire format, login, lists, Command output, Variable splitting, limits, injection |
| [Security](docs/security.md) | Network exposure, least privilege, input handling, dialplan scope |
| [Troubleshooting](docs/troubleshooting.md) | Symptoms, causes and fixes |

## Examples

Runnable TypeScript in [`examples/`](examples). Node.js 22.18 or later runs the `.ts` files directly.

```bash
npm install && npm run build
cd examples && npm install
cp .env.example .env    # set AMI_HOST, AMI_USERNAME, AMI_SECRET
node --env-file=.env system-info.ts
```

| Script | What it does |
| --- | --- |
| [`system-info.ts`](examples/system-info.ts) | Asterisk version, current calls, uptime |
| [`watch-events.ts`](examples/watch-events.ts) | Live event log, optionally for some events only |
| [`active-calls.ts`](examples/active-calls.ts) | Active channels grouped into calls |
| [`call-log.ts`](examples/call-log.ts) | One line per finished call: parties, answered, talk time, cause |
| [`click-to-call.ts`](examples/click-to-call.ts) | Async Originate and its `OriginateResponse` |
| [`pjsip-status.ts`](examples/pjsip-status.ts) | PJSIP endpoints and registered contacts |
| [`queue-status.ts`](examples/queue-status.ts) | Callers and members per queue |
| [`hangup.ts`](examples/hangup.ts) | Hang up a channel |
| [`cli.ts`](examples/cli.ts) | Run a CLI command |

## Skill for Claude Code and Codex

[`skills/asterisk-ami`](skills/asterisk-ami/SKILL.md) gives an AI coding agent the rules from this guide: ActionID matching, EventList actions, Async Originate, call tracking, permission classes, filters, reconnects and injection. It follows the [Agent Skills](https://agentskills.io) format.

**Claude Code**

```text
/plugin install asterisk-ami --marketplace uchkunr/asterisk-manager-ts
```

On older versions: `/plugin marketplace add uchkunr/asterisk-manager-ts`, then `/plugin install asterisk-ami@asterisk-manager-ts`.

**Codex**

```bash
codex plugin marketplace add uchkunr/asterisk-manager-ts
codex plugin add asterisk-ami@asterisk-manager-ts
```

**Manual install.** Copy `skills/asterisk-ami` to `~/.claude/skills/` (Claude Code) or `~/.agents/skills/` (Codex), or to `.claude/skills/` / `.agents/skills/` inside one project.

## Development

```bash
npm install
npm run typecheck
npm test          # against a fake AMI server
npm run build
npm run smoke     # import and require the built package
```

## License

[MIT](LICENSE). Version 1.x was a port of [NodeJS-AsteriskManager](https://github.com/pipobscure/NodeJS-AsteriskManager); its notice is kept in the license file.

Asterisk is a registered trademark of Sangoma Technologies. This project is not affiliated with or endorsed by Sangoma.
