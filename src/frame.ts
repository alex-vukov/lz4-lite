// Emits version-01 frames with independent 4 MiB blocks and the mandatory header
// checksum only. The decoder also accepts content size and block/content
// checksums when present, and reads linked-block frames from standard LZ4 tools
// (it copies matches from the full output buffer).

import { makeBuffer, readU32, readU64, writeU32 } from './binary.js';
import { compressBlockInto, compressBound, decompressBlockInto, scratchHashTable } from './block.js';
import {
  BD_BLOCK_MAX_MASK,
  BD_BLOCK_MAX_SHIFT,
  BD_WRITE,
  BLOCK_MAX_SIZE_ID,
  BLOCK_UNCOMPRESSED_FLAG,
  DEFAULT_BLOCK_SIZE,
  FLG_BLOCK_CHECKSUM,
  FLG_CONTENT_CHECKSUM,
  FLG_CONTENT_SIZE,
  FLG_DICT_ID,
  FLG_VERSION,
  FLG_VERSION_MASK,
  FLG_WRITE,
  MAGIC,
  MAX_BLOCK_EXPANSION,
} from './constants.js';
import { xxh32 } from './xxhash32.js';

const HEADER_SIZE = 7; // magic(4) + FLG(1) + BD(1) + HC(1), no content size

/** Upper bound on the full frame size for `n` input bytes. */
export function frameBound(n: number): number {
  return compressBound(n) + 16;
}

/** Write a complete LZ4 frame for `src` into `dst`; returns bytes written. */
export function compressFrameInto(src: Uint8Array, dst: Uint8Array): number {
  let d = 0;
  writeU32(dst, d, MAGIC);
  d += 4;
  dst[d++] = FLG_WRITE;
  dst[d++] = BD_WRITE;
  dst[d++] = (xxh32(dst, 4, 2, 0) >>> 8) & 0xff; // header checksum

  const table = scratchHashTable();
  const total = src.length;
  let s = 0;

  while (s < total) {
    const blockSize = total - s < DEFAULT_BLOCK_SIZE ? total - s : DEFAULT_BLOCK_SIZE;

    // Compress directly into dst after a reserved 4-byte block header. If it
    // doesn't shrink, overwrite that region with the stored (raw) block.
    const headerPos = d;
    const compEnd = compressBlockInto(src, s, blockSize, dst, headerPos + 4, table);
    const compSize = compEnd - (headerPos + 4);

    if (compSize < blockSize) {
      writeU32(dst, headerPos, compSize);
      d = compEnd;
    } else {
      writeU32(dst, headerPos, blockSize | BLOCK_UNCOMPRESSED_FLAG);
      dst.set(src.subarray(s, s + blockSize), headerPos + 4);
      d = headerPos + 4 + blockSize;
    }
    s += blockSize;
  }

  writeU32(dst, d, 0); // end marker
  d += 4;
  return d;
}

/** Read an LZ4 frame from `src` into `dst`; returns bytes written. */
export function decompressFrameInto(src: Uint8Array, dst: Uint8Array): number {
  let s = 0;
  if (readU32(src, s) !== MAGIC) throw new Error('lz4-lite: invalid magic number');
  s += 4;

  const flg = src[s++];
  if ((flg & FLG_VERSION_MASK) !== FLG_VERSION) {
    throw new Error('lz4-lite: unsupported frame version');
  }
  const bsId = (src[s++] >> BD_BLOCK_MAX_SHIFT) & BD_BLOCK_MAX_MASK;
  if (BLOCK_MAX_SIZE_ID[bsId] === undefined) {
    throw new Error('lz4-lite: invalid block maximum size');
  }
  const hasContentSize = (flg & FLG_CONTENT_SIZE) !== 0;
  const hasBlockChecksum = (flg & FLG_BLOCK_CHECKSUM) !== 0;
  const hasContentChecksum = (flg & FLG_CONTENT_CHECKSUM) !== 0;
  const hasDictId = (flg & FLG_DICT_ID) !== 0;

  if (hasContentSize) s += 8;
  if (hasDictId) s += 4; // optional dictionary ID (value ignored — no dict decode)
  s += 1; // header checksum

  let d = 0;
  for (;;) {
    if (s + 4 > src.length) throw new Error('lz4-lite: truncated frame');
    const blockSize = readU32(src, s);
    s += 4;
    if (blockSize === 0) break; // end marker

    const stored = (blockSize & BLOCK_UNCOMPRESSED_FLAG) !== 0;
    const payloadLen = blockSize & 0x7fffffff;
    if (s + payloadLen > src.length) throw new Error('lz4-lite: truncated frame');

    if (stored) {
      if (d + payloadLen > dst.length) throw new Error('lz4-lite: output buffer too small');
      dst.set(src.subarray(s, s + payloadLen), d);
      d += payloadLen;
    } else {
      d = decompressBlockInto(src, s, payloadLen, dst, d);
    }
    s += payloadLen;
    if (hasBlockChecksum) s += 4;
  }
  if (hasContentChecksum) s += 4;

  return d;
}

/** Upper bound on the decompressed size of an LZ4 frame, by reading its headers. */
export function decompressBound(src: Uint8Array): number {
  let s = 0;
  if (readU32(src, s) !== MAGIC) throw new Error('lz4-lite: invalid magic number');
  s += 4;

  const flg = src[s++];
  if ((flg & FLG_VERSION_MASK) !== FLG_VERSION) {
    throw new Error('lz4-lite: unsupported frame version');
  }
  const bsId = (src[s++] >> BD_BLOCK_MAX_SHIFT) & BD_BLOCK_MAX_MASK;
  const maxBlockSize = BLOCK_MAX_SIZE_ID[bsId];
  if (maxBlockSize === undefined) throw new Error('lz4-lite: invalid block maximum size');

  const hasContentSize = (flg & FLG_CONTENT_SIZE) !== 0;
  const hasBlockChecksum = (flg & FLG_BLOCK_CHECKSUM) !== 0;
  const hasDictId = (flg & FLG_DICT_ID) !== 0;

  if (hasContentSize) {
    return readU64(src, s); // content size sits before the optional dictID
  }
  if (hasDictId) s += 4;
  s += 1; // header checksum

  let size = 0;
  for (;;) {
    if (s + 4 > src.length) break;
    const blockSize = readU32(src, s);
    s += 4;
    if (blockSize === 0) break;
    const payloadLen = blockSize & 0x7fffffff;
    if (s + payloadLen > src.length) throw new Error('lz4-lite: truncated frame');
    if ((blockSize & BLOCK_UNCOMPRESSED_FLAG) !== 0) {
      size += payloadLen;
    } else {
      // A compressed block decodes to at most maxBlockSize (conformant) and at
      // most ~255x its payload — the latter keeps the bound proportional to input
      // so crafted headers can't inflate it into a huge allocation.
      size += Math.min(maxBlockSize, payloadLen * MAX_BLOCK_EXPANSION);
    }
    s += payloadLen + (hasBlockChecksum ? 4 : 0);
  }
  return size;
}

/** Compress `src` to a complete LZ4 frame (perfectly sized). */
export function compress(src: Uint8Array): Uint8Array {
  const dst = new Uint8Array(frameBound(src.length));
  const n = compressFrameInto(src, dst);
  return dst.slice(0, n);
}

/** Decompress a complete LZ4 frame. `maxSize` is an optional output-size hint. */
export function decompress(src: Uint8Array, maxSize?: number): Uint8Array {
  const size = maxSize === undefined ? decompressBound(src) : maxSize;
  const dst = makeBuffer(size);
  const n = decompressFrameInto(src, dst);
  return n === size ? dst : dst.subarray(0, n);
}

export { HEADER_SIZE };
