import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertCaptureTargetAllowed,
  assertJobProject,
  assertProjectActionAllowed,
  assertSensitiveActionAllowed,
  configuredCommitPaths,
  parseCommand,
  patchPaths,
  rememberCommandId,
  resolveInside,
  resolveInsideReal,
  validateJobId,
} from '../lib.mjs';

const envelope = (overrides = {}, now = Date.now()) => ({
  version: 1,
  id: 'command-001',
  deviceId: 'android-1234',
  project: 'sample',
  action: 'status',
  args: {},
  createdAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 300_000).toISOString(),
  ...overrides,
});

const body = (value) => `couchcode:${JSON.stringify(value)}`;

test('rejects missing, expired, future, and overly long timestamps', () => {
  const now = Date.now();
  assert.throws(() => parseCommand(body(envelope({ expiresAt: undefined }, now)), now), /timestamps/);
  assert.throws(() => parseCommand(body(envelope({ expiresAt: new Date(now - 1).toISOString() }, now)), now), /lifetime|expired/);
  assert.throws(() => parseCommand(body(envelope({ createdAt: new Date(now + 120_000).toISOString(), expiresAt: new Date(now + 180_000).toISOString() }, now)), now), /future/);
  assert.throws(() => parseCommand(body(envelope({ expiresAt: new Date(now + 11 * 60_000).toISOString() }, now)), now), /lifetime/);
});

test('rejects unknown actions, fields, and incomplete approval', () => {
  assert.throws(() => parseCommand(body(envelope({ action: 'shell' }))), /Unknown action/);
  assert.throws(() => parseCommand(body(envelope({ extra: true }))), /Unknown command field/);
  assert.throws(() => parseCommand(body(envelope({ requiresApproval: true, approved: false }))), /approval/);
});

test('accepts UUID job IDs and rejects traversal', () => {
  assert.equal(validateJobId('123e4567-e89b-12d3-a456-426614174000'), '123e4567-e89b-12d3-a456-426614174000');
  assert.throws(() => validateJobId('../config'), /Invalid job ID/);
});

test('job records must exist and belong to the requested project', () => {
  const record = { id: '123e4567-e89b-12d3-a456-426614174000', project: 'sample' };
  assert.equal(assertJobProject(record, 'sample'), record);
  assert.throws(() => assertJobProject(record, 'other'), /does not belong/);
  assert.throws(() => assertJobProject(null, 'sample'), /Unknown job/);
});

test('real path containment rejects symlink escapes', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'couchcode-path-'));
  const project = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  await mkdir(project);
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
  await symlink(outside, path.join(project, 'escape'));
  await assert.rejects(resolveInsideReal(project, 'escape/secret.txt'), /symlink/);
  await rm(base, { recursive: true, force: true });
});

test('project actions and sensitive actions require local configuration', () => {
  const project = { path: '/tmp/project', allowedActions: ['read_file'], commitPaths: ['src'] };
  assert.doesNotThrow(() => assertProjectActionAllowed(project, 'read_file'));
  assert.throws(() => assertProjectActionAllowed(project, 'apply_patch'), /not locally allowed/);
  assert.doesNotThrow(() => assertSensitiveActionAllowed({ security: { allowedSensitiveActions: ['self_update'] } }, { action: 'self_update', approved: true }));
  assert.throws(() => assertSensitiveActionAllowed({ security: { allowedSensitiveActions: [] } }, { action: 'self_update', approved: true }), /not enabled/);
});

test('remote capture requires both local enablement and caller approval', () => {
  const remote = new URL('https://example.com');
  assert.throws(() => assertCaptureTargetAllowed({}, { approved: true }, remote), /not enabled/);
  assert.throws(() => assertCaptureTargetAllowed({ allowRemoteCapture: true }, { approved: false }, remote), /approved=true/);
  assert.doesNotThrow(() => assertCaptureTargetAllowed({ allowRemoteCapture: true }, { approved: true }, remote));
  assert.doesNotThrow(() => assertCaptureTargetAllowed({}, {}, new URL('http://127.0.0.1:3000')));
});

test('commit paths cannot exceed local configuration', () => {
  const project = { path: '/tmp/project', commitPaths: ['src', 'package.json'] };
  assert.deepEqual(configuredCommitPaths(project, ['src']), ['src']);
  assert.throws(() => configuredCommitPaths(project, ['.env']), /not locally configured/);
});

test('duplicate command IDs are rejected as replay', () => {
  const state = {};
  const now = Date.now();
  const expiry = new Date(now + 300_000).toISOString();
  assert.equal(rememberCommandId(state, 'command-001', expiry, now), true);
  assert.equal(rememberCommandId(state, 'command-001', expiry, now), false);
  assert.equal(rememberCommandId(state, 'command-001', new Date(now + 600_000).toISOString(), now + 300_001), true);
});

test('patch paths are extracted and traversal is rejected by containment', () => {
  assert.deepEqual(patchPaths('--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-a\n+b'), ['src/a.js']);
  const escaped = patchPaths('--- a/../config.json\n+++ b/../config.json\n@@ -1 +1 @@\n-a\n+b');
  assert.deepEqual(escaped, ['../config.json']);
  assert.throws(() => resolveInside('/tmp/project', escaped[0]), /escapes project root/);
});
