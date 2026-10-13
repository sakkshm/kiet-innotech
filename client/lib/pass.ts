/**
 * The event pass code, made on the phone so it works without mobile data once the pass has loaded that day.
 * Mirrors server/app/services/attendance.py:
 *   code = "IT26P:" + user id (32 hex, upper case) + "." + minute number + "." + base32(HMAC-SHA256(seed, minute)[:10])
 * The seed comes from GET /me/pass and is valid for one IST day.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(bytes: Uint8Array) {
  let out = "";
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
      value &= (1 << bits) - 1;
    }
  }
  return bits > 0 ? out + ALPHABET[(value << (5 - bits)) & 31] : out;
}

function fromBase64Url(text: string) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const keys = new Map<string, Promise<CryptoKey>>();

function keyFor(seed: string) {
  let key = keys.get(seed);
  if (!key) {
    key = crypto.subtle.importKey("raw", fromBase64Url(seed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keys.set(seed, key);
  }
  return key;
}

export async function passCode(seed: string, userId: string, period: number) {
  const message = new DataView(new ArrayBuffer(8));
  message.setBigUint64(0, BigInt(period));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await keyFor(seed), message.buffer));
  return `IT26P:${userId.replace(/-/g, "").toUpperCase()}.${period}.${base32(mac.slice(0, 10))}`;
}

/** The IST calendar day ("2026-10-22") of a moment, as the server counts days for seeds. */
export function istDay(ms: number) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
