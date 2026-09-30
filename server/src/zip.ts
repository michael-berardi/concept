import { deflateRawSync, inflateRawSync, inflateSync } from "node:zlib";

/**
 * Minimal ZIP reader/writer (deflate + store). Pure Node — no native addons,
 * no external dependencies. Enough for vault export/import.
 */

export interface ZipEntry {
  path: string;
  data: Buffer;
}

interface CentralEntry {
  nameBytes: Buffer;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  method: number;
  crc32: number;
}

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Create a zip archive from entries. Paths use '/' separators. */
export function createZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path.replace(/^\/+/, ""), "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const method = 8;
    const compressed = deflateRawSync(data, { level: 6 });
    // (deflate always; small payloads would only be marginally larger stored)
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (1980-01-01+)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, compressed);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4); // version made by
    cen.writeUInt16LE(20, 6); // version needed
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(compressed.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, end]);
}

/** Read all file entries from a zip archive. Directory entries are skipped. */
export function readZip(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  if (!eocd) throw new Error("Not a zip archive (no end-of-central-directory record)");
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error("Corrupt zip (bad central directory)");
    const method = buf.readUInt16LE(ptr + 10);
    const crcExpected = buf.readUInt32LE(ptr + 16);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const nameBytes = buf.subarray(ptr + 46, ptr + 46 + nameLen);
    const name = nameBytes.toString("utf8");
    ptr += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // directory entry
    if (name.startsWith("__MACOSX/") || name.split("/").pop() === ".DS_Store") continue;

    // local header
    const lho = localOffset;
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error(`Corrupt zip (bad local header for ${name})`);
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`Unsupported zip compression method ${method} for ${name}`);
    if (uncompressedSize && data.length !== uncompressedSize) {
      data = data.subarray(0, uncompressedSize);
    }
    if (crcExpected && crc32(data) !== crcExpected) {
      throw new Error(`Corrupt zip (crc mismatch for ${name})`);
    }
    out.push({ path: name, data });
  }
  return out;
}

function findEocd(buf: Buffer): number | null {
  const min = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return null;
}

/** For deflate method 8 raw streams that may have been stored. */
export function inflateAny(raw: Buffer): Buffer {
  try {
    return inflateRawSync(raw);
  } catch {
    return inflateSync(raw);
  }
}
