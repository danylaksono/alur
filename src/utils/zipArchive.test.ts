import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { createCompressedZipArchive, createZipArchive, crc32 } from './zipArchive';

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

const readU16 = (data: Uint8Array, offset: number) => data[offset] | (data[offset + 1] << 8);
const readU32 = (data: Uint8Array, offset: number) =>
  (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;

/** Reads the archive the way any ZIP reader does: from the central directory. */
const readArchive = (archive: Uint8Array) => {
  const eocd = archive.length - 22;
  expect(readU32(archive, eocd)).toBe(0x06054b50);
  const count = readU16(archive, eocd + 10);
  let cursor = readU32(archive, eocd + 16);

  return Array.from({ length: count }, () => {
    expect(readU32(archive, cursor)).toBe(0x02014b50);
    const method = readU16(archive, cursor + 10);
    const crc = readU32(archive, cursor + 16);
    const compressedSize = readU32(archive, cursor + 20);
    const size = readU32(archive, cursor + 24);
    const nameLength = readU16(archive, cursor + 28);
    const localOffset = readU32(archive, cursor + 42);
    const name = text(archive.slice(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength;

    expect(readU32(archive, localOffset)).toBe(0x04034b50);
    // The local header must agree with the central directory, or readers that
    // trust either one disagree about where the next entry starts.
    expect(readU32(archive, localOffset + 18)).toBe(compressedSize);
    expect(readU32(archive, localOffset + 22)).toBe(size);
    const localNameLength = readU16(archive, localOffset + 26);
    const localExtraLength = readU16(archive, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    return { name, method, crc, size, data: archive.slice(dataStart, dataStart + compressedSize) };
  });
};

describe('crc32', () => {
  it('matches the reference checksum', () => {
    // "123456789" is the standard CRC-32 test vector.
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('createZipArchive', () => {
  it('writes an entry a ZIP reader can find and verify', () => {
    const kml = '<?xml version="1.0"?><kml />';
    const archive = createZipArchive([{ name: 'doc.kml', data: bytes(kml) }], new Date('2026-08-16T10:20:30Z'));
    const [entry] = readArchive(archive);

    expect(entry.name).toBe('doc.kml');
    expect(entry.method).toBe(0); // stored, not deflated
    expect(entry.crc).toBe(crc32(bytes(kml)));
    expect(text(entry.data)).toBe(kml);
  });

  it('keeps several entries addressable at their own offsets', () => {
    const archive = createZipArchive([
      { name: 'a.txt', data: bytes('name,geometry_wkt\nA,POINT (1 2)\n') },
      { name: 'nested/b.txt', data: bytes('second') },
    ]);
    const entries = readArchive(archive);

    expect(entries.map((entry) => entry.name)).toEqual(['a.txt', 'nested/b.txt']);
    expect(text(entries[0].data)).toContain('POINT (1 2)');
    expect(text(entries[1].data)).toBe('second');
  });

  it('produces a valid empty archive', () => {
    const archive = createZipArchive([]);

    expect(archive).toHaveLength(22);
    expect(readArchive(archive)).toEqual([]);
  });
});

describe('createCompressedZipArchive', () => {
  it('deflates repetitive content and still round-trips through a real inflater', async () => {
    const kml = '<Placemark><name>Site</name></Placemark>'.repeat(500);
    const archive = await createCompressedZipArchive([{ name: 'doc.kml', data: bytes(kml) }]);
    const [entry] = readArchive(archive);

    expect(entry.method).toBe(8); // deflated
    expect(archive.length).toBeLessThan(kml.length / 10);
    // The CRC and size fields must describe the *original* bytes.
    expect(entry.crc).toBe(crc32(bytes(kml)));
    expect(text(new Uint8Array(inflateRawSync(Buffer.from(entry.data))))).toBe(kml);
  });

  it('stores content that deflate cannot shrink', async () => {
    // Incompressible: 4 KB of distinct random bytes.
    const random = new Uint8Array(4096).map(() => Math.floor(Math.random() * 256));
    const [entry] = readArchive(await createCompressedZipArchive([{ name: 'noise.bin', data: random }]));

    expect(entry.method).toBe(0);
    expect(entry.data).toEqual(random);
  });
});
