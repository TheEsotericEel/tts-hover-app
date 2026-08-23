import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Minimal pure-JS PNG generator to create clean solid icons without external dependencies
function createPNG(width, height, drawFn) {
  // Uncompressed raw image buffer: RGBA
  const buffer = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = drawFn(x / width, y / height, x, y);
      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
      buffer[idx + 3] = a;
    }
  }

  // PNG Filter type 0 (None) per scanline
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const scanOffset = y * (1 + width * 4);
    scanlines[scanOffset] = 0; // Filter: None
    buffer.copy(scanlines, scanOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const idatData = zlib.deflateSync(scanlines);

  // PNG Signature
  const pngSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const full = Buffer.concat([typeBuf, data]);
    const crc = crc32(full);
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) {
        c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', idatData);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([pngSig, ihdrChunk, idatChunk, iendChunk]);
}

function drawIcon(u, v) {
  // Vibrant indigo/cyan gradient icon with sound wave motif
  const cx = u - 0.5;
  const cy = v - 0.5;
  const dist = Math.sqrt(cx * cx + cy * cy);
  
  // Rounded squircle background
  if (dist > 0.48) {
    return [0, 0, 0, 0];
  }
  
  // Gradient background: Deep Indigo (#4f46e5) to Violet (#7c3aed)
  let r = Math.floor(79 + u * 45);
  let g = Math.floor(70 + v * 30);
  let b = Math.floor(229 + (1 - u) * 20);
  let a = 255;

  // Simple speaker shape in white
  // Speaker body
  const inSpeakerBody = (u >= 0.28 && u <= 0.42 && v >= 0.38 && v <= 0.62);
  // Speaker cone
  const inSpeakerCone = (u >= 0.40 && u <= 0.58 && Math.abs(v - 0.5) <= (u - 0.35) * 0.9);
  
  // Sound waves
  const waveDist = Math.sqrt((u - 0.45) * (u - 0.45) + (cy * cy));
  const inWave1 = (waveDist >= 0.20 && waveDist <= 0.25 && u > 0.55 && Math.abs(cy) < 0.25);
  const inWave2 = (waveDist >= 0.30 && waveDist <= 0.35 && u > 0.60 && Math.abs(cy) < 0.32);

  if (inSpeakerBody || inSpeakerCone || inWave1 || inWave2) {
    return [255, 255, 255, 255];
  }

  return [r, g, b, a];
}

const iconsDir = resolve(__dirname, '../extension/icons');
mkdirSync(iconsDir, { recursive: true });

[16, 48, 128].forEach(size => {
  const pngBuf = createPNG(size, size, drawIcon);
  writeFileSync(resolve(iconsDir, `icon-${size}.png`), pngBuf);
  console.log(`Generated icon-${size}.png (${size}x${size})`);
});
