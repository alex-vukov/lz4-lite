// Error handling: malformed frames and corrupt blocks must throw, rather than
// silently corrupt output or read/write out of bounds.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compress, decompress, decompressBlock, decompressBound } from '../src/index.js';

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

test('skips the optional dictionary ID in the frame header', () => {
  const input = enc('hello world hello world hello world hello world');
  const frame = compress(input);
  // Splice the dictID flag (FLG bit 0) + a 4-byte dictionary ID between BD and HC.
  // The decoder must skip the ID (it does no dictionary decode) and still parse.
  const withDict = u8([
    frame[0],
    frame[1],
    frame[2],
    frame[3], // magic
    frame[4] | 0x01, // FLG with dictID bit set
    frame[5], // BD
    0xde,
    0xad,
    0xbe,
    0xef, // dictionary ID (ignored)
    ...frame.subarray(6), // HC + blocks + end marker
  ]);
  assert.deepEqual(decompress(withDict), input);
});

test('rejects a truncated frame instead of silently stopping', () => {
  const frame = compress(enc('hello world hello world hello world'));
  // Drop the 4-byte end marker: the walker runs out of input mid-stream.
  const bad = frame.subarray(0, frame.length - 4);
  assert.throws(() => decompress(bad), /truncated frame/);
});

test('decompressBound stays proportional to input on crafted headers', () => {
  // magic + FLG(0x60) + BD(0x70, 4 MiB blocks) + HC, then many tiny "compressed"
  // block-size words. The old code added 4 MiB per block (~40 MB here); the bound
  // must now stay near 255x the input, never approaching the per-block max.
  const bytes: number[] = [0x04, 0x22, 0x4d, 0x18, 0x60, 0x70, 0x00];
  for (let i = 0; i < 10; i++) {
    bytes.push(0x01, 0x00, 0x00, 0x00, 0xff); // size word = 1 (compressed) + 1 payload byte
  }
  bytes.push(0x00, 0x00, 0x00, 0x00); // end marker
  const bad = u8(bytes);
  const bound = decompressBound(bad);
  assert.ok(bound <= 255 * bad.length, `bound ${bound} exceeds 255x input`);
  assert.ok(bound < 1024 * 1024, `bound ${bound} approached the per-block maximum`);
});

test('a valid frame still decodes after the negative cases', () => {
  const input = enc('the quick brown fox');
  assert.deepEqual(decompress(compress(input)), input);
});
