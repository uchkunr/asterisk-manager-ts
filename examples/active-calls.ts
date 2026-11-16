// Lists active calls, grouping channels by Linkedid.
// node --env-file=.env active-calls.ts
import type { CoreShowChannelEvent } from 'asterisk-manager-ts';
import { managerFromEnv } from './lib/env.ts';

const ami = managerFromEnv({ events: false });
await ami.connect();

const { events } = await ami.list<CoreShowChannelEvent>({ Action: 'CoreShowChannels' });
const calls = Map.groupBy(events, (channel) => channel.Linkedid);

if (calls.size === 0) console.log('No active calls');
for (const [linkedId, channels] of calls) {
  console.log(`Call ${linkedId}`);
  for (const c of channels) {
    console.log(
      `  ${c.Channel.padEnd(32)} ${c.ChannelStateDesc.padEnd(8)} ${c.Duration.padStart(8)}  ${c.CallerIDNum} -> ${c.ConnectedLineNum}  ${c.Application}(${c.ApplicationData})`,
    );
  }
}

await ami.close();
