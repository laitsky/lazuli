const WIDTH = 1200;
const HEIGHT = 630;

type Rgb = readonly [number, number, number];

const FONT: Record<string, readonly string[]> = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '%': ['11001', '11010', '00100', '01000', '10110', '00110', '00000'],
  $: ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
};

export interface MarketOgImageInput {
  symbol: string;
  exchange: string;
  price: number | null;
  changePercent: number | null;
  generatedAt?: number;
}

/** Render a deterministic 1200×630 PNG using an embedded local bitmap font. */
export async function renderMarketOgPng(input: MarketOgImageInput): Promise<Uint8Array> {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const glow = Math.max(0, 1 - Math.hypot(x - 990, y - 70) / 620);
      setPixel(pixels, x, y, [
        10 + Math.round(glow * 8),
        15 + Math.round(glow * 18),
        25 + Math.round(glow * 24),
      ]);
    }
  }
  fillRect(pixels, 64, 58, 14, 514, [45, 212, 191]);
  fillRect(pixels, 80, 58, 3, 514, [30, 70, 77]);
  drawText(pixels, 'LAZULI MARKET INTELLIGENCE', 120, 82, 5, [120, 232, 219]);
  drawText(pixels, `${input.symbol} / ${input.exchange}`, 120, 190, 11, [238, 244, 249]);
  drawText(
    pixels,
    input.price === null ? 'PRICE UNAVAILABLE' : `$${formatPrice(input.price)}`,
    120,
    330,
    8,
    [238, 244, 249]
  );
  const change = input.changePercent;
  const changeText =
    change === null ? '24H --' : `24H ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
  drawText(
    pixels,
    changeText,
    120,
    440,
    5,
    change !== null && change < 0 ? [248, 113, 113] : [74, 222, 128]
  );
  drawText(pixels, 'LIVE DATA - TRANSPARENT MODELS - FREE', 120, 535, 3, [148, 163, 184]);
  return encodePng(pixels, WIDTH, HEIGHT);
}

function formatPrice(value: number): string {
  if (value >= 1_000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(2);
  return value.toPrecision(5);
}

function drawText(
  pixels: Uint8Array,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: Rgb
): void {
  let cursor = x;
  for (const character of text.toUpperCase()) {
    const glyph = FONT[character] ?? FONT[' ']!;
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        if (glyph[row]?.[column] === '1') {
          fillRect(pixels, cursor + column * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    cursor += scale * 6;
    if (cursor > WIDTH - 70) break;
  }
}

function fillRect(
  pixels: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Rgb
): void {
  for (let py = y; py < Math.min(HEIGHT, y + height); py += 1) {
    for (let px = x; px < Math.min(WIDTH, x + width); px += 1) setPixel(pixels, px, py, color);
  }
}

function setPixel(pixels: Uint8Array, x: number, y: number, [red, green, blue]: Rgb): void {
  const offset = (y * WIDTH + x) * 4;
  pixels[offset] = red;
  pixels[offset + 1] = green;
  pixels[offset + 2] = blue;
  pixels[offset + 3] = 255;
}

async function encodePng(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const scanlines = new Uint8Array(height * (width * 4 + 1));
  for (let row = 0; row < height; row += 1) {
    const target = row * (width * 4 + 1);
    scanlines[target] = 0;
    scanlines.set(rgba.subarray(row * width * 4, (row + 1) * width * 4), target + 1);
  }
  const compressed = new Uint8Array(
    await new Response(
      new Blob([scanlines]).stream().pipeThrough(new CompressionStream('deflate'))
    ).arrayBuffer()
  );
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  return concat(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array())
  );
}

function chunk(name: string, data: Uint8Array): Uint8Array {
  const type = new TextEncoder().encode(name);
  const output = new Uint8Array(12 + data.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length);
  output.set(type, 4);
  output.set(data, 8);
  view.setUint32(8 + data.length, crc32(concat(type, data)));
  return output;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
