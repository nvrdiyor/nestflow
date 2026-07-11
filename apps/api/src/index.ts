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
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
