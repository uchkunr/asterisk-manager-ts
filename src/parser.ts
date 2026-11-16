import type { AmiMessage } from './types.js';

export type ParsedItem =
  | { type: 'greeting'; version: string }
  | { type: 'message'; message: AmiMessage };

const GREETING = 'Asterisk Call Manager/';
const END_COMMAND = '--END COMMAND--';
const MAX_PENDING = 16 * 1024 * 1024;

/**
 * Splits the AMI byte stream into messages.
 *
 * A message is a block of `Key: Value` lines ending with an empty line.
 * Repeated headers become arrays. The legacy `Response: Follows` format
 * (Asterisk 13 and older) is turned into `Output` headers, the same shape
 * newer versions send.
 */
export class AmiParser {
  #partial = '';
  #lines: string[] = [];
  #greeted = false;
  #follows = false;
  #followsOutput = false;

  reset(): void {
    this.#partial = '';
    this.#lines = [];
    this.#greeted = false;
    this.#follows = false;
    this.#followsOutput = false;
  }

  push(chunk: string): ParsedItem[] {
    const items: ParsedItem[] = [];
    const parts = (this.#partial + chunk).split('\n');
    this.#partial = parts.pop() ?? '';
    if (this.#partial.length > MAX_PENDING) {
      throw new Error(`AMI line longer than ${MAX_PENDING} bytes`);
    }

    for (const raw of parts) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

      if (!this.#greeted) {
        this.#greeted = true;
        if (line.startsWith(GREETING)) {
          items.push({ type: 'greeting', version: line.slice(GREETING.length).trim() });
          continue;
        }
      }

      if (this.#follows) {
        this.#readFollows(line, items);
        continue;
      }

      if (line === '') {
        if (this.#lines.length > 0) {
          items.push({ type: 'message', message: toMessage(this.#lines) });
          this.#lines = [];
        }
        continue;
      }

      if (this.#lines.length === 0 && /^Response:\s*Follows\s*$/i.test(line)) {
        this.#follows = true;
        this.#followsOutput = false;
      }
      this.#lines.push(line);
    }
    return items;
  }

  #readFollows(line: string, items: ParsedItem[]): void {
    if (line.endsWith(END_COMMAND)) {
      const rest = line.slice(0, -END_COMMAND.length);
      if (rest) this.#lines.push(`Output: ${rest}`);
      items.push({ type: 'message', message: toMessage(this.#lines) });
      this.#lines = [];
      this.#follows = false;
      return;
    }
    if (!this.#followsOutput && /^(Privilege|ActionID):/i.test(line)) {
      this.#lines.push(line);
      return;
    }
    this.#followsOutput = true;
    this.#lines.push(`Output: ${line}`);
  }
}

function toMessage(lines: string[]): AmiMessage {
  const message: Record<string, string | string[]> = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon);
    if (key === '__proto__') continue;
    const value = line.slice(colon + 1).replace(/^[ \t]+/, '');
    const existing = message[key];
    if (existing === undefined) message[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else message[key] = [existing, value];
  }
  return message;
}
