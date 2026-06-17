// LZ4 block codec (clean-room, from the LZ4 block format spec).
//
// The matcher honours MFLIMIT (12) and LAST_LITERALS (5): no match starts within
// the last 12 bytes and the final 5 bytes are always literals, so output decodes
// in strict LZ4 decoders. The encoder always emits a valid block (literals-only
// when nothing matches) for any non-empty input.

import {
  HASH_LOG,
  HASH_MULTIPLIER,
  LAST_LITERALS,
  MAX_OFFSET,
  MFLIMIT,
  MIN_MATCH,
  ML_MASK,
  RUN_MASK,
  RUN_SHIFT,
  SKIP_TRIGGER,
} from './constants.js';

/** Worst-case compressed size for `n` input bytes (LZ4_COMPRESSBOUND). */
export function compressBound(n: number): number {
  return n + ((n / 255) | 0) + 16;
}

function hash4(seq: number): number {
  return Math.imul(seq, HASH_MULTIPLIER) >>> (32 - HASH_LOG);
}

// Bulk copy has fixed per-call overhead, so it only beats a byte loop on longer
// runs. Short runs go byte-by-byte; long runs use the bulk path.
const BULK_LITERAL_MIN = 64;
const BULK_MATCH_MIN = 16;

// Copy `len` bytes src[from..] -> dst[d..]. Returns the new write offset.
function copyBytes(dst: Uint8Array, d: number, src: Uint8Array, from: number, len: number): number {
  if (len >= BULK_LITERAL_MIN) {
    dst.set(src.subarray(from, from + len), d);
    return d + len;
  }
  for (let i = 0; i < len; i++) dst[d + i] = src[from + i];
  return d + len;
}

function read32(b: Uint8Array, i: number): number {
  // Signed int32 is fine here: used only for equality compares and Math.imul
  // hashing, both of which are bit-exact regardless of sign.
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
}

// Reusable, zeroed match table — avoids a 256 KB allocation per call (which
// dominates small-input compression). Safe under JS's single-threaded,
// run-to-completion model; Worker threads get their own module instance.
let scratchTable: Uint32Array | null = null;
function clearedTable(): Uint32Array {
  if (scratchTable === null) scratchTable = new Uint32Array(1 << HASH_LOG);
  else scratchTable.fill(0);
  return scratchTable;
}

/**
 * Compress `src[sStart .. sStart+sLength)` as a single LZ4 block into `dst` at
 * `dIndex`. `hashTable` (a zeroed Uint32Array of size 1<<HASH_LOG) holds
 * position+1 (0 = empty); positions are absolute, and matches are constrained to
 * the current block so blocks stay independent even if the table is reused.
 * Returns the new `dIndex` (bytes-written = return - initial dIndex).
 */
export function compressBlockInto(
  src: Uint8Array,
  sStart: number,
  sLength: number,
  dst: Uint8Array,
  dIndex: number,
  hashTable: Uint32Array,
): number {
  const sEnd = sStart + sLength;
  const mflimit = sEnd - MFLIMIT; // matches may only start before here
  const matchlimit = sEnd - LAST_LITERALS; // match extension stops here
  // View over src for single-op 32-bit reads during match extension; indices
  // are relative to src (the view spans src.byteOffset .. +byteLength).
  const sv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let anchor = sStart; // start of the pending literal run
  let s = sStart;
  let searchMatchNb = 1 << SKIP_TRIGGER; // accelerated-skip counter

  while (s < mflimit) {
    const seq = read32(src, s);
    const h = hash4(seq);
    const cand = hashTable[h] - 1;
    hashTable[h] = s + 1;

    if (cand < sStart || s - cand > MAX_OFFSET || read32(src, cand) !== seq) {
      // No usable match — skip ahead, accelerating over incompressible data.
      s += searchMatchNb++ >> SKIP_TRIGGER;
      continue;
    }

    searchMatchNb = 1 << SKIP_TRIGGER;
    const offset = s - cand;

    // Extend the match forward (bounded by matchlimit = LAST_LITERALS rule).
    // Word-at-a-time via a single DataView read per side; on a mismatch the
    // lowest set bit of the XOR marks the first differing byte (LZ4 is
    // little-endian, so the lowest byte is the earliest). Within 4 bytes of
    // matchlimit, finish byte-by-byte.
    let mEnd = s + MIN_MATCH;
    let ref = cand + MIN_MATCH;
    for (;;) {
      if (mEnd + 4 <= matchlimit) {
        const diff = sv.getUint32(mEnd, true) ^ sv.getUint32(ref, true);
        if (diff === 0) {
          mEnd += 4;
          ref += 4;
          continue;
        }
        mEnd += (31 - Math.clz32(diff & -diff)) >> 3;
        break;
      }
      while (mEnd < matchlimit && src[mEnd] === src[ref]) {
        mEnd++;
        ref++;
      }
      break;
    }

    dIndex = emitSequence(dst, dIndex, src, anchor, s - anchor, offset, mEnd - s - MIN_MATCH);
    s = mEnd;
    anchor = s;
  }

  return emitLastLiterals(dst, dIndex, src, anchor, sEnd - anchor);
}

/** Write one sequence: token, literal-length ext, literals, offset, match-length ext. */
function emitSequence(
  dst: Uint8Array,
  d: number,
  src: Uint8Array,
  anchor: number,
  litLen: number,
  offset: number,
  mlCode: number, // matchLen - MIN_MATCH
): number {
  const tokenPos = d++;
  let token: number;

  if (litLen >= RUN_MASK) {
    token = RUN_MASK << RUN_SHIFT;
    let r = litLen - RUN_MASK;
    while (r >= 255) {
      dst[d++] = 255;
      r -= 255;
    }
    dst[d++] = r;
  } else {
    token = litLen << RUN_SHIFT;
  }

  d = copyBytes(dst, d, src, anchor, litLen);

  dst[d++] = offset & 0xff;
  dst[d++] = (offset >>> 8) & 0xff;

  if (mlCode >= ML_MASK) {
    token |= ML_MASK;
    let r = mlCode - ML_MASK;
    while (r >= 255) {
      dst[d++] = 255;
      r -= 255;
    }
    dst[d++] = r;
  } else {
    token |= mlCode;
  }

  dst[tokenPos] = token;
  return d;
}

/** Write the final literals-only sequence (no match follows). */
function emitLastLiterals(
  dst: Uint8Array,
  d: number,
  src: Uint8Array,
  anchor: number,
  litLen: number,
): number {
  const tokenPos = d++;
  if (litLen >= RUN_MASK) {
    dst[tokenPos] = RUN_MASK << RUN_SHIFT;
    let r = litLen - RUN_MASK;
    while (r >= 255) {
      dst[d++] = 255;
      r -= 255;
    }
    dst[d++] = r;
  } else {
    dst[tokenPos] = litLen << RUN_SHIFT;
  }
  return copyBytes(dst, d, src, anchor, litLen);
}

/**
 * Decompress a single LZ4 block `src[sStart .. sStart+sLength)` into `dst` at
 * `dIndex`. Returns the new `dIndex`. Throws on a malformed block rather than
 * reading/writing out of range.
 */
export function decompressBlockInto(
  src: Uint8Array,
  sStart: number,
  sLength: number,
  dst: Uint8Array,
  dIndex: number,
): number {
  let s = sStart;
  const sEnd = sStart + sLength;
  // Views for single-op 32-bit copies; indices are relative to each buffer's
  // start (the views span byteOffset .. +byteLength of src / dst respectively).
  const sv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const dv = new DataView(dst.buffer, dst.byteOffset, dst.byteLength);

  while (s < sEnd) {
    const token = src[s++];

    // Literals.
    let litLen = token >>> 4;
    if (litLen === RUN_MASK) {
      let b: number;
      do {
        if (s >= sEnd) throw new Error('lz4-lite: truncated literal length');
        b = src[s++];
        litLen += b;
      } while (b === 255);
    }
    if (litLen > 0) {
      const e = s + litLen;
      if (e > sEnd) throw new Error('lz4-lite: literal run exceeds block');
      // Literals never overlap the output, so copy 4 bytes per step (one
      // DataView op) and finish the remaining 1-3 bytes byte-by-byte.
      while (s + 4 <= e) {
        dv.setUint32(dIndex, sv.getUint32(s, true), true);
        dIndex += 4;
        s += 4;
      }
      while (s < e) dst[dIndex++] = src[s++];
    }

    if (s >= sEnd) break; // final sequence is literals only

    // Match offset (16-bit LE).
    const offset = src[s++] | (src[s++] << 8);
    let mlCode = token & ML_MASK;
    if (mlCode === ML_MASK) {
      let b: number;
      do {
        if (s >= sEnd) throw new Error('lz4-lite: truncated match length');
        b = src[s++];
        mlCode += b;
      } while (b === 255);
    }
    const matchLen = mlCode + MIN_MATCH;

    const from = dIndex - offset;
    if (offset === 0 || from < 0) throw new Error('lz4-lite: invalid match offset');

    if (offset === 1) {
      // RLE: repeat the previous byte.
      const end = dIndex + matchLen;
      dst.fill(dst[dIndex - 1], dIndex, end);
      dIndex = end;
    } else if (matchLen < BULK_MATCH_MIN) {
      // Short match: avoid copyWithin's per-call overhead. When offset >= 4 each
      // 4-byte read trails the write by >= 4 bytes, so its source is already
      // written even on overlap — copy a word at a time. offset 2-3 overlaps
      // within a word, so it stays byte-by-byte.
      const end = dIndex + matchLen;
      let f = from;
      if (offset >= 4) {
        while (dIndex + 4 <= end) {
          dv.setUint32(dIndex, dv.getUint32(f, true), true);
          dIndex += 4;
          f += 4;
        }
      }
      while (dIndex < end) dst[dIndex++] = dst[f++];
    } else {
      // Long match: copy a growing span with copyWithin. Each step copies only
      // already-written bytes (chunk <= dIndex - from), so it stays correct when
      // overlapping; the span doubles, so an N-byte match takes ~log2(N) copies.
      let remaining = matchLen;
      while (remaining > 0) {
        const span = dIndex - from;
        const chunk = remaining < span ? remaining : span;
        dst.copyWithin(dIndex, from, from + chunk);
        dIndex += chunk;
        remaining -= chunk;
      }
    }
  }

  return dIndex;
}

/** Ergonomic: compress `src` into a freshly allocated raw block. */
export function compressBlock(src: Uint8Array): Uint8Array {
  const dst = new Uint8Array(compressBound(src.length));
  const n = compressBlockInto(src, 0, src.length, dst, 0, clearedTable());
  return dst.slice(0, n);
}

/** Internal: a cleared, reusable match table for the frame codec. */
export { clearedTable as scratchHashTable };

/** Ergonomic: decompress a raw block into `expectedSize` bytes. */
export function decompressBlock(block: Uint8Array, expectedSize: number): Uint8Array {
  const dst = new Uint8Array(expectedSize);
  const n = decompressBlockInto(block, 0, block.length, dst, 0);
  return n === expectedSize ? dst : dst.subarray(0, n);
}
