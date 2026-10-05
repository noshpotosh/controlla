import { open } from 'node:fs/promises';

/** Read the GameCube filesystem through CISO's sparse block table. */
export async function inspectDoubleDash(path) {
  const file = await open(path, 'r');
  try {
    const stats = await file.stat();
    const header = Buffer.alloc(0x8000);
    if ((await file.read(header, 0, header.length, 0)).bytesRead !== header.length || header.toString('ascii', 0, 4) !== 'CISO')
      throw new Error('Expected a GameCube CISO image.');
    const blockSize = header.readUInt32LE(4);
    if (blockSize < 2048 || blockSize > 32 * 1024 * 1024 || (blockSize & (blockSize - 1)))
      throw new Error('Invalid CISO block size.');
    const offsets = [];
    let physical = header.length;
    for (const present of header.subarray(8)) {
      if (present !== 0 && present !== 1) throw new Error('Invalid CISO block map.');
      offsets.push(present ? physical : null);
      if (present) physical += blockSize;
    }
    if (physical > stats.size) throw new Error('CISO payload is truncated relative to its block map.');
    async function read(offset, size) {
      if (offset < 0 || size < 0 || offset + size > offsets.length * blockSize)
        throw new Error('Disc read outside CISO address space.');
      const bytes = Buffer.alloc(size);
      let written = 0;
      while (written < size) {
        const address = offset + written;
        const index = Math.floor(address / blockSize);
        const within = address % blockSize;
        const count = Math.min(size - written, blockSize - within);
        if (offsets[index] !== null && (await file.read(bytes, written, count, offsets[index] + within)).bytesRead !== count)
          throw new Error('Truncated disc block.');
        written += count;
      }
      return bytes;
    }
    const disc = await read(0, 0x440);
    if (disc.toString('ascii', 0, 6) !== 'GM4E01' || disc.readUInt32BE(0x1c) !== 0xc2339f3d)
      throw new Error('Expected the US Mario Kart: Double Dash!! GameCube disc (GM4E01).');
    const fstOffset = disc.readUInt32BE(0x424);
    const fstSize = disc.readUInt32BE(0x428);
    if (fstSize < 12 || fstSize > 16 * 1024 * 1024) throw new Error('Invalid disc filesystem size.');
    const fst = await read(fstOffset, fstSize);
    const count = fst.readUInt32BE(8);
    if (fst[0] !== 1 || count < 1 || count * 12 > fst.length) throw new Error('Invalid disc filesystem table.');
    const files = [];
    const directories = [{ path: '', end: count }];
    for (let index = 1; index < count; index++) {
      while (index >= directories.at(-1).end) directories.pop();
      const entry = index * 12;
      const nameOffset = count * 12 + (fst.readUInt32BE(entry) & 0xffffff);
      const end = fst.indexOf(0, nameOffset);
      if (nameOffset >= fst.length || end === -1) throw new Error('Invalid filesystem name.');
      const name = fst.toString('utf8', nameOffset, end);
      if (!name || name.includes('/') || name === '..') throw new Error('Invalid filesystem path.');
      const path = directories.at(-1).path + name;
      const offset = fst.readUInt32BE(entry + 4);
      const size = fst.readUInt32BE(entry + 8);
      if (fst[entry] === 1) {
        if (size <= index || size > directories.at(-1).end) throw new Error('Invalid directory extent.');
        directories.push({ path: path + '/', end: size });
      } else if (fst[entry] === 0) {
        if (offset + size > offsets.length * blockSize) throw new Error('Invalid file extent.');
        files.push({ path, offset, size });
      } else throw new Error('Invalid filesystem entry type.');
    }
    return { gameId: 'GM4E01', title: disc.toString('ascii', 0x20, 0x400).split('\0')[0], imageBytes: stats.size, trailingBytes: stats.size - physical, blockSize, files };
  } finally { await file.close(); }
}
