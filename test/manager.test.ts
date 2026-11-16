import { afterEach, describe, expect, it } from 'vitest';
import {
  AmiActionError,
  AmiAuthError,
  AmiConnectionError,
  AmiTimeoutError,
  AsteriskManager,
  type AmiEvent,
  type ManagerOptions,
} from '../src/index.js';
import { FakeAmi, first } from './fake-ami.js';

let server: FakeAmi;
const clients: AsteriskManager[] = [];

async function setup(options: Partial<ManagerOptions> = {}) {
  server = new FakeAmi();
  const port = await server.listen();
  const ami = new AsteriskManager({
    port,
    username: 'admin',
    secret: 'secret',
    keepAlive: 0,
    actionTimeout: 1000,
    reconnect: { initialDelay: 20, maxDelay: 40 },
    ...options,
  });
  clients.push(ami);
  return ami;
}

const once = <T>(ami: AsteriskManager, event: string) =>
  new Promise<T>((resolve) => ami.once(event, ((value: T) => resolve(value)) as never));

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close();
  await server?.close();
});

describe('connect and login', () => {
  it('logs in, reads the greeting and delivers events', async () => {
    const ami = await setup();
    const booted = once<AmiEvent>(ami, 'FullyBooted');
    await ami.connect();
    expect(ami.state).toBe('ready');
    expect(ami.version).toBe('11.0.0');
    expect((await booted).Status).toBe('Fully Booted');
    const login = server.received[0]!;
    expect(first(login, 'events')).toBe('on');
    expect(first(login, 'secret')).toBe('secret');
  });

  it('rejects a wrong secret with AmiAuthError and no unhandled rejection', async () => {
    const ami = await setup({ secret: 'wrong' });
    await expect(ami.connect()).rejects.toBeInstanceOf(AmiAuthError);
    expect(ami.state).toBe('idle');
  });

  it('supports MD5 challenge login without sending the secret', async () => {
    const ami = await setup({ authType: 'md5', events: ['call', 'agent'] });
    await ami.connect();
    const login = server.received.find((h) => first(h, 'action') === 'Login')!;
    expect(first(login, 'secret')).toBeUndefined();
    expect(first(login, 'authtype')).toBe('MD5');
    expect(first(login, 'events')).toBe('call,agent');
  });

  it('rejects when nothing listens', async () => {
    const ami = new AsteriskManager({ port: 1, username: 'a', secret: 'b', reconnect: false, keepAlive: 0 });
    await expect(ami.connect()).rejects.toBeInstanceOf(AmiConnectionError);
  });

  it('times out when no greeting arrives', async () => {
    const ami = await setup({ connectTimeout: 100 });
    server.greeting = '';
    await expect(ami.connect()).rejects.toThrow(/greeting/);
  });

  it('rejects actions before connect()', async () => {
    const ami = await setup();
    await expect(ami.action({ Action: 'Ping' })).rejects.toBeInstanceOf(AmiConnectionError);
  });

  it('queues actions sent while connecting', async () => {
    const ami = await setup();
    const connecting = ami.connect();
    const ping = ami.action({ Action: 'Ping' });
    await connecting;
    expect((await ping).Ping).toBe('Pong');
  });
});

describe('actions', () => {
  it('resolves responses and rejects Response: Error', async () => {
    const ami = await setup();
    await ami.connect();
    expect((await ami.action({ Action: 'Ping' })).Ping).toBe('Pong');
    const error = await ami.action({ Action: 'NoSuchThing' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AmiActionError);
    expect((error as AmiActionError).response.Message).toMatch(/Invalid\/unknown command/);
  });

  it('refuses header injection before writing anything', async () => {
    const ami = await setup();
    await ami.connect();
    const before = server.raw.length;
    await expect(
      ami.action({ Action: 'Originate', Channel: 'PJSIP/101', CallerID: 'x\r\n\r\nAction: Command\r\nCommand: core stop now' }),
    ).rejects.toBeInstanceOf(TypeError);
    await ami.action({ Action: 'Ping' });
    expect(server.raw.length).toBe(before + 1);
  });

  it('times out with AmiTimeoutError', async () => {
    const ami = await setup();
    server.on('slow', () => {});
    await ami.connect();
    await expect(ami.action({ Action: 'Slow' }, { timeout: 50 })).rejects.toBeInstanceOf(AmiTimeoutError);
  });

  it('honours AbortSignal', async () => {
    const ami = await setup();
    server.on('slow', () => {});
    await ami.connect();
    const controller = new AbortController();
    const result = ami.action({ Action: 'Slow' }, { signal: controller.signal });
    controller.abort(new Error('stop'));
    await expect(result).rejects.toThrow('stop');
  });

  it('uses a caller-supplied ActionID and refuses duplicates', async () => {
    const ami = await setup();
    server.on('slow', () => {});
    await ami.connect();
    const a = ami.action({ Action: 'Slow', ActionID: 'same' }, { timeout: 100 });
    await expect(ami.action({ Action: 'Ping', ActionID: 'same' })).rejects.toThrow(/already in use/);
    await expect(a).rejects.toBeInstanceOf(AmiTimeoutError);
  });

  it('collects EventList results with list()', async () => {
    const ami = await setup();
    server.on('coreshowchannels', (_h, s, id) => {
      s.send({ Response: 'Success', ActionID: id, EventList: 'start', Message: 'Channels will follow' });
      s.send({ Event: 'CoreShowChannel', ActionID: id, Channel: 'PJSIP/101-00000001', Uniqueid: '1.1' });
      s.send({ Event: 'Newchannel', Channel: 'PJSIP/102-00000002' });
      s.send({ Event: 'CoreShowChannel', ActionID: id, Channel: 'PJSIP/103-00000003', Uniqueid: '1.3' });
      s.send({ Event: 'CoreShowChannelsComplete', ActionID: id, EventList: 'Complete', ListItems: '2' });
    });
    await ami.connect();
    const seen: string[] = [];
    ami.on('event', (e) => seen.push(e.Event));
    const result = await ami.list({ Action: 'CoreShowChannels' });
    expect(result.events.map((e) => e.Channel)).toEqual(['PJSIP/101-00000001', 'PJSIP/103-00000003']);
    expect(result.complete?.ListItems).toBe('2');
    expect(result.response.Message).toBe('Channels will follow');
    expect(seen).toEqual(['Newchannel']);
  });

  it('list() resolves a non-list response with no events', async () => {
    const ami = await setup();
    await ami.connect();
    const result = await ami.list({ Action: 'Ping' });
    expect(result.events).toEqual([]);
    expect(result.complete).toBeUndefined();
  });

  it('returns CLI output from command()', async () => {
    const ami = await setup();
    server.on('command', (h, s, id) => {
      expect(first(h, 'command')).toBe('core show version');
      s.send(`Response: Success\r\nActionID: ${id}\r\nMessage: Command output follows\r\nOutput: Asterisk 24.0.0 built by root\r\nOutput: second line\r\n\r\n`);
    });
    await ami.connect();
    expect(await ami.command('core show version')).toBe('Asterisk 24.0.0 built by root\nsecond line');
  });

  it('routes OriginateResponse as an event and waitFor() matches it', async () => {
    const ami = await setup();
    server.on('originate', (_h, s, id) => {
      s.send({ Response: 'Success', ActionID: id, Message: 'Originate successfully queued' });
      setTimeout(() => {
        s.send({ Event: 'OriginateResponse', ActionID: 'other', Response: 'Failure', Reason: '0', Channel: 'x', Uniqueid: '', CallerIDNum: '', CallerIDName: '' });
        s.send({ Event: 'OriginateResponse', ActionID: id, Response: 'Success', Reason: '4', Channel: 'PJSIP/101', Uniqueid: '1.5', CallerIDNum: '101', CallerIDName: 'x' });
      }, 20);
    });
    await ami.connect();
    const id = 'call-1';
    const result = ami.waitFor('OriginateResponse', (e) => e.ActionID === id, { timeout: 1000 });
    await ami.action({ Action: 'Originate', ActionID: id, Channel: 'PJSIP/101', Exten: '102', Context: 'internal', Priority: 1, Async: true });
    const event = await result;
    expect(event.Response).toBe('Success');
    expect(event.Reason).toBe('4');
  });

  it('waitFor() times out', async () => {
    const ami = await setup();
    await ami.connect();
    await expect(ami.waitFor('Hangup', undefined, { timeout: 30 })).rejects.toBeInstanceOf(AmiTimeoutError);
  });
});

describe('connection loss', () => {
  it('rejects in-flight actions, reconnects and replays queued ones', async () => {
    const ami = await setup();
    server.on('slow', () => {});
    await ami.connect();

    const inflight = ami.action({ Action: 'Slow' });
    const disconnected = once(ami, 'disconnect');
    await new Promise((r) => setTimeout(r, 20));
    server.dropAll();
    await expect(inflight).rejects.toBeInstanceOf(AmiConnectionError);
    await disconnected;
    expect(ami.state).toBe('reconnecting');

    const queued = ami.action({ Action: 'Ping' });
    await once(ami, 'ready');
    expect((await queued).Ping).toBe('Pong');
    expect(server.sessions).toHaveLength(2);
  });

  it('reconnects when keep-alive pings go unanswered', async () => {
    const ami = await setup({ keepAlive: 50 });
    await ami.connect();
    server.on('ping', () => {});
    const reconnecting = once<{ attempt: number }>(ami, 'reconnecting');
    expect((await reconnecting).attempt).toBe(1);
  });

  it('stops reconnecting when the secret becomes invalid', async () => {
    const ami = await setup();
    await ami.connect();
    server.secret = 'changed';
    const closed = once<Error>(ami, 'close');
    server.dropAll();
    expect(await closed).toBeInstanceOf(AmiAuthError);
    expect(ami.state).toBe('closed');
  });

  it('closes for good without reconnect when disabled', async () => {
    const ami = await setup({ reconnect: false });
    await ami.connect();
    const closed = once(ami, 'close');
    server.dropAll();
    await closed;
    expect(ami.state).toBe('closed');
    await expect(ami.action({ Action: 'Ping' })).rejects.toBeInstanceOf(AmiConnectionError);
  });

  it('close() logs off and does not reconnect', async () => {
    const ami = await setup();
    await ami.connect();
    let reconnects = 0;
    ami.on('reconnecting', () => reconnects++);
    await ami.close();
    expect(ami.state).toBe('closed');
    expect(server.received.some((h) => first(h, 'action') === 'Logoff')).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(reconnects).toBe(0);
  });

  it('can connect again after close()', async () => {
    const ami = await setup();
    await ami.connect();
    await ami.close();
    await ami.connect();
    expect((await ami.action({ Action: 'Ping' })).Ping).toBe('Pong');
  });
});
