/**
 * A minimal ZIP writer, enough for KMZ (and any other "zipped folder of files"
 * export we add later).
 *
 * Compression comes from the platform's own CompressionStream rather than from
 * an archive library: a KML full of repeated XML tags shrinks by an order of
 * magnitude, which is the entire reason to prefer KMZ over KML. Where that API
 * is missing the entry is stored uncompressed instead — every ZIP reader
 * supports both methods, so the file is still valid, only larger.
 */

export type ZipEntry = { name: string; data: Uint8Array };

const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

type PreparedEntry = { name: Uint8Array; payload: Uint8Array; crc: number; size: number; method: number };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export const crc32 = (data: Uint8Array) => {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** ZIP stores timestamps in the 1980-epoch MS-DOS packed format. */
const dosDateTime = (date: Date) => {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
};

/** Raw DEFLATE, or null where the platform has no CompressionStream. */
export const deflateRaw = async (data: Uint8Array): Promise<Uint8Array | null> => {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([data.buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
};

const writeZip = (prepared: PreparedEntry[], date: Date): Uint8Array => {
  const { time, date: dosDate } = dosDateTime(date);

  const localSize = prepared.reduce((total, entry) => total + 30 + entry.name.length + entry.payload.length, 0);
  const centralSize = prepared.reduce((total, entry) => total + 46 + entry.name.length, 0);
  const buffer = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(buffer.buffer);

  let offset = 0;
  const writeU16 = (value: number) => {
    view.setUint16(offset, value, true);
    offset += 2;
  };
  const writeU32 = (value: number) => {
    view.setUint32(offset, value >>> 0, true);
    offset += 4;
  };
  const writeBytes = (bytes: Uint8Array) => {
    buffer.set(bytes, offset);
    offset += bytes.length;
  };

  const localOffsets: number[] = [];
  for (const entry of prepared) {
    localOffsets.push(offset);
    writeU32(0x04034b50); // local file header
    writeU16(20); // version needed
    writeU16(0); // flags
    writeU16(entry.method);
    writeU16(time);
    writeU16(dosDate);
    writeU32(entry.crc);
    writeU32(entry.payload.length); // compressed size
    writeU32(entry.size); // uncompressed size
    writeU16(entry.name.length);
    writeU16(0); // extra field length
    writeBytes(entry.name);
    writeBytes(entry.payload);
  }

  const centralStart = offset;
  prepared.forEach((entry, index) => {
    writeU32(0x02014b50); // central directory header
    writeU16(20); // version made by
    writeU16(20); // version needed
    writeU16(0); // flags
    writeU16(entry.method);
    writeU16(time);
    writeU16(dosDate);
    writeU32(entry.crc);
    writeU32(entry.payload.length);
    writeU32(entry.size);
    writeU16(entry.name.length);
    writeU16(0); // extra
    writeU16(0); // comment
    writeU16(0); // disk number
    writeU16(0); // internal attributes
    writeU32(0); // external attributes
    writeU32(localOffsets[index]);
    writeBytes(entry.name);
  });

  writeU32(0x06054b50); // end of central directory
  writeU16(0); // this disk
  writeU16(0); // disk with central directory
  writeU16(prepared.length);
  writeU16(prepared.length);
  writeU32(offset - centralStart);
  writeU32(centralStart);
  writeU16(0); // comment length

  return buffer;
};

const encodeName = (name: string) => new TextEncoder().encode(name);

/** Uncompressed archive. Synchronous, and valid for every reader. */
export const createZipArchive = (entries: ZipEntry[], date = new Date()): Uint8Array =>
  writeZip(
    entries.map((entry) => ({
      name: encodeName(entry.name),
      payload: entry.data,
      crc: crc32(entry.data),
      size: entry.data.length,
      method: METHOD_STORED,
    })),
    date,
  );

/**
 * Deflated where the platform allows it, stored where it does not. The CRC and
 * uncompressed size always describe the original bytes, which is what a reader
 * checks after inflating.
 */
export const createCompressedZipArchive = async (entries: ZipEntry[], date = new Date()): Promise<Uint8Array> => {
  const prepared = await Promise.all(
    entries.map(async (entry) => {
      const deflated = await deflateRaw(entry.data);
      const useDeflate = deflated !== null && deflated.length < entry.data.length;
      return {
        name: encodeName(entry.name),
        payload: useDeflate ? deflated! : entry.data,
        crc: crc32(entry.data),
        size: entry.data.length,
        method: useDeflate ? METHOD_DEFLATED : METHOD_STORED,
      };
    }),
  );
  return writeZip(prepared, date);
};
