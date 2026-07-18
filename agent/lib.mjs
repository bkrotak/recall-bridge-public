import { realpath } from 'node:fs/promises';
import path from 'node:path';

export const COMMAND_PREFIX = 'couchcode:';
export const SAFE_PROJECT = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const SAFE_BRANCH = /^(agent|feature|fix)\/[a-zA-Z0-9._/-]+$/;
export const SAFE_JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ACTIONS = new Set([
  'status', 'self_update', 'list_projects', 'create_repository', 'register_project',
  'read_file', 'search', 'apply_patch', 'install', 'run_check', 'git_diff',
  'commit_push', 'start_job', 'job_status', 'job_logs', 'capture_web',
]);

export const PROJECT_ACTIONS = new Set([
  'read_file', 'search', 'apply_patch', 'install', 'run_check', 'git_diff',
  'commit_push', 'start_job', 'job_status', 'job_logs', 'capture_web',
]);

export const MUTATING_ACTIONS = new Set([
  'self_update', 'create_repository', 'register_project', 'apply_patch', 'install',
  'commit_push', 'start_job',
]);

const COMMAND_FIELDS = new Set([
  'version', 'id', 'deviceId', 'project', 'action', 'args', 'createdAt', 'expiresAt',
  'requiresApproval', 'approved',
]);
const SAFE_ID = /^[a-zA-Z0-9._:-]{8,100}$/;
const SAFE_DEVICE = /^[a-zA-Z0-9._:-]{8,100}$/;
const MAX_CLOCK_SKEW_MS = 60_000;
const MAX_COMMAND_LIFETIME_MS = 10 * 60_000;

export function parseCommand(body, now = Date.now()) {
  if (typeof body !== 'string' || !body.startsWith(COMMAND_PREFIX)) return null;
  const value = JSON.parse(body.slice(COMMAND_PREFIX.length).trim());
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid command envelope');
  if (Object.keys(value).some((key) => !COMMAND_FIELDS.has(key))) throw new Error('Unknown command field');
  if (value.version !== 1 || !SAFE_ID.test(value.id || '')) throw new Error('Invalid command ID or version');
  if (!SAFE_DEVICE.test(value.deviceId || '')) throw new Error('Invalid device ID');
  if (!SAFE_PROJECT.test(value.project || '')) throw new Error('Invalid project name');
  if (!ACTIONS.has(value.action)) throw new Error('Unknown action');
  if (!value.args || typeof value.args !== 'object' || Array.isArray(value.args)) throw new Error('Command args must be an object');
  const createdAt = Date.parse(value.createdAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) throw new Error('Invalid command timestamps');
  if (createdAt > now + MAX_CLOCK_SKEW_MS) throw new Error('Command creation time is in the future');
  if (expiresAt <= createdAt || expiresAt - createdAt > MAX_COMMAND_LIFETIME_MS) throw new Error('Invalid command lifetime');
  if (expiresAt <= now) throw new Error('Command expired');
  if (value.requiresApproval !== undefined && typeof value.requiresApproval !== 'boolean') throw new Error('Invalid approval requirement');
  if (value.approved !== undefined && typeof value.approved !== 'boolean') throw new Error('Invalid approval value');
  if (value.requiresApproval && value.approved !== true) throw new Error('Command approval is required');
  return value;
}

export function resolveInside(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')) throw new Error('Invalid path');
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Path escapes project root');
  }
  return resolved;
}

export async function resolveInsideReal(root, relativePath, { allowMissing = false } = {}) {
  const lexical = resolveInside(root, relativePath);
  const realRoot = await realpath(root);
  let probe = lexical;
  while (true) {
    try {
      const realTarget = await realpath(probe);
      const suffix = path.relative(probe, lexical);
      const resolved = path.resolve(realTarget, suffix);
      if (resolved !== realRoot && !resolved.startsWith(`${realRoot}${path.sep}`)) throw new Error('Path escapes project root through a symlink');
      return allowMissing ? lexical : resolved;
    } catch (error) {
      if (error?.code !== 'ENOENT' || !allowMissing) throw error;
      const parent = path.dirname(probe);
      if (parent === probe) throw error;
      probe = parent;
    }
  }
}

export function assertRegisteredProject(config, name) {
  const project = config.projects?.[name];
  if (!project?.path) throw new Error(`Unknown project: ${name}`);
  return { ...project, path: path.resolve(project.path) };
}

export function assertProjectActionAllowed(project, action) {
  if (!Array.isArray(project.allowedActions) || !project.allowedActions.includes(action)) {
    throw new Error(`Action is not locally allowed for this project: ${action}`);
  }
}

export function assertSensitiveActionAllowed(config, command) {
  if (command.approved !== true) throw new Error(`${command.action} requires approved=true`);
  const allowed = config.security?.allowedSensitiveActions;
  if (!Array.isArray(allowed) || !allowed.includes(command.action)) {
    throw new Error(`Sensitive action is not enabled in local configuration: ${command.action}`);
  }
}

export function assertCaptureTargetAllowed(project, command, target) {
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  if (localHosts.has(target.hostname)) return;
  if (project.allowRemoteCapture !== true) {
    throw new Error('Remote URL capture is not enabled in local project configuration');
  }
  if (command.approved !== true) throw new Error('Remote URL capture requires approved=true');
}

export function configuredCommitPaths(project, requestedPaths) {
  const configured = Array.isArray(project.commitPaths) ? project.commitPaths : [];
  if (!configured.length) throw new Error('No commit paths configured');
  const requested = requestedPaths === undefined ? configured : requestedPaths;
  if (!Array.isArray(requested) || !requested.length) throw new Error('No commit paths requested');
  for (const item of requested) {
    if (typeof item !== 'string' || !configured.includes(item)) throw new Error(`Commit path is not locally configured: ${item}`);
    resolveInside(project.path, item);
  }
  return requested;
}

export function validateJobId(id) {
  if (!SAFE_JOB_ID.test(id || '')) throw new Error('Invalid job ID');
  return id;
}

export function assertJobProject(record, projectName) {
  if (!record) throw new Error('Unknown job');
  if (record.project !== projectName) throw new Error('Job does not belong to this project');
  return record;
}

export function rememberCommandId(state, id, expiresAt, now = Date.now()) {
  state.processedCommands ||= {};
  for (const [knownId, knownExpiry] of Object.entries(state.processedCommands)) {
    if (Date.parse(knownExpiry) <= now) delete state.processedCommands[knownId];
  }
  if (state.processedCommands[id]) return false;
  state.processedCommands[id] = expiresAt;
  return true;
}

export function patchPaths(patch) {
  if (typeof patch !== 'string' || patch.length > 500_000) throw new Error('Patch must be under 500 KB');
  const paths = [];
  for (const line of patch.split('\n')) {
    const match = /^(?:--- a|\+\+\+ b)\/(.+)$/.exec(line);
    if (match && match[1] !== '/dev/null') paths.push(match[1].split('\t')[0]);
  }
  if (!paths.length) throw new Error('Patch contains no repository paths');
  return [...new Set(paths)];
}

export function trimOutput(value, max = 50_000) {
  const text = String(value || 'Completed.');
  return text.length > max ? `[truncated]\n${text.slice(-max)}` : text;
}
