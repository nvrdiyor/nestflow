import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Db, UserRow } from './db.js';
import type { TgSender, TgUpdate } from './telegram.js';

/**
 * Telegram confirmation for sign-in and sign-up.
 *
 * The site opens a challenge (a secret nonce) and links the user to
 * t.me/<bot>?start=<nonce>. Pressing START delivers the nonce to the bot, which
 * binds the Telegram account to the challenge and replies with a 6-digit code;
 * typing that code on the site finishes the flow in the SAME browser that
 * started it. Only a hash of the code is stored, codes expire, and wrong
 * guesses are capped — a leaked nonce alone is useless.
 *
 * One Telegram account maps to one site account, which is what stops spam
 * sign-ups: every email registration must be confirmed by a Telegram account
 * that has no site account yet.
 */

/** Placeholder email domain for Telegram-only accounts (.invalid is reserved, RFC 2606). */
export const TG_EMAIL_DOMAIN = 'telegram.invalid';

export interface TelegramAuthOptions {
  sender: TgSender;
  botUsername: string;
  /** Public site URL for bot messages, e.g. https://tasvirai.uz (optional). */
  siteUrl?: string;
  /** Challenge lifetime (default 10 minutes). */
  ttlMs?: number;
}

export interface VerifyOk {
  ok: true;
  user: UserRow;
  created: boolean;
}
export interface VerifyFail {
  ok: false;
  status: number;
  code: 'tg_expired' | 'tg_not_opened' | 'tg_attempts' | 'tg_bad_code' | 'tg_taken' | 'email_taken';
  error: string;
}

const MAX_ATTEMPTS = 5;
const MAX_SENDS = 5;

const hashCode = (nonce: string, code: string): string => createHash('sha256').update(`${nonce}:${code}`).digest('hex');

type Lang = 'uz' | 'ru' | 'en';
const langOf = (code?: string): Lang => (code?.startsWith('ru') ? 'ru' : code?.startsWith('en') ? 'en' : 'uz');

function messages(site: string) {
  const onSite = { uz: site ? ` (${site})` : '', ru: site ? ` (${site})` : '', en: site ? ` (${site})` : '' };
  return {
    code: (lang: Lang, code: string): string =>
      ({
        uz: `🔐 NestFlow tasdiqlash kodi: <code>${code}</code>\n\nKodni saytdagi oynaga kiriting. 10 daqiqa amal qiladi.\nKodni hech kimga bermang.`,
        ru: `🔐 Код подтверждения NestFlow: <code>${code}</code>\n\nВведите его на сайте. Код действует 10 минут.\nНикому не сообщайте этот код.`,
        en: `🔐 NestFlow verification code: <code>${code}</code>\n\nEnter it on the website. It is valid for 10 minutes.\nNever share this code.`,
      })[lang],
    help: (lang: Lang): string =>
      ({
        uz: `Salom! Bu bot NestFlow saytiga${onSite.uz} kirish va ro'yxatdan o'tishni tasdiqlaydi.\nSaytda «Telegram orqali kirish» tugmasini bosing.`,
        ru: `Здравствуйте! Этот бот подтверждает вход и регистрацию на сайте NestFlow${onSite.ru}.\nНажмите на сайте «Войти через Telegram».`,
        en: `Hi! This bot confirms sign-in and sign-up on NestFlow${onSite.en}.\nPress “Continue with Telegram” on the website.`,
      })[lang],
    expired: (lang: Lang): string =>
      ({
        uz: `⌛ Bu havola eskirgan. Saytda qaytadan boshlang${onSite.uz}.`,
        ru: `⌛ Ссылка устарела. Начните заново на сайте${onSite.ru}.`,
        en: `⌛ This link has expired. Please start again on the website${onSite.en}.`,
      })[lang],
    otherUser: (lang: Lang): string =>
      ({
        uz: '⚠️ Bu havola boshqa Telegram akkaunt bilan ochilgan. Saytda qaytadan boshlang.',
        ru: '⚠️ Эта ссылка уже открыта другим аккаунтом Telegram. Начните заново на сайте.',
        en: '⚠️ This link was already opened by another Telegram account. Please start again on the website.',
      })[lang],
    tooMany: (lang: Lang): string =>
      ({
        uz: "⚠️ Juda ko'p so'rov. Saytda qaytadan boshlang.",
        ru: '⚠️ Слишком много запросов. Начните заново на сайте.',
        en: '⚠️ Too many requests. Please start again on the website.',
      })[lang],
    taken: (lang: Lang): string =>
      ({
        uz: "ℹ️ Bu Telegram akkaunt allaqachon ro'yxatdan o'tgan. Saytda «Telegram orqali kirish» tugmasini bosing.",
        ru: 'ℹ️ Этот аккаунт Telegram уже зарегистрирован. Нажмите на сайте «Войти через Telegram».',
        en: 'ℹ️ This Telegram account is already registered. Use “Continue with Telegram” on the website.',
      })[lang],
    done: (lang: Lang, created: boolean): string =>
      created
        ? {
            uz: "✅ Akkaunt yaratildi va Telegram bilan bog'landi. Xush kelibsiz!",
            ru: '✅ Аккаунт создан и привязан к Telegram. Добро пожаловать!',
            en: '✅ Account created and linked to Telegram. Welcome!',
          }[lang]
        : {
            uz: "✅ Saytga kirish tasdiqlandi. Agar bu siz bo'lmasangiz — kodni hech kimga bermang.",
            ru: '✅ Вход на сайт подтверждён. Если это были не вы — никому не сообщайте код.',
            en: '✅ Sign-in confirmed. If this was not you, never share your code with anyone.',
          }[lang],
  };
}

export class TelegramAuth {
  private readonly ttlMs: number;
  private readonly msg: ReturnType<typeof messages>;
  /** Telegram user id → language, so the confirmation after verify matches the chat. */
  private readonly langs = new Map<string, Lang>();

  constructor(
    private readonly db: Db,
    private readonly opts: TelegramAuthOptions,
    /** Credits a newly created account starts with. */
    private readonly startingCredits: () => number,
  ) {
    this.ttlMs = opts.ttlMs ?? 10 * 60_000;
    this.msg = messages(opts.siteUrl ?? '');
  }

  get botUsername(): string {
    return this.opts.botUsername;
  }

  /** Opens a challenge; the returned link carries the nonce to the bot. */
  open(purpose: 'login' | 'register', payload: Record<string, unknown> = {}) {
    const nonce = randomBytes(16).toString('hex');
    this.db.createChallenge({ nonce, purpose, payload: JSON.stringify(payload), expiresAt: Date.now() + this.ttlMs });
    return {
      nonce,
      bot: this.opts.botUsername,
      link: `https://t.me/${this.opts.botUsername}?start=${nonce}`,
      expiresIn: Math.round(this.ttlMs / 1000),
    };
  }

  /** Handles one bot update: /start <nonce> gets a code, anything else gets help. */
  async onUpdate(u: TgUpdate): Promise<void> {
    const m = u.message;
    if (!m || m.chat.type !== 'private' || !m.from || m.from.is_bot) return;
    const from = m.from;
    const lang = langOf(from.language_code);
    const tgId = String(from.id);
    this.langs.set(tgId, lang);
    const say = (text: string): Promise<void> => this.opts.sender.sendMessage(m.chat.id, text);

    const start = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{8,64}))?\s*$/.exec((m.text ?? '').trim());
    const nonce = start?.[1];
    if (!nonce) return say(this.msg.help(lang));

    const ch = this.db.challenge(nonce);
    if (!ch || ch.expires_at < Date.now()) return say(this.msg.expired(lang));
    if (ch.tg_id && ch.tg_id !== tgId) return say(this.msg.otherUser(lang));
    if (ch.sends >= MAX_SENDS) return say(this.msg.tooMany(lang));
    if (ch.purpose === 'register' && this.db.userByTelegram(tgId)) return say(this.msg.taken(lang));

    const name =
      [from.first_name, from.last_name].filter(Boolean).join(' ').trim().slice(0, 80) ||
      (from.username ? `@${from.username}` : 'Telegram user');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.db.bindChallenge(nonce, { id: tgId, name, username: from.username ?? null }, hashCode(nonce, code));
    await say(this.msg.code(lang, code));
  }

  /** Checks the code; on success signs the user in (creating the account when needed). */
  async verify(nonce: string, code: string): Promise<VerifyOk | VerifyFail> {
    const ch = this.db.challenge(nonce);
    if (!ch || ch.expires_at < Date.now()) {
      if (ch) this.db.deleteChallenge(nonce);
      return { ok: false, status: 410, code: 'tg_expired', error: 'The confirmation expired. Start again.' };
    }
    if (!ch.tg_id || !ch.code_hash) {
      return { ok: false, status: 400, code: 'tg_not_opened', error: 'Open the bot and press START first.' };
    }
    if (ch.attempts >= MAX_ATTEMPTS) {
      this.db.deleteChallenge(nonce);
      return { ok: false, status: 429, code: 'tg_attempts', error: 'Too many wrong codes. Start again.' };
    }
    const want = Buffer.from(ch.code_hash, 'hex');
    const got = Buffer.from(hashCode(nonce, code), 'hex');
    if (want.length !== got.length || !timingSafeEqual(want, got)) {
      this.db.bumpChallengeAttempts(nonce);
      return { ok: false, status: 400, code: 'tg_bad_code', error: 'Wrong code.' };
    }

    const tgId = ch.tg_id;
    let user: UserRow | undefined = this.db.userByTelegram(tgId);
    let created = false;
    if (ch.purpose === 'register') {
      if (user) {
        this.db.deleteChallenge(nonce);
        return { ok: false, status: 409, code: 'tg_taken', error: 'This Telegram account is already registered.' };
      }
      const p = JSON.parse(ch.payload) as { name: string; email: string; passHash: string };
      if (this.db.userByEmail(p.email)) {
        this.db.deleteChallenge(nonce);
        return { ok: false, status: 409, code: 'email_taken', error: 'An account with this email already exists.' };
      }
      user = this.db.createUser({
        email: p.email,
        name: p.name,
        passHash: p.passHash,
        credits: this.startingCredits(),
        telegramId: tgId,
        telegramUsername: ch.tg_username,
      });
      created = true;
    } else if (!user) {
      // First Telegram sign-in: a Telegram-only account (no usable password).
      user = this.db.createUser({
        email: `tg${tgId}@${TG_EMAIL_DOMAIN}`,
        name: ch.tg_name ?? 'Telegram user',
        passHash: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
        credits: this.startingCredits(),
        telegramId: tgId,
        telegramUsername: ch.tg_username,
      });
      created = true;
    } else if (user.telegram_username !== ch.tg_username) {
      this.db.setTelegramUsername(user.id, ch.tg_username);
      user = { ...user, telegram_username: ch.tg_username };
    }
    this.db.deleteChallenge(nonce);
    this.db.touchUser(user.id);
    // Confirmation in the chat doubles as a sign-in alert; failure here is harmless.
    this.opts.sender
      .sendMessage(tgId, this.msg.done(this.langs.get(tgId) ?? 'uz', created))
      .catch(() => undefined);
    return { ok: true, user, created };
  }
}
