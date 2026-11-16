// Prints live events. Pass event names to show only those.
// node --env-file=.env watch-events.ts
// node --env-file=.env watch-events.ts Newchannel Hangup DialEnd
import { closeOnSignal, managerFromEnv } from './lib/env.ts';

const only = new Set(process.argv.slice(2));
const ami = managerFromEnv();

ami.on('event', (event) => {
  if (only.size > 0 && !only.has(event.Event)) return;
  console.log(new Date().toISOString(), JSON.stringify(event));
});
ami.on('ready', () => console.error('ready'));
ami.on('disconnect', (error) => console.error('disconnected', error?.message ?? ''));
ami.on('reconnecting', ({ attempt, delay }) => console.error(`reconnect #${attempt} in ${delay} ms`));
ami.on('close', (error) => console.error('closed', error?.message ?? ''));

closeOnSignal(ami);
await ami.connect();
