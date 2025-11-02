#!/usr/bin/env node
// Playwright Test-Runner MCP server
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/transports/stdio.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function run(cmd, args, opts = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { shell: false, ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

let lastReport = null;

const server = new Server(
  { name: 'gmh-playwright', version: '0.0.1' },
  { capabilities: { tools: {} } }
);

server.addTool({
  name: 'health.ping',
  description: 'Basic health check to confirm the MCP server is reachable.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }
}, async () => {
  return { content: [{ type: 'text', text: 'ok' }] };
});

server.addTool({
  name: 'tests.run',
  description: 'Run Playwright E2E tests. Respects playwright.config.js webServer.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Test file/name pattern' },
      headed: { type: 'boolean' },
      project: { type: 'string', enum: ['chromium', 'firefox', 'webkit'] },
      ui: { type: 'boolean' }
    },
    additionalProperties: false
  }
}, async (args) => {
  const pattern = args?.pattern ? String(args.pattern) : '';
  const headed = args?.headed ? '--headed' : '';
  const ui = args?.ui ? '--ui' : '';
  const project = args?.project ? ['--project', String(args.project)] : [];
  const testArgs = ['test'];
  if (pattern) testArgs.push(pattern);
  if (headed) testArgs.push(headed);
  if (ui) testArgs.push(ui);
  testArgs.push(...project);
  const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const cwd = resolve(__dirname, '..'); // repo root one level up
  const result = await run(bin, ['playwright', ...testArgs], { cwd });
  lastReport = { when: new Date().toISOString(), args: { pattern, headed: !!args?.headed, ui: !!args?.ui, project: args?.project || null }, ...result };
  const summary = `exit=${result.code}\nstdout:\n${result.stdout.split('\n').slice(-80).join('\n')}\n\nstderr:\n${result.stderr.split('\n').slice(-40).join('\n')}`;
  return { content: [{ type: 'text', text: summary }] };
});

server.addTool({
  name: 'tests.install',
  description: 'Install Playwright browsers (npx playwright install) for local runs.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }
}, async () => {
  const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const cwd = resolve(__dirname, '..');
  const result = await run(bin, ['playwright', 'install'], { cwd });
  lastReport = { when: new Date().toISOString(), action: 'install', ...result };
  const summary = `install exit=${result.code}\n${result.stdout || result.stderr}`;
  return { content: [{ type: 'text', text: summary }] };
});

server.addTool({
  name: 'tests.list',
  description: 'List discovered Playwright tests (names and files).',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }
}, async () => {
  const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const cwd = resolve(__dirname, '..');
  const result = await run(bin, ['playwright', 'test', '--list', '--reporter=line'], { cwd });
  lastReport = { when: new Date().toISOString(), action: 'list', ...result };
  const summary = `list exit=${result.code}\n${result.stdout || result.stderr}`;
  return { content: [{ type: 'text', text: summary }] };
});

server.addTool({
  name: 'tests.lastReport',
  description: 'Return summary of the last test run/install.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }
}, async () => {
  const text = lastReport ? JSON.stringify(lastReport, null, 2) : 'No report yet.';
  return { content: [{ type: 'text', text }] };
});

const transport = new StdioServerTransport();
server.connect(transport);
