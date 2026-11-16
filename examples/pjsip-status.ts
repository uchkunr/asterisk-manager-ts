// Shows PJSIP endpoints with their state and registered contacts.
// node --env-file=.env pjsip-status.ts
import { AmiActionError, type AmiEvent } from 'asterisk-manager-ts';
import { managerFromEnv } from './lib/env.ts';

const ami = managerFromEnv({ events: false });
await ami.connect();

// Both answer Response: Error when the list is empty.
async function listOrEmpty(action: string): Promise<AmiEvent[]> {
  try {
    return (await ami.list({ Action: action })).events;
  } catch (error) {
    if (error instanceof AmiActionError && /^No .* found/i.test(error.response.Message ?? '')) return [];
    throw error;
  }
}

const endpoints = await listOrEmpty('PJSIPShowEndpoints');
const contacts = await listOrEmpty('PJSIPShowContacts');

for (const endpoint of endpoints) {
  const name = String(endpoint.ObjectName);
  console.log(`${name.padEnd(20)} ${String(endpoint.DeviceState).padEnd(12)} channels: ${endpoint.ActiveChannels || 0}`);
  for (const contact of contacts.filter((c) => c.Endpoint === name)) {
    const rtt = contact.RoundtripUsec && contact.RoundtripUsec !== 'N/A' ? `${(Number(contact.RoundtripUsec) / 1000).toFixed(1)} ms` : '';
    console.log(`    ${String(contact.Status).padEnd(12)} ${contact.Uri} ${rtt} ${contact.UserAgent ?? ''}`);
  }
}

await ami.close();
