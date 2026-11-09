/* eslint-disable no-bitwise */

/** Lower-case hex with no separators, the form protocol fixtures and transcripts use. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += (b < 16 ? '0' : '') + b.toString(16);
  return out;
}

/** Accepts "fe ea 20", "FEEA20" or "fe:ea:20". */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Device-information strings are ASCII in practice; anything else is kept as a replacement mark. */
export function bytesToText(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    if (b === 0) break;
    out += b < 128 ? String.fromCharCode(b) : '�';
  }
  return out.trim();
}

export function u16le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}

export function u24le(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}

export function u32le(b: Uint8Array, i: number): number {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

export function u32be(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}
