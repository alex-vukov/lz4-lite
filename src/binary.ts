// Little-endian integer helpers and buffer allocation.

/** Read a 32-bit little-endian unsigned integer at byte offset `i`. */
export function readU32(b: Uint8Array, i: number): number {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

/** Write a 32-bit little-endian unsigned integer at byte offset `i`. */
export function writeU32(b: Uint8Array, i: number, x: number): void {
  b[i] = x & 0xff;
  b[i + 1] = (x >>> 8) & 0xff;
  b[i + 2] = (x >>> 16) & 0xff;
  b[i + 3] = (x >>> 24) & 0xff;
}

/**
 * Read a 64-bit little-endian unsigned integer at byte offset `i`.
 * Returns a JS number (safe for values up to 2^53 — ample for content sizes).
 */
export function readU64(b: Uint8Array, i: number): number {
  const lo = readU32(b, i);
  const hi = readU32(b, i + 4);
  return hi * 0x100000000 + lo;
}

/** Allocate a zero-filled byte buffer. */
export function makeBuffer(size: number): Uint8Array {
  return new Uint8Array(size);
}
