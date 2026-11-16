// Hangs up a channel by name.
// node --env-file=.env hangup.ts PJSIP/101-0000002a [cause]
import { AmiActionError } from 'asterisk-manager-ts';
import { managerFromEnv } from './lib/env.ts';

const [channel, cause = '16'] = process.argv.slice(2);
if (!channel || channel.startsWith('/')) {
  console.error('usage: hangup.ts <exact channel name> [Q.850 cause, default 16]');
  process.exit(1);
}

const ami = managerFromEnv({ events: false });
await ami.connect();
try {
  await ami.action({ Action: 'Hangup', Channel: channel, Cause: Number(cause) });
  console.log(`Hung up ${channel}`);
} catch (error) {
  if (!(error instanceof AmiActionError)) throw error;
  console.error(error.response.Message);
  process.exitCode = 1;
} finally {
  await ami.close();
}
