// LZ4 format constants (block + frame). Values come from the published LZ4
// block/frame format specifications.

// --- Block format ---
export const MIN_MATCH = 4; // shortest encodable match
export const LAST_LITERALS = 5; // the final 5 bytes of a block are always literals
export const MFLIMIT = 12; // the last match must start >= 12 bytes before block end
export const MAX_OFFSET = 0xffff; // back-reference distance is a 16-bit field

// Token nibbles: high = literal run length, low = match length (minus MIN_MATCH).
export const ML_BITS = 4;
export const ML_MASK = (1 << ML_BITS) - 1; // 15
export const RUN_MASK = (1 << ML_BITS) - 1; // 15
export const RUN_SHIFT = 4;

// Matcher hashing.
export const HASH_LOG = 16; // 64K-entry table
export const HASH_SIZE = 1 << HASH_LOG;
export const HASH_MULTIPLIER = 2654435761; // Knuth multiplicative (LZ4 hash4)
export const SKIP_TRIGGER = 6; // controls accelerated skipping over incompressible data

// --- Frame format ---
export const MAGIC = 0x184d2204;

// FLG byte: bits 7-6 version (01), bit 5 block-independence, bit 4 block checksum,
// bit 3 content size, bit 2 content checksum, bit 0 dictID.
export const FLG_VERSION = 0x40;
export const FLG_VERSION_MASK = 0xc0;
export const FLG_BLOCK_INDEP = 0x20;
export const FLG_BLOCK_CHECKSUM = 0x10;
export const FLG_CONTENT_SIZE = 0x08;
export const FLG_CONTENT_CHECKSUM = 0x04;
export const FLG_DICT_ID = 0x01; // bit 0: a 4-byte dictionary ID follows the header fields

// Worst-case expansion of a compressed block: it decodes to at most ~255x its
// payload (a long match costs ~1 input byte per 255 output bytes; literals
// expand 1:1; multiple sequences are strictly less dense). Used to keep
// `decompressBound` proportional to input on crafted/garbage headers, while
// never under-estimating a conformant block's decoded size.
export const MAX_BLOCK_EXPANSION = 255;

// Block descriptor: bits 6-4 select the maximum block size.
export const BD_BLOCK_MAX_SHIFT = 4;
export const BD_BLOCK_MAX_MASK = 0x07;
export const BLOCK_MAX_SIZE_ID: Record<number, number> = {
  4: 64 * 1024,
  5: 256 * 1024,
  6: 1024 * 1024,
  7: 4 * 1024 * 1024,
};

// What we emit: version 01 + independent blocks, 4 MiB max block size.
export const DEFAULT_BLOCK_SIZE_ID = 7;
export const DEFAULT_BLOCK_SIZE = BLOCK_MAX_SIZE_ID[DEFAULT_BLOCK_SIZE_ID];
export const FLG_WRITE = FLG_VERSION | FLG_BLOCK_INDEP; // 0x60
export const BD_WRITE = DEFAULT_BLOCK_SIZE_ID << BD_BLOCK_MAX_SHIFT; // 0x70

// High bit of a block size word marks a stored (uncompressed) block.
export const BLOCK_UNCOMPRESSED_FLAG = 0x80000000;
