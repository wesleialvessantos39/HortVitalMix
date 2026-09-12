import { createServer } from 'node:http';
import { createApp } from './app';

const { app, pool, runtime } = createApp();
const server = createServer(app);
let shuttingDown = false;

server.listen(runtime.apiPort, () => {
  console.log(JSON.stringify({
    level: 'info',
    event: 'server.started',
    port: runtime.apiPort,
    environment: runtime.environment,
  }));
});

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(JSON.stringify({ level: 'info', event: 'server.stopping', signal }));
  server.close(async () => {
    try {
      await pool?.end();
      process.exit(0);
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        event: 'server.shutdown_failed',
        message: error instanceof Error ? error.message : 'unknown',
      }));
      process.exit(1);
    }
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
