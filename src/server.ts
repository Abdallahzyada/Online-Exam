import type { Server } from 'node:http';
import { parseEnvironment } from './config/env.js';
import { describeError } from './common/errors/error-report.js';
import { ShutdownStack } from './common/utils/shutdown.js';
import { createShutdownController, registerFatalErrorHandler, registerShutdownSignals } from './common/utils/shutdown-controller.js';
import { startApplication } from './bootstrap.js';

// Logs never include tokens, request bodies, error messages or database connection strings.
const report = (error: unknown) => { console.error(describeError(error)); };

async function main(): Promise<void> {
  const env = parseEnvironment(process.env);
  // Cleanup, signals and the fatal-error handler are ready before startup opens anything,
  // so a crash or Ctrl+C during startup still closes whatever was opened so far.
  const shutdown = new ShutdownStack();
  let server: Server | undefined;
  const stop = createShutdownController({
    shutdown: () => shutdown.stop(), report,
    exit: code => process.exit(code),
    forceExit: () => { server?.closeAllConnections(); process.exit(1); },
    setExitCode: code => { process.exitCode = code; }
  });
  registerFatalErrorHandler(process, error => {
    console.error('Uncaught exception. Shutting down gracefully.');
    report(error);
  }, code => stop(code));
  registerShutdownSignals(process, () => stop());

  const httpServer = await startApplication(env, report, shutdown);
  server = httpServer;
  console.log(`Server listening on port ${env.PORT}`);
  httpServer.on('error', error => { report(error); stop(1); });
}

void main().catch((error: unknown) => {
  // Environment validation messages contain field names, never their values.
  const invalidEnvironment = error instanceof Error && error.message.startsWith('Invalid environment:');
  console.error(invalidEnvironment
    ? error.message : 'Server could not start. Check database access and configuration.');
  if (!invalidEnvironment) report(error);
  process.exitCode = 1;
});
