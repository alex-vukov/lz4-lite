// Clean-room xxHash32, implemented from the xxHash specification. Used solely
// for the LZ4 frame descriptor (header) checksum.
//
// Reference: https://github.com/Cyan4973/xxHash/blob/dev/doc/xxhash_spec.md

import { readU32 } from './binary.js';

const PRIME1 = 0x9e3779b1;
const PRIME2 = 0x85ebca77;
const PRIME3 = 0xc2b2ae3d;
const PRIME4 = 0x27d4eb2f;
const PRIME5 = 0x165667b1;

function rotl(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r));
}

function round(acc: number, input: number): number {
  acc = (acc + Math.imul(input, PRIME2)) | 0;
  acc = rotl(acc, 13);
  return Math.imul(acc, PRIME1) | 0;
}

/**
 * Compute xxHash32 over `src[index .. index+len)` with the given seed.
 * Returns an unsigned 32-bit integer.
 */
export function xxh32(src: Uint8Array, index: number, len: number, seed = 0): number {
  const end = index + len;
  let p = index;
  let h: number;

  if (len >= 16) {
    const limit = end - 16;
    let v1 = (seed + PRIME1 + PRIME2) | 0;
    let v2 = (seed + PRIME2) | 0;
    let v3 = (seed + 0) | 0;
    let v4 = (seed - PRIME1) | 0;

    do {
      v1 = round(v1, readU32(src, p));
      v2 = round(v2, readU32(src, p + 4));
      v3 = round(v3, readU32(src, p + 8));
      v4 = round(v4, readU32(src, p + 12));
      p += 16;
    } while (p <= limit);

    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) | 0;
  } else {
    h = (seed + PRIME5) | 0;
  }

  h = (h + len) | 0;

  while (p + 4 <= end) {
    h = (h + Math.imul(readU32(src, p), PRIME3)) | 0;
    h = Math.imul(rotl(h, 17), PRIME4) | 0;
    p += 4;
  }

  while (p < end) {
    h = (h + Math.imul(src[p], PRIME5)) | 0;
    h = Math.imul(rotl(h, 11), PRIME1) | 0;
    p += 1;
  }

  h ^= h >>> 15;
  h = Math.imul(h, PRIME2) | 0;
  h ^= h >>> 13;
  h = Math.imul(h, PRIME3) | 0;
  h ^= h >>> 16;

  return h >>> 0;
}
