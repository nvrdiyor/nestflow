import { env } from './env.js';
import { buildServer } from './server.js';

const app = await buildServer({
  dbFile: env.dbFile,
  trustProxy: env.trustProxy,
  jwtSecret: env.jwtSecret,
  adminUsername: env.adminUsername,
  adminPassword: env.adminPassword,
  webDist: env.webDist,
  corsOrigin: env.corsOrigin,
  startingCredits: env.startingCredits,
  logger: true,
});

try {
  await app.listen({ port: env.port, host: env.host });
  app.log.info(`NestFlow API listening on http://${env.host}:${env.port}`);
  if (env.adminPasswordIsDefault) {
    app.log.warn(
      'ADMIN_PASSWORD is not set — the admin panel is using the DEFAULT password ' +
        'committed to the repository. Set ADMIN_PASSWORD (and ADMIN_USERNAME) in ' +
        'the environment before exposing this server to the internet.',
    );
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (closing) return; // a second signal must not re-run close()
    closing = true;
    // Don't let a hung connection stall shutdown until the orchestrator SIGKILLs.
    void Promise.race([app.close(), new Promise((r) => setTimeout(r, 10_000))]).then(() => process.exit(0));
  });
}
