// Rings a phone, then dials a number from it when answered.
// node --env-file=.env click-to-call.ts PJSIP/101 0951234567 [context]
//
// The AMI user needs write = originate. Use a context that only reaches the
// destinations you want this tool to call.
import { randomUUID } from 'node:crypto';
import { managerFromEnv } from './lib/env.ts';

const [channel, number, context = 'from-internal'] = process.argv.slice(2);
if (!channel || !number || !/^[0-9+*#]{1,32}$/.test(number)) {
  console.error('usage: click-to-call.ts <channel e.g. PJSIP/101> <number> [context]');
  process.exit(1);
}

const reasons: Record<string, string> = {
  '0': 'failed (no such channel or extension)',
  '1': 'hung up',
  '3': 'no answer',
  '4': 'answered',
  '5': 'busy',
  '8': 'congestion',
};

const ami = managerFromEnv({ events: ['call'] });
await ami.connect();

const actionId = `c2c-${randomUUID()}`;
const uniqueId = randomUUID();
const outcome = ami.waitFor('OriginateResponse', (e) => e.ActionID === actionId, { timeout: 45_000 });

await ami.action({
  Action: 'Originate',
  ActionID: actionId,
  Channel: channel,
  Context: context,
  Exten: number,
  Priority: 1,
  CallerID: `Call to ${number} <${number}>`,
  Timeout: 30_000,
  Async: true,
  ChannelId: uniqueId,
  Variable: { ORIGINATED_BY: 'click-to-call' },
});
console.log(`Ringing ${channel} (Uniqueid ${uniqueId})...`);

try {
  const event = await outcome;
  console.log(`${event.Response}: ${reasons[event.Reason] ?? `reason ${event.Reason}`}`);
} finally {
  await ami.close();
}
