import { AsteriskManager } from './manager';

function createManager(
  port?: number,
  host?: string,
  username?: string,
  password?: string,
  events?: boolean | 'on' | 'off'
): AsteriskManager {
  return new AsteriskManager(port, host, username, password, events);
}

const exportObject = Object.assign(createManager, {
  AsteriskManager,
  createManager
});

export = exportObject;
