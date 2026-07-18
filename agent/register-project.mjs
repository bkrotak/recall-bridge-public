import { execFile } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const [alias, requestedPath] = process.argv.slice(2);
if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(alias || '')) {
  throw new Error('Alias must use lowercase letters, numbers, dots, underscores, or dashes.');
}
if (!requestedPath) throw new Error('Usage: node agent/register-project.mjs <alias> <path>');

const home = await realpath(os.homedir());
const projectRoot = await realpath(path.resolve(requestedPath.replace(/^~(?=\/)/, home)));
const allowedRoot = path.join(home, 'projects') + path.sep;
if (!projectRoot.startsWith(allowedRoot)) {
  throw new Error('Project must be inside $HOME/projects.');
}
await exec('git', ['rev-parse', '--show-toplevel'], { cwd: projectRoot });

const configFile = path.join(home, '.couchcode', 'config.json');
const config = JSON.parse(await readFile(configFile, 'utf8'));
config.projects ||= {};
config.projects[alias] = {
  path: projectRoot,
  defaultBranch: 'main',
  commitPaths: [],
  allowedActions: ['read_file', 'search', 'git_diff'],
  commands: {},
  jobs: {}
};
await writeFile(configFile, JSON.stringify(config, null, 2));
console.log(`Registered ${alias}: ${projectRoot}`);
console.log('Review allowedActions, command allowlists, and commitPaths in ~/.couchcode/config.json before remote changes.');
