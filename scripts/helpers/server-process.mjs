import { Server } from 'node:http';

// Test-only request barrier: hold an accepted request until shutdown starts.
const emit = Server.prototype.emit;
let armed = false, release;
Server.prototype.emit = function (event, ...args) {
  if (event === 'request' && armed && args[0].url.includes('/analytics')) {
    armed = false;
    release = () => emit.call(this, event, ...args);
    process.send('request-held');
    return true;
  }
  return emit.call(this, event, ...args);
};
// Test-only IPC bridge: exercise the real SIGTERM handler on Windows.
process.on('message', message => {
  if (message === 'arm-drain') { armed = true; process.send('drain-armed'); }
  if (message === 'shutdown') {
    process.emit('SIGTERM');
    process.emit('SIGTERM');
    process.emit('SIGINT');
    release?.();
    process.disconnect();
  }
});
await import('../../dist/server.js');
