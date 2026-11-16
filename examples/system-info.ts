// Connects, prints version and call counts, and logs off.
// node --env-file=.env system-info.ts
import { managerFromEnv } from './lib/env.ts';

const ami = managerFromEnv({ events: false });
await ami.connect();

const settings = await ami.action({ Action: 'CoreSettings' });
const status = await ami.action({ Action: 'CoreStatus' });

console.log(`Asterisk ${settings.AsteriskVersion} (AMI ${ami.version}) on ${settings.SystemName || 'unnamed system'}`);
console.log(`Current calls: ${status.CoreCurrentCalls}`);
console.log(`Up since: ${status.CoreStartupDate} ${status.CoreStartupTime}`);

await ami.close();
