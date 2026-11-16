// require() of the ESM build works on Node.js 22.12 and later.
const assert = require('node:assert/strict');
const { AsteriskManager, AmiConnectionError } = require('asterisk-manager-ts');

assert.equal(typeof AsteriskManager, 'function');
assert.ok(new AmiConnectionError('x') instanceof Error);
console.log('cjs ok');
