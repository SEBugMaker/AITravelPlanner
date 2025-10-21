import crypto from "node:crypto";

const SECRET_ENV_KEY = "SETTINGS_SECRET_PASSPHRASE";
const SECRET_FALLBACK_ENV_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SERVICE_ROLE_KEY"
];

let cachedCipherKey: Buffer | null = null;
let announcedFallback = false;
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function resolvePassphrase(): string {
  const direct = process.env[SECRET_ENV_KEY];
  if (direct && direct.trim()) {
    return direct;
  }

  for (const candidate of SECRET_FALLBACK_ENV_KEYS) {
    const value = process.env[candidate];
    if (value && value.trim()) {
      if (!announcedFallback) {
        console.warn(
          `[settings-secrets] ${SECRET_ENV_KEY} 未配置，自动回退使用 ${candidate}`
        );
        announcedFallback = true;
      }
      return value;
    }
  }

  throw new Error(`缺少用于加密的环境变量 ${SECRET_ENV_KEY}`);
}

function getCipherKey(): Buffer {
  if (cachedCipherKey) {
    return cachedCipherKey;
  }
  const passphrase = resolvePassphrase();
  cachedCipherKey = crypto.createHash("sha256").update(passphrase).digest();
  return cachedCipherKey;
}

export function encryptSecret(value: string): string {
  const key = getCipherKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("密文格式无效");
  }
  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const key = getCipherKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

export function createSecretPreview(secret: string): string {
  const normalized = secret.trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= 6) {
    return normalized;
  }
  const prefix = normalized.slice(0, 3);
  const suffix = normalized.slice(-3);
  const maskLength = Math.max(3, normalized.length - 6);
  return `${prefix}${"*".repeat(maskLength)}${suffix}`;
}
