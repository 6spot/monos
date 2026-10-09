import { sha256 as hashSHA256 } from '@noble/hashes/sha2.js';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// getRandomValues remains available on ordinary HTTP origins, unlike randomUUID.
export function randomUUID(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const value = hex(bytes);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  // Keep exact digest verification when a non-secure HTTP context omits subtle.
  return hex(crypto.subtle
    ? new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    : hashSHA256(bytes));
}
