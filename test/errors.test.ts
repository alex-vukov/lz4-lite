// Error handling: malformed frames and corrupt blocks must throw, rather than
// silently corrupt output or read/write out of bounds.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compress, decompress, decompressBlock } from '../src/index.js';

const u8 = (a: number[]) => Uint8Array.from(a);
const enc = (s: string) => new TextEncoder().encode(s);

test('rejects a frame with a bad magic number', () => {
  const frame = compress(enc('hello world hello world'));
  const bad = frame.slice();
  bad[0] ^= 0xff;
  assert.throws(() => decompress(bad), /magic number/);
});

test('rejects an unsupported frame version', () => {
  // valid magic, FLG version bits cleared
  const bad = u8([0x04, 0x22, 0x4d, 0x18, 0x00, 0x70, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.throws(() => decompress(bad), /version/);
});

test('rejects an invalid block maximum size', () => {
  // valid magic + version, but BD selects an out-of-range block size id (0)
  const bad = u8([0x04, 0x22, 0x4d, 0x18, 0x60, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.throws(() => decompress(bad), /block maximum size/);
});

test('rejects a block whose literal run overruns the block', () => {
  // token 0x10 => 1 literal, but no literal byte follows
  assert.throws(() => decompressBlock(u8([0x10]), 16), /literal run exceeds block/);
});

test('rejects a block with a truncated literal length', () => {
  // token 0xf0 => literal length 15 + extension, but extension byte is missing
  assert.throws(() => decompressBlock(u8([0xf0]), 16), /truncated literal length/);
});

test('rejects a block with an out-of-range match offset', () => {
  // token 0x01 => 0 literals, match; offset = 0xffff but nothing decoded yet
  assert.throws(() => decompressBlock(u8([0x01, 0xff, 0xff]), 16), /invalid match offset/);
});

test('a valid frame still decodes after the negative cases', () => {
  const input = enc('the quick brown fox');
  assert.deepEqual(decompress(compress(input)), input);
});
