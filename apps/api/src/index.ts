import { env } from './env.js';
import { buildServer } from './server.js';
import { TelegramBot } from './telegram.js';

// Telegram sign-in: resolve the bot's @username once; if Telegram is
// unreachable the site still starts (password sign-in keeps working).
const bot = env.telegramBotToken ? new TelegramBot(env.telegramBotToken) : null;
let botUsername = '';
for (let attempt = 1; bot && !botUsername && attempt <= 3; attempt++) {
  try {
    botUsername = (await bot.getMe()).username ?? '';
  } catch (err) {
    console.error(`Telegram getMe failed (attempt ${attempt}/3): ${err instanceof Error ? err.message : String(err)}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

const app = await buildServer({
  dbFile: env.dbFile,
  trustProxy: env.trustProxy,
  jwtSecret: env.jwtSecret,
  adminUsername: env.adminUsername,
  adminPassword: env.adminPassword,
  webDist: env.webDist,
  corsOrigin: env.corsOrigin,
  startingCredits: env.startingCredits,
  vipAll: env.vipAll,
  ...(bot && botUsername ? { telegram: { sender: bot, botUsername, siteUrl: env.publicUrl } } : {}),
  logger: true,
});

try {
  await app.listen({ port: env.port, host: env.host });
  app.log.info(`NestFlow API listening on http://${env.host}:${env.port}`);
  if (bot && botUsername) {
    app.log.info(`Telegram sign-in enabled via @${botUsername}`);
    void bot.startPolling((u) => app.handleTelegramUpdate(u), (msg) => app.log.warn(msg));
  } else if (bot) {
    app.log.error('TELEGRAM_BOT_TOKEN is set but the bot could not be reached — Telegram sign-in is OFF.');
  }
  if (!env.adminPassword) {
    app.log.warn('ADMIN_PASSWORD is not set — the admin panel (/admin) is locked until it is.');
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
    bot?.stop();
    // Don't let a hung connection stall shutdown until the orchestrator SIGKILLs.
    void Promise.race([app.close(), new Promise((r) => setTimeout(r, 10_000))]).then(() => process.exit(0));
  });
}
