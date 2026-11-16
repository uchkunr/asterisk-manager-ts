// Checks the built package through its public entry point (run after `npm run build`).
import assert from 'node:assert/strict';
import { AsteriskManager, AmiAuthError, serializeAction } from 'asterisk-manager-ts';

assert.equal(typeof AsteriskManager, 'function');
assert.ok(new AmiAuthError('x') instanceof Error);
assert.equal(serializeAction({ Action: 'Ping' }, '1'), 'Action: Ping\r\nActionID: 1\r\n\r\n');
console.log('esm ok');
