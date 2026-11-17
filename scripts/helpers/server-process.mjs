// Test-only IPC bridge: exercise the real SIGTERM handler on Windows.
process.on('message', message => {
  if (message === 'shutdown') {
    process.emit('SIGTERM');
    process.disconnect();
  }
});
await import('../../dist/server.js');
