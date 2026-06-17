// Self-contained correctness tests (node:test): trusted vectors and round-trips
// that keep the package independently verifiable.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compress,
  compressBlock,
  compressBound,
  decompress,
  decompressBlock,
  decompressBound,
} from '../src/index.js';

const u8 = (a: number[]) => Uint8Array.from(a);
const enc = (s: string) => new TextEncoder().encode(s);

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// --- trusted vectors (lz4c / Linux kernel) ---

test('decodes the Linux-kernel raw block vector', () => {
  const block = u8([
    0xf0, 0x10, 0x4a, 0x6f, 0x69, 0x6e, 0x20, 0x75, 0x73, 0x20, 0x6e, 0x6f, 0x77, 0x20, 0x61, 0x6e, 0x64,
    0x20, 0x73, 0x68, 0x61, 0x72, 0x65, 0x20, 0x74, 0x68, 0x65, 0x20, 0x73, 0x6f, 0x66, 0x74, 0x77, 0x0d,
    0x00, 0x0f, 0x23, 0x00, 0x0b, 0x50, 0x77, 0x61, 0x72, 0x65, 0x20,
  ]);
  const out = decompressBlock(block, 70);
  assert.equal(new TextDecoder().decode(out), 'Join us now and share the software '.repeat(2));
});

test('decodes an lz4c-produced frame', () => {
  const frame = u8([
    0x04, 0x22, 0x4d, 0x18, 0x64, 0x40, 0xa7, 0x1b, 0x00, 0x00, 0x80, 0x54, 0x68, 0x65, 0x20, 0x77, 0x68,
    0x6f, 0x6c, 0x65, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x20, 0x69, 0x73, 0x20, 0x65, 0x6e, 0x64, 0x69,
    0x6e, 0x67, 0x2e, 0x0a, 0x00, 0x00, 0x00, 0x00, 0xbc, 0xa8, 0x6b, 0xc5,
  ]);
  assert.equal(new TextDecoder().decode(decompress(frame)), 'The whole world is ending.\n');
});

test('decodes an lz4c frame that carries content size', () => {
  const frame = u8([
    0x04, 0x22, 0x4d, 0x18, 0x6c, 0x40, 0x38, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x58, 0x38, 0x00,
    0x00, 0x80, 0x49, 0x66, 0x20, 0x79, 0x6f, 0x75, 0x20, 0x22, 0x77, 0x69, 0x6e, 0x2c, 0x22, 0x20, 0x79,
    0x6f, 0x75, 0x20, 0x77, 0x6f, 0x6e, 0x27, 0x74, 0x20, 0x77, 0x61, 0x6e, 0x74, 0x20, 0x74, 0x6f, 0x20,
    0x22, 0x70, 0x6c, 0x61, 0x79, 0x22, 0x20, 0x77, 0x69, 0x74, 0x68, 0x20, 0x6d, 0x65, 0x20, 0x61, 0x6e,
    0x79, 0x6d, 0x6f, 0x72, 0x65, 0x2e, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x9f, 0xda, 0xad, 0x19,
  ]);
  assert.equal(
    new TextDecoder().decode(decompress(frame)),
    'If you "win," you won\'t want to "play" with me anymore.\n',
  );
});

// --- round-trips ---

const corpus: Record<string, Uint8Array> = {
  empty: u8([]),
  'one byte': u8([42]),
  text: enc('the quick brown fox jumps over the lazy dog. '.repeat(500)),
  rle: new Uint8Array(100_000).fill(7),
  'pattern offset-2': (() => {
    const a = new Uint8Array(50_000);
    for (let i = 0; i < a.length; i++) a[i] = i & 1 ? 0x62 : 0x61;
    return a;
  })(),
  json: enc(JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ id: i, name: 'row', ok: true })))),
  incompressible: (() => {
    const a = new Uint8Array(40_000);
    let x = 123456789 >>> 0;
    for (let i = 0; i < a.length; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      a[i] = x & 0xff;
    }
    return a;
  })(),
  'multi-block 5MiB': enc('Lorem ipsum dolor sit amet '.repeat(200_000)),
};

for (const [name, input] of Object.entries(corpus)) {
  test(`frame round-trip: ${name}`, () => {
    const out = decompress(compress(input));
    assert.ok(bytesEqual(out, input), `mismatch for ${name}`);
  });
}

test('decompress honours an explicit maxSize', () => {
  const input = enc('abc'.repeat(1000));
  const out = decompress(compress(input), input.length);
  assert.ok(bytesEqual(out, input));
});

// --- regression: #15 (short inputs produce valid, round-trippable blocks) ---

for (const n of [1, 4, 5, 12, 13]) {
  test(`#15 compressBlock emits a valid block for ${n}-byte input`, () => {
    const input = enc('abcdefghijklm'.slice(0, n));
    const block = compressBlock(input);
    assert.ok(block.length > 0, 'block must not be empty');
    assert.ok(bytesEqual(decompressBlock(block, input.length), input));
  });
}

// --- bounds ---

test('compressBound / decompressBound are sane', () => {
  assert.ok(compressBound(1000) >= 1000);
  const input = enc('hello world '.repeat(100));
  assert.ok(decompressBound(compress(input)) >= input.length);
});
