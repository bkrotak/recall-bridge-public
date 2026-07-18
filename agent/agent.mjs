import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { captureWeb } from './visual-capture.mjs';
import {
  COMMAND_PREFIX,
  MUTATING_ACTIONS,
  PROJECT_ACTIONS,
  SAFE_BRANCH,
  SAFE_PROJECT,
  assertCaptureTargetAllowed,
  assertJobProject,
  assertProjectActionAllowed,
  assertRegisteredProject,
  assertSensitiveActionAllowed,
  configuredCommitPaths,
  parseCommand,
  patchPaths,
  rememberCommandId,
  resolveInsideReal,
  trimOutput,
  validateJobId,
} from './lib.mjs';

const exec = promisify(execFile);
const HOME = os.homedir();
const BRIDGE_HOME = process.env.COUCHCODE_HOME || path.join(HOME, '.couchcode');
const CONFIG_FILE = path.join(BRIDGE_HOME, 'config.json');
const STATE_FILE = path.join(BRIDGE_HOME, 'state.json');
const JOB_DIR = path.join(BRIDGE_HOME, 'jobs');
const ARTIFACT_DIR = path.join(BRIDGE_HOME, 'artifacts');
const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLL_MS = Number(process.env.COUCHCODE_POLL_MS || 15000);
const ONCE = process.argv.includes('--once');
const idleArg = process.argv.findIndex((value) => value === '--idle-timeout');
const IDLE_TIMEOUT_SECONDS = idleArg >= 0 ? Number(process.argv[idleArg + 1]) : 0;
const runningJobs = new Set();
let lastActivityAt = Date.now();

await mkdir(JOB_DIR, { recursive: true });
await mkdir(ARTIFACT_DIR, { recursive: true });

const loadJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
};
const saveJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2));
const config = await loadJson(CONFIG_FILE, null);
if (!config?.deviceId || !config?.controlRepo || !config?.issue || !config?.allowedAuthors?.length) {
  console.error(`Missing configuration. Run: node agent/bootstrap.mjs`);
  process.exit(1);
}

const run = async (program, args, { cwd, timeout = 10 * 60 * 1000, env } = {}) => {
  const result = await exec(program, args, {
    cwd,
    timeout,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
};

const relayEnabled = Boolean(config.relay?.url && config.relay?.deviceSecret);
const relayFetch = async (route, options = {}) => {
  const response = await fetch(`${config.relay.url.replace(/\/$/, '')}${route}`, {
    ...options,
    headers: {
      authorization: `Bearer ${config.relay.deviceSecret}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};
const post = async (body, transport = 'github') => {
  if (transport === 'github') {
    return run('gh', ['issue', 'comment', String(config.issue), '--repo', config.controlRepo, '--body', body]);
  }
  if (!relayEnabled) throw new Error('Relay result requested without relay configuration');
  const payload = JSON.parse(body.slice(COMMAND_PREFIX.length));
  return relayFetch('/v1/device/results', {
    method: 'POST',
    body: JSON.stringify({ deviceId: config.deviceId, commandId: payload.transportId || payload.id, status: payload.status, payload }),
  });
};
const projectFor = (command) => assertRegisteredProject(config, command.project);

const jobPath = (id, extension) => path.join(JOB_DIR, `${validateJobId(id)}.${extension}`);
const jobRecord = async (id, projectName) => {
  const record = await loadJson(jobPath(id, 'json'), null);
  return assertJobProject(record, projectName);
};
const startJob = async (command, project) => {
  const allowed = project.jobs?.[command.args?.job];
  if (!allowed?.program || !Array.isArray(allowed.args)) throw new Error('Job is not allowlisted for this project');
  const jobId = randomUUID();
  const logFile = path.join(JOB_DIR, `${jobId}.log`);
  const recordFile = path.join(JOB_DIR, `${jobId}.json`);
  const child = spawn(allowed.program, allowed.args, {
    cwd: project.path,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(allowed.env || {}) },
  });
  runningJobs.add(jobId);
  const chunks = [];
  const append = async (chunk) => {
    chunks.push(String(chunk));
    await writeFile(logFile, chunks.join('').slice(-500000));
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  await saveJson(recordFile, { id: jobId, project: command.project, name: command.args.job, status: 'running', pid: child.pid, startedAt: new Date().toISOString() });
  child.on('exit', async (code, signal) => {
    const current = await jobRecord(jobId, command.project);
    await saveJson(recordFile, { ...current, status: code === 0 ? 'completed' : 'failed', exitCode: code, signal, finishedAt: new Date().toISOString() });
    runningJobs.delete(jobId);
    lastActivityAt = Date.now();
  });
  child.unref();
  return { jobId, status: 'running' };
};

const actions = {
  status: async () => ({ deviceId: config.deviceId, online: true, projects: Object.keys(config.projects || {}), time: new Date().toISOString() }),
  self_update: async (command) => {
    return run('git', ['pull', '--ff-only'], { cwd: AGENT_ROOT });
  },
  list_projects: async () => Object.keys(config.projects || {}),
  register_project: async (command) => {
    const name = String(command.args?.name || '');
    if (!SAFE_PROJECT.test(name)) throw new Error('Invalid project alias');
    const projectPath = await resolveInsideReal(path.join(HOME, 'projects'), command.args?.path || name);
    await run('git', ['rev-parse', '--show-toplevel'], { cwd: projectPath });
    const commitPaths = Array.isArray(command.args?.commitPaths) ? command.args.commitPaths : [];
    for (const item of commitPaths) await resolveInsideReal(projectPath, item, { allowMissing: true });
    config.projects[name] = {
      path: projectPath,
      defaultBranch: String(command.args?.defaultBranch || 'main'),
      commitPaths,
      allowedActions: ['read_file', 'search', 'git_diff'],
      commands: {},
      jobs: {},
    };
    await saveJson(CONFIG_FILE, config);
    return { name };
  },
  create_repository: async (command) => {
    const name = String(command.args?.name || '');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(name)) throw new Error('Invalid repository name');
    const owner = config.githubOwner || config.allowedAuthors[0];
    const visibility = command.args?.visibility === 'public' ? 'public' : 'private';
    if (visibility === 'public' && !command.args?.confirmPublic) throw new Error('Public repositories require confirmPublic=true');
    const args = ['repo', 'create', `${owner}/${name}`, `--${visibility}`];
    const description = String(command.args?.description || '').slice(0, 300);
    if (description) args.push('--description', description);
    await run('gh', args);
    return { repository: `${owner}/${name}`, visibility };
  },
  read_file: async (command) => {
    const project = projectFor(command);
    const file = await resolveInsideReal(project.path, command.args?.path);
    return (await readFile(file, 'utf8')).slice(0, 200000);
  },
  search: async (command) => {
    const project = projectFor(command);
    const query = String(command.args?.query || '').slice(0, 200);
    if (!query) throw new Error('Search query required');
    return run('rg', ['--line-number', '--max-count', '200', '--', query, '.'], { cwd: project.path });
  },
  apply_patch: async (command) => {
    const project = projectFor(command);
    const patch = command.args?.patch;
    for (const item of patchPaths(patch)) await resolveInsideReal(project.path, item, { allowMissing: true });
    const patchFile = path.join(BRIDGE_HOME, `patch-${command.id}.diff`);
    await writeFile(patchFile, patch);
    return run('git', ['apply', '--whitespace=fix', patchFile], { cwd: project.path });
  },
  install: async (command) => {
    const project = projectFor(command);
    const install = project.commands?.install;
    if (!install) throw new Error('Install command is not configured');
    return run(install.program, install.args || [], { cwd: project.path, timeout: 30 * 60 * 1000 });
  },
  run_check: async (command) => {
    const project = projectFor(command);
    const check = project.commands?.checks?.[command.args?.name];
    if (!check) throw new Error('Check is not allowlisted');
    return run(check.program, check.args || [], { cwd: project.path, timeout: 30 * 60 * 1000 });
  },
  capture_web: async (command) => {
    const project = projectFor(command);
    const target = new URL(String(command.args?.url || ''));
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Visual capture requires an HTTP(S) URL');
    assertCaptureTargetAllowed(project, command, target);
    const width = Math.min(2560, Math.max(240, Number(command.args?.width || 390)));
    const height = Math.min(2560, Math.max(320, Number(command.args?.height || 844)));
    const session = `${Date.now()}-${command.id.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const outputDir = path.join(ARTIFACT_DIR, command.project, session);
    const report = await captureWeb({
      url: target.toString(), outputDir, width, height,
      fullPage: command.args?.fullPage !== false,
      sections: command.args?.sections !== false,
    });
    return { project: command.project, projectPath: project.path, artifactPath: outputDir, report };
  },
  git_diff: async (command) => run('git', ['diff', '--stat', 'HEAD'], { cwd: projectFor(command).path }),
  commit_push: async (command) => {
    const project = projectFor(command);
    const branch = String(command.args?.branch || '');
    if (!SAFE_BRANCH.test(branch)) throw new Error('Branch must begin with agent/, feature/, or fix/');
    const current = await run('git', ['branch', '--show-current'], { cwd: project.path });
    if (current === project.defaultBranch) await run('git', ['switch', '-c', branch], { cwd: project.path });
    const paths = configuredCommitPaths(project, command.args?.paths);
    await run('git', ['add', '--', ...paths], { cwd: project.path });
    const staged = await run('git', ['diff', '--cached', '--name-only'], { cwd: project.path });
    if (!staged) return 'Nothing to commit';
    await run('git', ['commit', '-m', String(command.args?.message || 'Update project')], { cwd: project.path });
    return run('git', ['push', '-u', 'origin', await run('git', ['branch', '--show-current'], { cwd: project.path })], { cwd: project.path });
  },
  start_job: async (command) => startJob(command, projectFor(command)),
  job_status: async (command) => jobRecord(command.args?.jobId, command.project),
  job_logs: async (command) => {
    await jobRecord(command.args?.jobId, command.project);
    return (await readFile(jobPath(command.args?.jobId, 'log'), 'utf8')).slice(-100000);
  },
};

console.log(`CouchCode ${config.deviceId} watching ${config.controlRepo}#${config.issue}`);
while (true) {
  let processedThisPoll = 0;
  try {
    const comments = [];
    if (relayEnabled) {
      try {
        const delivery = await relayFetch(`/v1/device/commands?deviceId=${encodeURIComponent(config.deviceId)}`);
        comments.push(...delivery.commands.map((item) => ({
          id: `relay:${item.id}`,
          user: { login: config.allowedAuthors[0] },
          body: `${COMMAND_PREFIX}${JSON.stringify(item.command)}`,
          transportId: item.id,
          transport: 'relay',
        })));
      } catch (error) {
        console.error(new Date().toISOString(), 'Relay poll failed:', error?.message || error);
      }
    }
    try {
      const raw = await run('gh', ['api', `repos/${config.controlRepo}/issues/${config.issue}/comments`, '--paginate']);
      const githubComments = raw ? JSON.parse(raw) : [];
      comments.push(...githubComments.map((item) => ({ ...item, transport: 'github' })));
    } catch (error) {
      console.error(new Date().toISOString(), 'GitHub poll failed:', error?.message || error);
      if (!relayEnabled) throw error;
    }
    const state = await loadJson(STATE_FILE, { processedComments: [], processedCommands: {} });
    state.processedComments ||= state.processed || [];
    for (const item of comments) {
      if (state.processedComments.includes(item.id) || !config.allowedAuthors.includes(item.user?.login)) continue;
      let command;
      try { command = parseCommand(item.body); } catch (error) { command = null; }
      if (!command || command.deviceId !== config.deviceId || command.status || !command.action) continue;
      state.processedComments.push(item.id);
      if (!rememberCommandId(state, command.id, command.expiresAt)) {
        await saveJson(STATE_FILE, { processedComments: state.processedComments.slice(-1000), processedCommands: state.processedCommands });
        continue;
      }
      processedThisPoll += 1;
      lastActivityAt = Date.now();
      await saveJson(STATE_FILE, { processedComments: state.processedComments.slice(-1000), processedCommands: state.processedCommands });
      try {
        if (PROJECT_ACTIONS.has(command.action)) assertProjectActionAllowed(projectFor(command), command.action);
        if (MUTATING_ACTIONS.has(command.action)) {
          if (PROJECT_ACTIONS.has(command.action)) {
            if (command.approved !== true) throw new Error(`${command.action} requires approved=true`);
          } else {
            assertSensitiveActionAllowed(config, command);
          }
        }
        const action = actions[command.action];
        if (!action) throw new Error('Action is not allowed');
        const result = await action(command);
        await post(`${COMMAND_PREFIX}${JSON.stringify({ version: 1, id: command.id, transportId: item.transportId, deviceId: config.deviceId, status: 'completed', result: trimOutput(typeof result === 'string' ? result : JSON.stringify(result)) })}`, item.transport);
      } catch (error) {
        await post(`${COMMAND_PREFIX}${JSON.stringify({ version: 1, id: command.id, transportId: item.transportId, deviceId: config.deviceId, status: 'failed', error: trimOutput(error?.message || error) })}`, item.transport);
      }
    }
  } catch (error) {
    console.error(new Date().toISOString(), error?.message || error);
  }
  if (ONCE) break;
  if (
    IDLE_TIMEOUT_SECONDS > 0 &&
    processedThisPoll === 0 &&
    runningJobs.size === 0 &&
    Date.now() - lastActivityAt >= IDLE_TIMEOUT_SECONDS * 1000
  ) {
    console.log(`CouchCode exiting after ${IDLE_TIMEOUT_SECONDS}s idle`);
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}
