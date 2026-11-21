import { parseEnvironment } from './config/env.js';
import { AppError } from './common/errors/app-error.js';
import { createShutdownController, registerFatalErrorHandler, registerShutdownSignals } from './common/utils/shutdown-controller.js';
import { startApplication } from './bootstrap.js';

async function main(): Promise<void> {
  const env = parseEnvironment(process.env);
  const report = (error: unknown) => {
    console.error(error instanceof AppError ? error.code : 'Unexpected runtime failure');
  };

  const { server, stop: shutdown } = await startApplication(env, report);
  console.log(`Server listening on port ${env.PORT}`);

  const stop = createShutdownController({
    shutdown, report,
    exit: code => process.exit(code),
    forceExit: () => { server.closeAllConnections(); process.exit(1); },
    setExitCode: code => { process.exitCode = code; }
  });
  registerShutdownSignals(process, () => stop());
  registerFatalErrorHandler(process, error => {
    console.error('Uncaught exception. Shutting down gracefully.');
    report(error);
  }, code => stop(code));
  server.on('error', error => { report(error); stop(1); });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error && error.message.startsWith('Invalid environment:')
    ? error.message : 'Server could not start. Check database access and configuration.';
  console.error(message);
  process.exitCode = 1;
});