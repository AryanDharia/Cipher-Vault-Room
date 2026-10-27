/**
 * VaultRoom Client-Side Zero-Knowledge Cryptography Engine
 * Uses the Web Crypto API (SubtleCrypto) with AES-GCM 256-bit and PBKDF2.
 * Plaintext document contents and raw keys NEVER leave the browser unencrypted.
 */

export interface EncryptedEnvelope {
  v: number;
  iv: string;         // Hex or Base64 encoded 12-byte IV
  ciphertext: string; // Base64 encoded ciphertext
  authTag?: string;   // Included in AES-GCM ciphertext by Web Crypto
  salt?: string;      // Base64 salt if derived
}

// Convert ArrayBuffer to Base64
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Convert Base64 to ArrayBuffer
export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Convert ArrayBuffer to Hex string
export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Convert Hex string to Uint8Array
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Generate a cryptographically secure 256-bit AES-GCM Document Key
 */
export async function generateDocumentKey(): Promise<CryptoKey> {
  return window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true, // extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Derive an AES-GCM 256-bit key from a Room Passphrase and Room Code (PBKDF2)
 */
export async function deriveRoomKey(passphrase: string, roomCode: string): Promise<{ key: CryptoKey; saltHex: string }> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const saltBytes = enc.encode(`vaultroom_salt_${roomCode.toUpperCase()}`);
  const key = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  return { key, saltHex: bufferToHex(saltBytes.buffer) };
}

/**
 * Encrypt plaintext string with AES-GCM (12-byte IV)
 */
export async function encryptEnvelope(plaintext: string, key: CryptoKey): Promise<EncryptedEnvelope> {
  const enc = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as any,
    },
    key,
    enc.encode(plaintext)
  );

  return {
    v: 1,
    iv: bufferToHex(iv.buffer),
    ciphertext: bufferToBase64(encrypted),
  };
}

/**
 * Decrypt envelope string using AES-GCM key
 */
export async function decryptEnvelope(envelope: EncryptedEnvelope | string, key: CryptoKey): Promise<string> {
  const env: EncryptedEnvelope = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
  const iv = hexToBytes(env.iv);
  const cipherBuffer = base64ToBuffer(env.ciphertext);

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv as any,
    },
    key,
    cipherBuffer as any
  );

  const dec = new TextDecoder();
  return dec.decode(decrypted);
}

/**
 * Export raw CryptoKey to Base64 string (for client-side memory storage)
 */
export async function exportKeyBase64(key: CryptoKey): Promise<string> {
  const raw = await window.crypto.subtle.exportKey('raw', key);
  return bufferToBase64(raw);
}

/**
 * Import Base64 string to CryptoKey
 */
export async function importKeyBase64(base64: string): Promise<CryptoKey> {
  const buffer = base64ToBuffer(base64);
  return window.crypto.subtle.importKey(
    'raw',
    buffer,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}
