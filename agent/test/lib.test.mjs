import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, resolveInside } from '../lib.mjs';

test('parses a valid command', () => {
  const now = Date.now();
  const command = parseCommand('couchcode:' + JSON.stringify({
    version: 1,
    id: 'command-001',
    deviceId: 'android-1234',
    project: 'sample',
    action: 'status',
    args: {},
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 300_000).toISOString(),
  }), now);
  assert.equal(command.action, 'status');
});

test('rejects paths outside project root', () => {
  assert.throws(() => resolveInside('/tmp/project', '../../etc/passwd'), /escapes/);
});

test('allows paths inside project root', () => {
  assert.equal(resolveInside('/tmp/project', 'src/App.tsx'), '/tmp/project/src/App.tsx');
});
