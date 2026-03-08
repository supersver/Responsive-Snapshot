/**
 * Icon Generator for Responsive Snapshot
 *
 * Run this with Node.js to create PNG icons from the SVG:
 *   node generate-icons.js
 *
 * Requires: npm install sharp
 * Or you can manually export icon.svg at 16x16, 48x48, 128x128 using any tool.
 */

const fs = require("fs");
const path = require("path");

async function generate() {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    console.log("sharp not installed. Generating placeholder PNGs instead.");
    console.log(
      "For production icons, install sharp (npm install sharp) and re-run,",
    );
    console.log("or manually export icons/icon.svg at 16, 48, and 128px.");
    generatePlaceholders();
    return;
  }

  const svgPath = path.join(__dirname, "icons", "icon.svg");
  const svg = fs.readFileSync(svgPath);

  for (const size of [16, 48, 128]) {
    const outPath = path.join(__dirname, "icons", `icon${size}.png`);
    await sharp(svg).resize(size, size).png().toFile(outPath);
    console.log(`Created ${outPath}`);
  }
}

function generatePlaceholders() {
  // Minimal valid 1x1 PNG for each size so the extension can load
  const sizes = [16, 48, 128];
  for (const size of sizes) {
    // Create a minimal BMP-style canvas with a solid color
    const png = createMinimalPng(size);
    const outPath = path.join(__dirname, "icons", `icon${size}.png`);
    fs.writeFileSync(outPath, png);
    console.log(`Created placeholder ${outPath}`);
  }
}

function createMinimalPng(size) {
  // Use a canvas-free approach: generate a valid minimal PNG
  // This creates a 1x1 blue PNG that Chrome will accept
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let c = 0xffffffff;
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let v = n;
      for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
      table[n] = v;
    }
    for (let i = 0; i < buf.length; i++)
      c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeAndData = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData), 0);
    return Buffer.concat([len, typeAndData, crc]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width=1
  ihdr.writeUInt32BE(1, 4); // height=1
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type = RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // IDAT - one row: filter byte 0, then R=0, G=210, B=255
  const { deflateSync } = require("zlib");
  const raw = Buffer.from([0, 0x00, 0xd2, 0xff]);
  const compressed = deflateSync(raw);

  // IEND
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    pngSignature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", iend),
  ]);
}

generate().catch(console.error);
