import type { AmiAction, AmiActionValue, AmiScalar } from './types.js';

/** Asterisk reads each line into a 1024-byte buffer that also holds the CRLF. */
export const MAX_LINE_BYTES = 1022;
/** Asterisk keeps at most 128 headers per action (AST_MAX_MANHEADERS). */
export const MAX_HEADERS = 128;

const HEADER_NAME = /^[!-9;-~]+$/;

/**
 * Turns an action into the AMI wire format.
 * Throws if a header would break the framing or exceed Asterisk's limits.
 */
export function serializeAction(action: AmiAction, actionId: string): string {
  if (typeof action.Action !== 'string' || action.Action === '') {
    throw new TypeError('Action must be a non-empty string');
  }

  const lines = [line('Action', action.Action), line('ActionID', actionId)];

  for (const [key, value] of Object.entries(action)) {
    const lower = key.toLowerCase();
    if (lower === 'action' || lower === 'actionid') continue;
    for (const item of expand(key, value)) lines.push(line(key, item));
  }

  if (lines.length > MAX_HEADERS) {
    throw new RangeError(`${action.Action} has ${lines.length} headers; Asterisk accepts at most ${MAX_HEADERS}`);
  }
  return lines.join('\r\n') + '\r\n\r\n';
}

/**
 * Escapes a value for headers that Asterisk splits on commas, such as
 * `Variable` on Originate.
 */
export function escapeVariableValue(value: string): string {
  return value.replace(/[\\,"()[\]]/g, '\\$&');
}

function expand(key: string, value: AmiActionValue): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map((item) => scalar(key, item));
  if (typeof value === 'object') {
    return Object.entries(value).map(([name, item]) => {
      if (name === '' || name.includes('=')) {
        throw new TypeError(`Invalid variable name ${JSON.stringify(name)} in ${key}`);
      }
      return `${name}=${escapeVariableValue(scalar(key, item))}`;
    });
  }
  return [scalar(key, value as AmiScalar)];
}

function scalar(key: string, value: AmiScalar): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new TypeError(`Unsupported value for header ${key}`);
}

function line(key: string, value: string): string {
  if (!HEADER_NAME.test(key)) {
    throw new TypeError(`Invalid header name ${JSON.stringify(key)}`);
  }
  if (/[\r\n]/.test(value)) {
    throw new TypeError(`Header ${key} contains a line break; refusing to send it`);
  }
  const text = `${key}: ${value}`;
  if (Buffer.byteLength(text) > MAX_LINE_BYTES) {
    throw new RangeError(`Header ${key} is longer than the ${MAX_LINE_BYTES} bytes Asterisk accepts per line`);
  }
  return text;
}
