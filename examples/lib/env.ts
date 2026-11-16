import { readFileSync } from 'node:fs';
import { AsteriskManager, type ManagerOptions } from 'asterisk-manager-ts';

/** Builds a client from AMI_* environment variables (see .env.example). */
export function managerFromEnv(options: Partial<ManagerOptions> = {}): AsteriskManager {
  const username = process.env.AMI_USERNAME;
  const secret = process.env.AMI_SECRET;
  if (!username || !secret) {
    console.error('Set AMI_USERNAME and AMI_SECRET (copy .env.example to .env and run with --env-file=.env)');
    process.exit(1);
  }
  const tls = process.env.AMI_TLS === '1';
  const ca = process.env.AMI_CA;
  return new AsteriskManager({
    host: process.env.AMI_HOST ?? '127.0.0.1',
    port: process.env.AMI_PORT ? Number(process.env.AMI_PORT) : undefined,
    username,
    secret,
    tls: tls ? (ca ? { ca: readFileSync(ca) } : true) : false,
    ...options,
  });
}

/** Closes the client on Ctrl+C. */
export function closeOnSignal(ami: AsteriskManager): void {
  process.once('SIGINT', () => {
    void ami.close().finally(() => process.exit(0));
  });
}
