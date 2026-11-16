// Prints callers waiting and member states for each queue.
// node --env-file=.env queue-status.ts [queue]
import { managerFromEnv } from './lib/env.ts';

const states: Record<string, string> = {
  '0': 'unknown',
  '1': 'idle',
  '2': 'in use',
  '3': 'busy',
  '4': 'invalid',
  '5': 'unavailable',
  '6': 'ringing',
  '7': 'ring+in use',
  '8': 'on hold',
};

const ami = managerFromEnv({ events: false });
await ami.connect();

const queue = process.argv[2];
const { events } = await ami.list({ Action: 'QueueStatus', Queue: queue });

for (const e of events) {
  if (e.Event === 'QueueParams') {
    console.log(`\n${e.Queue}: ${e.Calls} waiting, holdtime ${e.Holdtime}s, completed ${e.Completed}, abandoned ${e.Abandoned}`);
  } else if (e.Event === 'QueueMember') {
    const paused = e.Paused === '1' ? ` paused${e.PausedReason ? ` (${e.PausedReason})` : ''}` : '';
    console.log(`  member ${String(e.Name).padEnd(20)} ${states[String(e.Status)] ?? e.Status}${paused}, calls taken ${e.CallsTaken}`);
  } else if (e.Event === 'QueueEntry') {
    console.log(`  caller #${e.Position} ${e.CallerIDNum} waiting ${e.Wait}s`);
  }
}

await ami.close();
