// Seeded round-trip fuzzing — the way the reference LZ4 validates itself.
// Exercises many sizes (including block-boundary edges), data profiles, and
// seeds, through both the frame API and the raw block API.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compress, compressBlock, decompress, decompressBlock, decompressBound } from '../src/index.js';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Profile = 'random' | 'lowentropy' | 'repetitive' | 'textlike' | 'mixed';

function makeData(size: number, seed: number, profile: Profile): Uint8Array {
  const rnd = mulberry32(seed);
  const a = new Uint8Array(size);
  switch (profile) {
    case 'random':
      for (let i = 0; i < size; i++) a[i] = (rnd() * 256) | 0;
      break;
    case 'lowentropy':
      for (let i = 0; i < size; i++) a[i] = (rnd() * 4) | 0; // 4 distinct symbols
      break;
    case 'repetitive': {
      const period = 1 + ((rnd() * 8) | 0);
      const pat = new Uint8Array(period);
      for (let i = 0; i < period; i++) pat[i] = (rnd() * 256) | 0;
      for (let i = 0; i < size; i++) a[i] = pat[i % period];
      break;
    }
    case 'textlike': {
      const words = ['the ', 'quick ', 'brown ', 'fox ', 'lazy ', 'dog ', 'and ', 'a '];
      let s = '';
      while (s.length < size) s += words[(rnd() * words.length) | 0];
      const bytes = new TextEncoder().encode(s);
      a.set(bytes.subarray(0, size));
      break;
    }
    case 'mixed':
      for (let i = 0; i < size; i++) a[i] = rnd() < 0.7 ? 0x41 : (rnd() * 256) | 0;
      break;
  }
  return a;
}

const SIZES = [
  0, 1, 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16, 17, 31, 32, 33, 63, 64, 65, 254, 255, 256, 257, 1023, 1024,
  4096, 65535, 65536, 65537,
];
const BIG_SIZES = [1 << 20, (4 << 20) - 1, 4 << 20, (4 << 20) + 1, 5 << 20]; // 4 MiB block boundary
const PROFILES: Profile[] = ['random', 'lowentropy', 'repetitive', 'textlike', 'mixed'];

function eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

test('frame round-trip across sizes, profiles, and seeds', () => {
  for (const profile of PROFILES) {
    for (const seed of [1, 2, 3]) {
      for (const size of SIZES) {
        const input = makeData(size, seed * 7919 + size, profile);
        const out = decompress(compress(input));
        assert.ok(eq(out, input), `frame ${profile} size=${size} seed=${seed}`);
      }
    }
  }
});

test('frame round-trip across the 4 MiB block boundary', () => {
  for (const profile of ['repetitive', 'random', 'textlike'] as Profile[]) {
    for (const size of BIG_SIZES) {
      const input = makeData(size, size, profile);
      assert.ok(eq(decompress(compress(input)), input), `frame ${profile} size=${size}`);
    }
  }
});

test('raw block round-trip across sizes and profiles', () => {
  for (const profile of PROFILES) {
    for (const size of SIZES) {
      if (size === 0) continue;
      const input = makeData(size, size + 101, profile);
      const block = compressBlock(input);
      assert.ok(block.length > 0, `non-empty block for size=${size}`);
      assert.ok(eq(decompressBlock(block, size), input), `block ${profile} size=${size}`);
    }
  }
});

test('decompressBound is an upper bound and compression is deterministic', () => {
  for (const profile of PROFILES) {
    for (const size of [13, 1000, 70000]) {
      const input = makeData(size, size, profile);
      const a = compress(input);
      const b = compress(input);
      assert.ok(eq(a, b), `deterministic ${profile} size=${size}`);
      assert.ok(decompressBound(a) >= size, `bound ${profile} size=${size}`);
    }
  }
});

test('decompress honours an explicit maxSize equal to the exact size', () => {
  for (const size of [0, 1, 13, 5000, 100000]) {
    const input = makeData(size, size, 'textlike');
    assert.ok(eq(decompress(compress(input), size), input), `maxSize size=${size}`);
  }
});
