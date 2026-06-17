// Direct validation of the xxHash32 implementation against the reference
// vectors from github.com/pierrec/xxHash (seed 0). xxHash32 backs the LZ4 frame
// descriptor checksum, so getting it exactly right is what makes our frames
// decodable by the reference lz4 tools.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { xxh32 } from '../src/xxhash32.js';

const enc = (s: string) => new TextEncoder().encode(s);

// Sequential ASCII inputs "a", "ab", ... and a long Lorem ipsum, with their
// reference XXH32 digests (seed 0).
const ALPHABET = 'abcdefghij';
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod ' +
  'tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim ' +
  'veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea ' +
  'commodo consequat. Duis aute irure dolor in reprehenderit in voluptate ' +
  'velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat ' +
  'cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id ' +
  'est laborum.';

const VECTORS: Array<[number, Uint8Array]> = [
  [0x02cc5d05, enc('')],
  [0x550d7456, enc(ALPHABET.slice(0, 1))],
  [0x4999fc53, enc(ALPHABET.slice(0, 2))],
  [0x32d153ff, enc(ALPHABET.slice(0, 3))],
  [0xa3643705, enc(ALPHABET.slice(0, 4))],
  [0x9738f19b, enc(ALPHABET.slice(0, 5))],
  [0x8b7cd587, enc(ALPHABET.slice(0, 6))],
  [0x9dd093b3, enc(ALPHABET.slice(0, 7))],
  [0x0bb3c6bb, enc(ALPHABET.slice(0, 8))],
  [0xd03c13fd, enc(ALPHABET.slice(0, 9))],
  [0x8b988cfe, enc(ALPHABET.slice(0, 10))],
  [0x9d2d8b62, enc('abcdefghijklmnop')], // 16 bytes
  [0x42ae804d, enc(ALNUM)], // 36 bytes
  [0x62b4ed00, enc(LOREM)],
];

test('xxh32 matches the pierrec/xxHash reference vectors (seed 0)', () => {
  for (const [expected, input] of VECTORS) {
    assert.equal(xxh32(input, 0, input.length, 0) >>> 0, expected >>> 0, `len ${input.length}`);
  }
});

test('xxh32 respects index and length offsets within a buffer', () => {
  // Hash of "abc" embedded inside a larger buffer must equal hash of "abc".
  const framed = enc('XXabcYY');
  assert.equal(xxh32(framed, 2, 3, 0) >>> 0, 0x32d153ff);
});

test('xxh32 seed changes the digest', () => {
  const input = enc(ALNUM);
  assert.notEqual(xxh32(input, 0, input.length, 0), xxh32(input, 0, input.length, 1));
});
