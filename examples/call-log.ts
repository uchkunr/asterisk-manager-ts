// Follows calls live and prints one line per finished call: who called whom,
// whether it was answered, talk time, and why it ended.
// node --env-file=.env call-log.ts
//
// Needs read = call. Local/ channels are ignored.
import { closeOnSignal, managerFromEnv } from './lib/env.ts';

interface Call {
  from: string;
  to: string;
  started: number;
  answered?: number;
  status?: string;
  channels: Set<string>;
}

const calls = new Map<string, Call>();
const isLocal = (channel: string | undefined) => channel?.startsWith('Local/') ?? false;

const ami = managerFromEnv({ events: ['call'] });

ami.on('Newchannel', (e) => {
  if (isLocal(e.Channel)) return;
  const call = calls.get(e.Linkedid) ?? { from: e.CallerIDNum, to: e.Exten, started: Date.now(), channels: new Set() };
  call.channels.add(e.Uniqueid);
  calls.set(e.Linkedid, call);
});

ami.on('DialEnd', (e) => {
  const call = calls.get(e.DestLinkedid);
  if (!call) return;
  call.status = e.DialStatus;
  if (e.DialStatus === 'ANSWER') {
    call.answered ??= Date.now();
    call.to = e.DestCallerIDNum || call.to;
  }
});

ami.on('Hangup', (e) => {
  const call = calls.get(e.Linkedid);
  if (!call) return;
  call.channels.delete(e.Uniqueid);
  if (call.channels.size > 0) return;
  calls.delete(e.Linkedid);
  const talk = call.answered ? Math.round((Date.now() - call.answered) / 1000) : 0;
  console.log(
    [
      new Date(call.started).toISOString(),
      `${call.from} -> ${call.to}`,
      call.answered ? `answered, ${talk}s` : (call.status ?? 'not answered'),
      `${e.Cause} ${e['Cause-txt']}${e.TechCause ? ` (${e.TechCause})` : ''}`,
    ].join('  '),
  );
});

// Events missed while disconnected are gone, so start from a clean state.
ami.on('disconnect', () => calls.clear());

closeOnSignal(ami);
await ami.connect();
console.error('Watching calls; Ctrl+C to stop');
