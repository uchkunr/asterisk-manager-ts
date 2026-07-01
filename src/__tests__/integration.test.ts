import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as net from 'net';
import { AsteriskManager } from '../manager';

describe('AsteriskManager - Real TCP Integration Tests', () => {
  let server: net.Server;
  let serverPort: number;
  let lastClientSocket: net.Socket | null = null;

  beforeAll(() => {
    return new Promise<void>((resolve) => {
      server = net.createServer((socket) => {
        lastClientSocket = socket;
        
        // Send Asterisk greeting
        socket.write('Asterisk Call Manager/2.10.4\r\n');

        let buffer = '';
        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          let boundary: number;
          while ((boundary = buffer.indexOf('\r\n\r\n')) !== -1) {
            const packetStr = buffer.substring(0, boundary);
            buffer = buffer.substring(boundary + 4);

            // Parse simple actions
            const lines = packetStr.split('\r\n');
            let action = '';
            let actionId = '';
            lines.forEach((line) => {
              const parts = line.split(': ');
              if (parts[0].toLowerCase() === 'action') action = parts[1];
              if (parts[0].toLowerCase() === 'actionid') actionId = parts[1];
            });

            if (action.toLowerCase() === 'login') {
              socket.write(`Response: Success\r\nActionID: ${actionId}\r\nMessage: Authentication accepted\r\n\r\n`);
            } else if (action.toLowerCase() === 'ping') {
              socket.write(`Response: Success\r\nActionID: ${actionId}\r\nPing: Pong\r\n\r\n`);
            } else if (action.toLowerCase() === 'getvar') {
              socket.write(`Response: Success\r\nActionID: ${actionId}\r\nVariable: testvar\r\nValue: testvalue\r\n\r\n`);
            }
          }
        });
      });

      // Bind to an ephemeral port automatically assigned by OS
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as net.AddressInfo;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(() => {
    return new Promise<void>((resolve) => {
      if (lastClientSocket) {
        lastClientSocket.destroy();
      }
      server.close(() => resolve());
    });
  });

  it('should successfully connect, authenticate, and send actions over real TCP', async () => {
    const ami = new AsteriskManager(serverPort, '127.0.0.1', 'admin', 'secret', false);

    // Test connection and authentication
    await new Promise<void>((resolve, reject) => {
      ami.on('ready', () => resolve());
      ami.on('error', (err) => reject(err));
    });

    expect(ami.isConnected()).toBe(true);

    // Test sending an action (Promise style)
    const pingResponse = await ami.action({ action: 'Ping' });
    expect(pingResponse).toBeDefined();
    expect(pingResponse.response.toLowerCase()).toBe('success');
    expect(pingResponse.ping.toLowerCase()).toBe('pong');

    // Test sending an action (Callback style)
    const callbackResponse = await new Promise<any>((resolve, reject) => {
      ami.action({ action: 'GetVar', variable: 'testvar' }, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
    });
    expect(callbackResponse.response.toLowerCase()).toBe('success');
    expect(callbackResponse.value).toBe('testvalue');

    // Clean up client
    ami.disconnect();
    expect(ami.isConnected()).toBe(false);
  });

  it('should trigger events correctly', async () => {
    const ami = new AsteriskManager(serverPort, '127.0.0.1', 'admin', 'secret', false);

    await new Promise<void>((resolve) => {
      ami.on('ready', () => resolve());
    });

    // Send mock event from server to client
    const eventPromise = new Promise<any>((resolve) => {
      ami.on('peerstatus', (evt) => resolve(evt));
    });

    if (lastClientSocket) {
      lastClientSocket.write(
        'Event: PeerStatus\r\n' +
        'Peer: SIP/200\r\n' +
        'PeerStatus: Registered\r\n\r\n'
      );
    }

    const event = await eventPromise;
    expect(event.event.toLowerCase()).toBe('peerstatus');
    expect(event.peer).toBe('SIP/200');
    expect(event.peerstatus).toBe('Registered');

    ami.disconnect();
  });
});
