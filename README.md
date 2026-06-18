# LZ4 Lite

A lean, **spec-compliant** [LZ4](https://lz4.org) codec (block + frame) in
TypeScript. Zero dependencies, dual **ESM + CommonJS** builds with type
declarations.

Inspired by [`lz4js`](https://github.com/Benzinga/lz4js) — a faster, clean
reimplementation that fixes the bugs which made some `lz4js` output fail to decode
in the reference LZ4 tools. Fully interoperable with `lz4` / `lz4c` / liblz4: they
decode the frames it produces, and it decodes theirs.

## Install

```sh
npm install lz4-lite
```

## Usage

```ts
import { compress, decompress } from 'lz4-lite';

const data = new TextEncoder().encode('hello hello hello world');
const frame = compress(data);     // Uint8Array — a complete LZ4 frame
const back = decompress(frame);   // Uint8Array — === data
```

CommonJS: `const { compress, decompress } = require('lz4-lite');`

## API

`Uint8Array` in, `Uint8Array` out — no caller-managed buffers or hash tables.

| Function | Description |
| --- | --- |
| `compress(src)` | Compress to a complete LZ4 frame. |
| `decompress(src, maxSize?)` | Decompress a frame (`maxSize` is an optional output-size hint). |
| `compressBlock(src)` | Compress a single raw block (no frame header). |
| `decompressBlock(block, size)` | Decompress a raw block into `size` bytes. |
| `compressBound(n)` / `decompressBound(src)` | Size bounds. |

Low-level zero-allocation `*Into` primitives and `makeBuffer` are also exported for
advanced use.

## Benchmark

Throughput vs `lz4js` (tinybench harness, Node 24; ±10–15% run-to-run).

| data | compress | decompress |
| --- | --- | --- |
| text / JSON / source | 1.4–1.6× | ~1× |
| repetitive / incompressible | 1.9–2.9× | 5–6× |

`lz4-lite` compresses faster across the board; decompression is on par for
text/JSON and several times faster on repetitive or incompressible data.

## Migrating from `lz4js`

**Frame functions** keep the same call shape — just drop the `lz4.` prefix:
`compress`, `decompress`, `compressBound`, `decompressBound`, `makeBuffer`.

**Block functions** are simpler — `lz4-lite` drops the caller-managed buffer,
offsets, and hash table; each call returns its result:

| `lz4js` | `lz4-lite` |
| --- | --- |
| `n = lz4.compressBlock(src, dst, 0, src.length, hashTable)` | `block = compressBlock(src)` |
| `lz4.decompressBlock(src, out, 0, src.length, 0)` | `out = decompressBlock(block, size)` |

Note `decompressBlock`'s second argument is the decompressed **output size**, not a
source length. Also, `compressBlock` always emits a valid block — even for inputs
under 13 bytes, where `lz4js` returned an empty result.

## Format notes

- Emits version-01 frames with **independent** 4 MiB blocks and only the header
  checksum (xxHash32).
- The decoder is lenient: it reads content/block checksums and linked-block frames
  when present.
- Fast compression only — no HC mode, dictionaries, or streaming.

## License

MIT © 2026 Alex Vukov. Clean implementation from the published LZ4 specifications;
no third-party source was copied. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
