#!/usr/bin/env node
/** Measure fixed standing bounds from existing atlases; never resample or edit art. */
import sharp from 'sharp';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  const name = args[index], value = args[index + 1];
  if (!['--assets', '--output'].includes(name) || !value || value.startsWith('--')) {
    throw new Error('Usage: node tools/measure_defense_bounds.mjs [--assets PATH] [--output PATH]');
  }
  options.set(name, value);
}
const assets = resolve(options.get('--assets') ?? resolve(root, 'game/cat-defense/assets'));
const output = resolve(options.get('--output') ?? resolve(root, 'game/cat-defense/actor-bounds.js'));
const manifest = JSON.parse(await readFile(resolve(assets, 'manifest.json'), 'utf8'));
const bounds = new Map();
const alphaThreshold = 24;
const lexical = ([left], [right]) => left < right ? -1 : left > right ? 1 : 0;

for (const [group, clipName] of [['cats', 'idle'], ['enemies', 'walk']]) {
  for (const [id, actor] of Object.entries(manifest[group] ?? {}).sort(lexical)) {
    const clip = actor.clips?.[clipName];
    if (!clip?.frames?.length) throw new Error(`${id}: missing ${clipName} frames.`);
    const width = actor.frameWidth, height = actor.frameHeight;
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new Error(`${id}: invalid actor frame dimensions.`);
    }
    const imagePath = clip.image ?? actor.image;
    if (typeof imagePath !== 'string') throw new Error(`${id}: missing atlas path.`);
    const {data, info} = await sharp(resolve(assets, imagePath)).ensureAlpha().raw()
      .toBuffer({resolveWithObject: true});
    let left = width, top = height, right = -1, bottom = -1;
    for (const frame of clip.frames) {
      if (![frame.x, frame.y, frame.w, frame.h].every(Number.isInteger)
        || frame.x < 0 || frame.y < 0 || frame.w !== width || frame.h !== height
        || frame.x + width > info.width || frame.y + height > info.height) {
        throw new Error(`${id}: frame rectangle does not fit its atlas or fixed actor camera.`);
      }
      for (let y = 0; y < height; y++) {
        const row = ((frame.y + y) * info.width + frame.x) * info.channels;
        for (let x = 0; x < width; x++) {
          if (data[row + x * info.channels + info.channels - 1] < alphaThreshold) continue;
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
    }
    if (right < left || bottom < top) throw new Error(`${id}: all ${clipName} frames are transparent.`);
    bounds.set(id, {x: left / width, y: top / height,
      w: (right - left + 1) / width, h: (bottom - top + 1) / height});
  }
}
if (!bounds.size) throw new Error('No cat or enemy actors found in the asset manifest.');
const number = value => String(Number(value.toFixed(8)));
const lines = [...bounds].map(([id, box]) => `${JSON.stringify(id)}: Object.freeze({${Object.entries(box)
  .map(([key, value]) => `${key}:${number(value)}`).join(',')}})`);
// One deterministic line per actor, including the opening and closing declaration.
const source = `export const ACTOR_BOUNDS = Object.freeze({${lines.join(',\n  ')}});\n`;
await mkdir(dirname(output), {recursive: true});
await writeFile(output, source);
console.log(`Measured ${bounds.size} actors at alpha >= ${alphaThreshold}: ${output}`);
