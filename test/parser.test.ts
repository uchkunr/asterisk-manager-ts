import { describe, expect, it } from 'vitest';
import { AmiParser } from '../src/parser.js';
import { escapeVariableValue, serializeAction } from '../src/serialize.js';
import { header, headerValues, variables } from '../src/headers.js';

describe('AmiParser', () => {
  it('reads the greeting and a message', () => {
    const p = new AmiParser();
    const items = p.push('Asterisk Call Manager/11.0.0\r\nResponse: Success\r\nActionID: 1\r\nPing: Pong\r\n\r\n');
    expect(items).toEqual([
      { type: 'greeting', version: '11.0.0' },
      { type: 'message', message: { Response: 'Success', ActionID: '1', Ping: 'Pong' } },
    ]);
  });

  it('joins messages split across chunks, with CRLF or LF', () => {
    const p = new AmiParser();
    expect(p.push('Asterisk Call Manager/11.0.0\r\nEvent: Hang')).toHaveLength(1);
    expect(p.push('up\r\nChannel: PJSIP/101-0000\r')).toHaveLength(0);
    const items = p.push('\n\r\nEvent: Newstate\nChannel: x\n\n');
    expect(items.map((i) => i.type === 'message' && i.message.Event)).toEqual(['Hangup', 'Newstate']);
  });

  it('keeps header case, colons in values and repeated headers', () => {
    const p = new AmiParser();
    const [, item] = p.push(
      'Asterisk Call Manager/11.0.0\r\nEvent: VarSet\r\nValue: sip:101@10.0.0.1:5060\r\nChanVariable: A=1\r\nChanVariable: B=x=y\r\n__proto__: bad\r\n\r\n',
    );
    if (item?.type !== 'message') throw new Error('expected message');
    expect(item.message.Value).toBe('sip:101@10.0.0.1:5060');
    expect(item.message.ChanVariable).toEqual(['A=1', 'B=x=y']);
    expect(Object.getPrototypeOf(item.message)).toBe(Object.prototype);
    expect(variables(item.message)).toEqual({ A: '1', B: 'x=y' });
    expect(header(item.message, 'value')).toBe('sip:101@10.0.0.1:5060');
    expect(headerValues(item.message, 'chanvariable')).toEqual(['A=1', 'B=x=y']);
  });

  it('turns legacy Response: Follows into Output headers', () => {
    const p = new AmiParser();
    const items = p.push(
      'Asterisk Call Manager/2.10.6\r\nResponse: Follows\r\nPrivilege: Command\r\nActionID: 7\r\nAsterisk 13.38.3 built by x\r\nUptime: 5 minutes\r\nlast line--END COMMAND--\r\n\r\n',
    );
    expect(items[1]).toEqual({
      type: 'message',
      message: {
        Response: 'Follows',
        Privilege: 'Command',
        ActionID: '7',
        Output: ['Asterisk 13.38.3 built by x', 'Uptime: 5 minutes', 'last line'],
      },
    });
  });

  it('works without a greeting', () => {
    const p = new AmiParser();
    expect(p.push('Event: Hangup\r\n\r\n')).toEqual([{ type: 'message', message: { Event: 'Hangup' } }]);
  });
});

describe('serializeAction', () => {
  it('puts Action and ActionID first and keeps order', () => {
    expect(serializeAction({ Action: 'Hangup', Channel: 'PJSIP/101-1', Cause: 16 }, 'a-1')).toBe(
      'Action: Hangup\r\nActionID: a-1\r\nChannel: PJSIP/101-1\r\nCause: 16\r\n\r\n',
    );
  });

  it('repeats headers for arrays and objects, escaping variable values', () => {
    const text = serializeAction(
      { Action: 'Originate', Variable: { CALLERID: 'A, B', NOTE: 'x(y)' }, Codecs: ['ulaw', 'alaw'], Skip: undefined, Null: null, Async: true },
      '1',
    );
    expect(text).toContain('Variable: CALLERID=A\\, B\r\n');
    expect(text).toContain('Variable: NOTE=x\\(y\\)\r\n');
    expect(text).toContain('Codecs: ulaw\r\nCodecs: alaw\r\n');
    expect(text).toContain('Async: true\r\n');
    expect(text).not.toContain('Skip');
    expect(text).not.toContain('Null');
  });

  it('refuses line breaks, bad header names and oversize input', () => {
    expect(() => serializeAction({ Action: 'Originate', CallerID: 'x\r\n\r\nAction: Command' }, '1')).toThrow(TypeError);
    expect(() => serializeAction({ Action: 'Ping', 'Bad Name': 'x' }, '1')).toThrow(TypeError);
    expect(() => serializeAction({ Action: 'Ping', 'Bad:Name': 'x' }, '1')).toThrow(TypeError);
    expect(() => serializeAction({ Action: 'Ping', Data: 'x'.repeat(1100) }, '1')).toThrow(RangeError);
    const many = Object.fromEntries(Array.from({ length: 130 }, (_, i) => [`H${i}`, 'x']));
    expect(() => serializeAction({ Action: 'UserEvent', ...many }, '1')).toThrow(RangeError);
    expect(() => serializeAction({ Action: 'Originate', Variable: { 'A=B': 'x' } }, '1')).toThrow(TypeError);
  });

  it('ignores ActionID and action keys in the body', () => {
    expect(serializeAction({ Action: 'Ping', ActionID: 'mine' }, 'mine')).toBe('Action: Ping\r\nActionID: mine\r\n\r\n');
  });

  it('escapes every character Asterisk treats specially', () => {
    expect(escapeVariableValue('a\\b,"c"[d](e)')).toBe('a\\\\b\\,\\"c\\"\\[d\\]\\(e\\)');
  });
});
