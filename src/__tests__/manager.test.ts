import { describe, it, expect, vi } from 'vitest';
import { AsteriskManager } from '../manager';

const waitTick = () => new Promise((resolve) => process.nextTick(resolve));

describe('AsteriskManager - Ported Features', () => {
  it('should parse standard key-value AMI packages and emit events', async () => {
    // Create manager without connecting immediately by omitting port
    const ami = new AsteriskManager();
    const mockCallback = vi.fn();
    ami.on('managerevent', mockCallback);
    ami.on('peerstatus', mockCallback);

    const rawData = 'Event: PeerStatus\r\nPeer: SIP/101\r\nPeerStatus: Registered\r\n\r\n';
    
    // Feed raw data into internal handleData
    (ami as any).handleData(rawData);

    // Wait for process.nextTick emissions
    await waitTick();

    expect(mockCallback).toHaveBeenCalled();
    expect(mockCallback).toHaveBeenCalledWith({
      event: 'PeerStatus',
      peer: 'SIP/101',
      peerstatus: 'Registered',
    });
  });

  it('should queue actions before authentication and run them after login', async () => {
    const ami = new AsteriskManager();
    
    // Action should return a Promise since we don't pass a callback
    const actionPromise = ami.action({ action: 'Ping' });

    expect((ami as any).held).toHaveLength(1);
    expect((ami as any).held[0].action.action).toBe('Ping');

    // Simulate login success by resolving it
    const heldAction = (ami as any).held[0];
    heldAction.callback(null, { response: 'Success', message: 'Pong' });

    await expect(actionPromise).resolves.toEqual({ response: 'Success', message: 'Pong' });
  });

  it('should handle duplicate keys as arrays', async () => {
    const ami = new AsteriskManager();
    const mockCallback = vi.fn();
    ami.on('managerevent', mockCallback);

    const rawData = 'Event: UserEvent\r\nVariable: key1=val1\r\nVariable: key2=val2\r\n\r\n';
    (ami as any).handleData(rawData);

    // Wait for process.nextTick emissions
    await waitTick();

    expect(mockCallback).toHaveBeenCalledWith({
      event: 'UserEvent',
      variable: {
        key1: 'val1',
        key2: 'val2'
      }
    });
  });

  it('should format actions with nested variables correctly', () => {
    const ami = new AsteriskManager();
    const actionPayload = {
      action: 'Originate',
      channel: 'SIP/101',
      variables: {
        VAR1: 'VAL1',
        VAR2: 'VAL2'
      }
    };

    const rawString = (ami as any).makeManagerAction(actionPayload, 'test-id');
    
    expect(rawString).toContain('ActionID: test-id\r\n');
    expect(rawString).toContain('Action: Originate\r\n');
    expect(rawString).toContain('Channel: SIP/101\r\n');
    expect(rawString).toContain('Variables: VAR1=VAL1\r\n');
    expect(rawString).toContain('Variables: VAR2=VAL2\r\n');
  });
});
