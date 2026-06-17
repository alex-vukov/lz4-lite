// lz4-lite — a lean, spec-compliant LZ4 (block + frame) codec.
//
// Ergonomic API: Uint8Array in, Uint8Array out; no caller-managed scratch or
// hash tables. See the README for usage and migration notes.

export { makeBuffer } from './binary.js';
export {
  compressBlock,
  compressBlockInto,
  compressBound,
  decompressBlock,
  decompressBlockInto,
} from './block.js';
// Low-level, zero-allocation primitives for advanced/streaming use.
export {
  compress,
  compressFrameInto,
  decompress,
  decompressBound,
  decompressFrameInto,
  frameBound,
} from './frame.js';
