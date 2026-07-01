import { EventEmitter } from 'events';
import * as net from 'net';

export interface AsteriskManagerOptions {
  port?: number;
  host?: string;
  username?: string;
  password?: string;
  events?: boolean | 'on' | 'off';
}

export class AsteriskManager extends EventEmitter {
  public options: Required<AsteriskManagerOptions>;
  
  private connection?: net.Socket;
  private authenticated = false;
  private lines: string[] = [];
  private leftOver = '';
  private held: { action: Record<string, any>; callback: (err: any, res?: any) => void }[] = [];
  private backoff = 10000;
  private lastid = '';
  private reconnectHandler?: () => void;

  constructor(
    port?: number,
    host?: string,
    username?: string,
    password?: string,
    events?: boolean | 'on' | 'off'
  ) {
    super();

    this.options = {
      port: port ?? 5038,
      host: host ?? '',
      username: username ?? '',
      password: password ?? '',
      events: events ?? false
    };

    this.on('rawevent', (event) => this.handleManagerEvent(event));
    this.on('error', () => {}); // Prevent unhandled error crashes
    this.on('connect', () => {
      this.backoff = 10000;
    });

    if (port) {
      this.connect(
        this.options.port,
        this.options.host,
        this.options.username ? () => this.login() : undefined
      );
    }
  }

  /**
   * Check if the socket connection is currently open.
   */
  public isConnected(): boolean {
    return !!(this.connection && this.connection.readyState === 'open');
  }

  public connected(): boolean {
    return this.isConnected();
  }

  /**
   * Connect to the Asterisk Manager Interface TCP Socket.
   */
  public connect(port?: number, host?: string, callback?: (err: any) => void): void {
    const cb = callback || (() => {});
    const targetPort = port ?? this.options.port;
    const targetHost = host ?? this.options.host;

    if (this.connection && this.connection.readyState !== 'closed') {
      cb(null);
      return;
    }

    this.authenticated = false;
    this.connection = net.createConnection(targetPort, targetHost);
    this.connection.setKeepAlive(true);
    this.connection.setNoDelay(true);
    this.connection.setEncoding('utf8');

    this.connection.once('connect', () => cb(null));
    this.connection.on('connect', () => this.emit('connect'));
    this.connection.on('close', () => this.emit('close'));
    this.connection.on('end', () => this.emit('end'));
    this.connection.on('data', (data) => this.handleData(String(data)));
    this.connection.on('error', (err) => this.handleConnectionError(err));
  }

  /**
   * Authenticate and login to the AMI.
   */
  public login(callback?: (err: any, res?: any) => void): any {
    const loginAction = {
      action: 'login',
      username: this.options.username,
      secret: this.options.password,
      event: this.options.events ? 'on' : 'off'
    };

    const runLoginAction = (handler: (err: any, res?: any) => void) => {
      this.action(loginAction, (err, res) => {
        if (err) {
          return handler(err);
        }
        this.authenticated = true;
        this.emit('ready');
        process.nextTick(() => handler(null, res));

        const held = this.held;
        this.held = [];
        held.forEach((item) => {
          this.action(item.action, item.callback);
        });
      });
    };

    if (!callback) {
      return new Promise((resolve, reject) => {
        runLoginAction((err, res) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    }

    runLoginAction(callback);
  }

  /**
   * Set up auto-reconnect strategy.
   */
  public keepConnected(): void {
    if (this.reconnectHandler) return;
    this.reconnectHandler = () => this.reconnect();
    this.on('close', this.reconnectHandler);
  }

  private reconnect(): void {
    console.log(`Trying to reconnect to AMI in ${this.backoff / 1000} seconds`);

    setTimeout(() => {
      this.connect(
        this.options.port,
        this.options.host,
        this.options.username ? () => this.login() : undefined
      );
    }, this.backoff);

    if (this.backoff < 60000) {
      this.backoff += 10000;
    }
  }

  /**
   * Disconnect and clear reconnect handlers.
   */
  public disconnect(callback?: () => void): void {
    if (this.reconnectHandler) {
      this.removeListener('close', this.reconnectHandler);
      this.reconnectHandler = undefined;
    }

    if (this.connection && this.connection.readyState === 'open') {
      this.connection.end();
    }

    this.connection = undefined;

    if (typeof callback === 'function') {
      setImmediate(callback);
    }
  }

  /**
   * Send an action to Asterisk.
   * If not authenticated, queues action and executes it once authenticated.
   */
  public action(
    actionData: Record<string, any>,
    callback?: (err: any, res?: any) => void
  ): any {
    actionData = { ...actionData };
    
    let id = actionData.actionid || String(Date.now());
    while (this.listeners(id).length > 0) {
      id += String(Math.floor(Math.random() * 9));
    }

    if (actionData.actionid) {
      delete actionData.actionid;
    }

    const send = () => {
      if (!this.connection) {
        throw new Error('There is no connection yet');
      }
      this.connection.write(this.makeManagerAction(actionData, id), 'utf8');
    };

    if (!callback) {
      return new Promise((resolve, reject) => {
        const handler = (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        };

        if (!this.authenticated && actionData.action !== 'login') {
          actionData.actionid = id;
          this.held.push({ action: actionData, callback: handler });
          return;
        }

        try {
          this.once(id, handler);
          this.lastid = id;
          send();
        } catch (e) {
          console.error('ERROR: ', e);
          this.removeListener(id, handler);
          actionData.actionid = id;
          this.held.push({ action: actionData, callback: handler });
        }
      });
    }

    if (!this.authenticated && actionData.action !== 'login') {
      actionData.actionid = id;
      this.held.push({ action: actionData, callback });
      return id;
    }

    try {
      this.once(id, callback);
      this.lastid = id;
      send();
    } catch (e) {
      console.error('ERROR: ', e);
      this.removeListener(id, callback);
      actionData.actionid = id;
      this.held.push({ action: actionData, callback });
    }

    return id;
  }

  /**
   * Format the AMI action payload to its raw textual string format.
   */
  private makeManagerAction(req: Record<string, any>, id: string): string {
    const msg: string[] = [];
    msg.push(`ActionID: ${id}`);

    Object.keys(req).forEach((key) => {
      const cleanKey = key.trim();
      const lowerKey = cleanKey.toLowerCase();
      if (!lowerKey.length || lowerKey === 'actionid') return;

      const val = req[key];
      const capitalizedKey = cleanKey.charAt(0).toUpperCase() + cleanKey.slice(1);

      switch (typeof val) {
        case 'undefined':
          return;
        case 'object':
          if (!val) return;
          if (Array.isArray(val)) {
            const arrayVal = val.map((e) => String(e)).join(',');
            msg.push(`${capitalizedKey}: ${arrayVal}`);
          } else if (!(val instanceof RegExp)) {
            // Map variable sub-objects (e.g. Variable: varname=value)
            Object.keys(val).forEach((name) => {
              msg.push(`${capitalizedKey}: ${name}=${val[name]}`);
            });
            return;
          }
          break;
        default:
          msg.push(`${capitalizedKey}: ${String(val)}`);
          break;
      }
    });

    msg.sort();
    return msg.join('\r\n') + '\r\n\r\n';
  }

  /**
   * Read raw connection chunks and parse them into items.
   */
  private handleData(data: string): void {
    this.leftOver += data;
    const rawLines = this.leftOver.split(/\r?\n/);
    this.leftOver = rawLines.pop() || '';
    this.lines = this.lines.concat(rawLines);

    let lines: string[] = [];
    let follow = 0;
    let item: Record<string, any> = {};

    while (this.lines.length > 0) {
      let line = this.lines.shift()!;
      
      // Ignore Greeting
      if (!lines.length && line.startsWith('Asterisk Call Manager')) {
        continue;
      } 
      
      // Check for follow command output start
      if (!lines.length && line.toLowerCase().startsWith('response:') && line.toLowerCase().includes('follow')) {
        follow = 1;
        lines.push(line);
      } 
      // Check for follow command output end
      else if (follow && (line === '--END COMMAND--' || line === '--END SMS EVENT--')) {
        follow = 2;
        lines.push(line);
      } 
      // Emit parsed follows event
      else if (follow > 1 && !line.length) {
        follow = 0;
        lines.pop();
        item = {
          response: 'follows',
          content: lines.join('\n')
        };

        const matches = item.content.match(/actionid: ([^\r\n]+)/i);
        if (matches) {
          item.actionid = matches[1];
        }

        lines = [];
        this.emit('rawevent', item);
      } 
      // Emit parsed standard package
      else if (!follow && !line.length) {
        lines = lines.filter((l) => l && l.length > 0);
        item = {};
        
        while (lines.length > 0) {
          line = lines.shift()!;
          const parts = line.split(': ');
          const rawKey = parts.shift() || '';
          const key = rawKey.trim().toLowerCase();
          const val = parts.join(': ');

          if (key === 'variable' || key === 'chanvariable') {
            if (typeof item[key] !== 'object' || item[key] === null) {
              item[key] = {};
            }
            const valParts = val.split('=');
            const subkey = valParts.shift() || '';
            item[key][subkey] = valParts.join('=');
          } else {
            if (key in item) {
              if (Array.isArray(item[key])) {
                item[key].push(val);
              } else {
                item[key] = [item[key], val];
              }
            } else {
              item[key] = val;
            }
          }
        }
        lines = [];
        this.emit('rawevent', item);
      } else {
        lines.push(line);
      }
    }
    this.lines = lines;
  }

  private handleConnectionError(err: Error): void {
    this.emit('error', err);
  }

  private handleManagerEvent(event: Record<string, any>): void {
    const emits: (() => void)[] = [];

    if (event.response && event.actionid && typeof event.response === 'string') {
      const errorObj = event.response.toLowerCase() === 'error' ? event : undefined;
      emits.push(() => this.emit(event.actionid, errorObj, event));
      emits.push(() => this.emit('response', event));
    } else if (event.response && event.content) {
      emits.push(() => this.emit(this.lastid, undefined, event));
      emits.push(() => this.emit('response', event));
    }

    if (event.event) {
      let eventName = Array.isArray(event.event) ? event.event[0] : event.event;
      eventName = String(eventName);
      emits.push(() => this.emit('managerevent', event));
      emits.push(() => this.emit(eventName.toLowerCase(), event));
      if (eventName.toLowerCase() === 'userevent' && event.userevent) {
        emits.push(() => this.emit(`userevent-${String(event.userevent).toLowerCase()}`, event));
      }
    } else if (!event.response) {
      emits.push(() => this.emit('asterisk', event));
    }

    emits.forEach((emitFn) => process.nextTick(emitFn));
  }
}
