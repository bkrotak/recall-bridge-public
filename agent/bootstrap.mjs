import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const home = process.env.COUCHCODE_HOME || path.join(os.homedir(), '.couchcode');
await mkdir(home, { recursive: true });
const configFile = path.join(home, 'config.json');
let existing = {};
try { existing = JSON.parse(await readFile(configFile, 'utf8')); } catch {}
const owner = process.env.COUCHCODE_OWNER || existing.githubOwner || execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).trim();
const config = {
  ...existing,
  deviceId: process.env.COUCHCODE_DEVICE_ID || existing.deviceId || `android-${randomBytes(6).toString('hex')}`,
  controlRepo: process.env.COUCHCODE_REPO || existing.controlRepo || `${owner}/couchcode-control`,
  issue: Number(process.env.COUCHCODE_ISSUE || existing.issue || 1),
  allowedAuthors: existing.allowedAuthors?.length ? existing.allowedAuthors : [owner],
  githubOwner: owner,
  projects: existing.projects || {},
  security: existing.security || { allowedSensitiveActions: [] }
};
await writeFile(configFile, JSON.stringify(config, null, 2));
console.log(`Created ${configFile}`);
console.log(`Device ID: ${config.deviceId}`);
console.log('Add projects to the projects object before starting the agent.');
console.log('Sensitive actions remain disabled until explicitly enabled in local configuration.');
