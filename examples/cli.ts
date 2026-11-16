// Runs an Asterisk CLI command through AMI. Needs write = command, which can run
// any CLI command, so use a dedicated admin user for this.
// node --env-file=.env cli.ts "pjsip show endpoints"
import { managerFromEnv } from './lib/env.ts';

const command = process.argv.slice(2).join(' ');
if (!command) {
  console.error('usage: cli.ts "<cli command>"');
  process.exit(1);
}

const ami = managerFromEnv({ events: false });
await ami.connect();
try {
  console.log(await ami.command(command));
} finally {
  await ami.close();
}
