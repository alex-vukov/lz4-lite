# lz4-lite

A lean, optimized, **spec-compliant** [LZ4](https://lz4.org) codec (block + frame)
written in TypeScript, compiled with `tsc`. Zero runtime dependencies. Ships dual
**ESM + CommonJS** builds with type declarations.

- ✅ Produces output that decodes in the **reference LZ4** tools / liblz4 (block
  end-of-block rules `MFLIMIT`/`LASTLITERALS` are respected).
- ✅ Reads frames produced by `lz4` / `lz4c` / `lz4js` (linked or independent blocks).
- ✅ Ergonomic `Uint8Array`-in / `Uint8Array`-out API — no caller-managed scratch
  buffers or hash tables.

## Install

```sh
npm install lz4-lite
```

## Usage

```ts
import { compress, decompress } from 'lz4-lite';

const data = new TextEncoder().encode('hello hello hello world');

const frame = compress(data);          // Uint8Array (a complete LZ4 frame)
const back = decompress(frame);        // Uint8Array (=== data)
```

CommonJS works too:

```js
const { compress, decompress } = require('lz4-lite');
```

### API

| Function | Description |
| --- | --- |
| `compress(src: Uint8Array): Uint8Array` | Compress to a complete LZ4 frame. |
| `decompress(src: Uint8Array, maxSize?: number): Uint8Array` | Decompress a frame. `maxSize` is an optional output-size hint; otherwise it is derived from the frame. |
| `compressBlock(src: Uint8Array): Uint8Array` | Compress a single raw LZ4 block (no frame header). |
| `decompressBlock(block: Uint8Array, expectedSize: number): Uint8Array` | Decompress a single raw block into `expectedSize` bytes. |
| `compressBound(n: number): number` | Worst-case compressed size for `n` input bytes. |
| `decompressBound(src: Uint8Array): number` | Upper bound on a frame's decompressed size. |
| `makeBuffer(size: number): Uint8Array` | Allocate a zero-filled buffer. |

Low-level, zero-allocation primitives are also exported for advanced use:
`compressFrameInto`, `decompressFrameInto`, `compressBlockInto`,
`decompressBlockInto`, `frameBound`.

## Migrating from `lz4js`

`lz4-lite` is **not** a drop-in module replacement — it exposes a smaller,
ergonomic API and you no longer manage `dst` buffers or hash tables yourself.
The frame helpers map directly; the block helpers lose their positional
out-parameters.

| `lz4js` | `lz4-lite` |
| --- | --- |
| `lz4.compress(buf)` | `compress(buf)` — same shape, returns a `Uint8Array`. |
| `lz4.decompress(buf)` / `lz4.decompress(buf, maxSize)` | `decompress(buf)` / `decompress(buf, maxSize)`. |
| `lz4.compressBound(n)` | `compressBound(n)`. |
| `lz4.decompressBound(buf)` | `decompressBound(buf)`. |
| `lz4.makeBuffer(n)` | `makeBuffer(n)`. |
| `const dst = lz4.makeBuffer(lz4.compressBound(src.length));`<br>`const n = lz4.compressBlock(src, dst, 0, src.length, hashTable);`<br>`const block = dst.slice(0, n);` | `const block = compressBlock(src);` |
| `const dst = lz4.makeBuffer(size);`<br>`lz4.decompressBlock(src, dst, 0, src.length, 0);` | `const out = decompressBlock(block, size);` |

Notes:
- `compressBlock` always returns a valid, round-trippable block — even for inputs
  shorter than 13 bytes (it emits a literals-only block). `lz4js` returned an
  empty result in that case (issue #15).
- Frames produced by `lz4-lite` decode correctly in the reference LZ4 tools; some
  `lz4js` output did not for larger inputs (issues #7/#8, rooted in the #12
  end-of-block violation). `lz4-lite` fixes this.
- Inputs/outputs are always `Uint8Array`. If you have a Node `Buffer`, it already
  *is* a `Uint8Array`; wrap with `new Uint8Array(buf)` only if you want to detach
  from the pooled allocation.

## Compatibility & format notes

- Emits version-01 frames with **independent** 4 MiB blocks and the mandatory
  header checksum (xxHash32). No content/block checksums are written.
- The decoder is lenient: it reads content size and block/content checksums when
  present, and decodes both independent- and linked-block frames.
- Fast (default) compression only. High-compression (HC) mode, dictionaries, and
  streaming are out of scope.

## License

MIT © 2026 Alex Vukov. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
Clean implementation from the published LZ4 format specifications; no
third-party source was copied.
