'use strict';

// Workaround for restricted desktop sandboxes where libuv's uv_uptime syscall
// can throw EPERM. CloudBase MCP's telemetry/error reporting may call os.uptime()
// during startup; make it safe before the MCP CLI loads.
const os = require('node:os');
try {
  os.uptime();
} catch (_) {
  os.uptime = () => 0;
}
