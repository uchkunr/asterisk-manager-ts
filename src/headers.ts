import type { AmiMessage } from './types.js';

/** First value of a header, matched case-insensitively. */
export function header(message: AmiMessage, name: string): string | undefined {
  const value = message[name] ?? findInsensitive(message, name);
  return Array.isArray(value) ? value[0] : value;
}

/** Every value of a header, matched case-insensitively. */
export function headerValues(message: AmiMessage, name: string): string[] {
  const value = message[name] ?? findInsensitive(message, name);
  if (value === undefined) return [];
  return Array.isArray(value) ? [...value] : [value];
}

/**
 * Collects `name=value` headers into an object, for example
 * `ChanVariable` on channel events or `Variable` on some responses.
 */
export function variables(message: AmiMessage, name = 'ChanVariable'): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of headerValues(message, name)) {
    const eq = item.indexOf('=');
    if (eq <= 0) continue;
    result[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return result;
}

function findInsensitive(message: AmiMessage, name: string) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(message)) {
    if (key.toLowerCase() === lower) return message[key];
  }
  return undefined;
}
