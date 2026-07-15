#!/usr/bin/env node
'use strict';

// Workaround for restricted desktop sandboxes where libuv's uv_uptime syscall
// can throw EPERM. CloudBase MCP's telemetry/error reporting may call os.uptime()
// during startup; make it safe before loading the MCP CLI.
const os = require('node:os');
try {
  os.uptime();
} catch (_) {
  os.uptime = () => 0;
}

const path = require('node:path');
const candidates = [
  '/Users/bytedance/.npm/_npx/88d9f76c32260533/node_modules/@cloudbase/cloudbase-mcp/dist/cli.cjs',
];

for (const candidate of candidates) {
  try {
    require(candidate);
    return;
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message || '').includes(candidate)) {
      continue;
    }
    throw error;
  }
}

throw new Error('CloudBase MCP CLI not found. Please run: npx @cloudbase/cloudbase-mcp@latest');
