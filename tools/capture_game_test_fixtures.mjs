#!/usr/bin/env node
/** Capture measured geometry for tests without committing runtime images or raw packs. */
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2), options = new Map();
let check = false;
for (let index = 0; index < args.length; index++) {
  const option = args[index];
  if (option === '--check') {check = true; continue;}
  if (!['--fishing', '--defense', '--output'].includes(option)
    || !args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error('Usage: node tools/capture_game_test_fixtures.mjs [--check] [--fishing PATH] [--defense PATH] [--output PATH]');
  }
  options.set(option, args[++index]);
}
const fishingRoot = resolve(options.get('--fishing') ?? resolve(root, 'dist'));
const defenseRoot = resolve(options.get('--defense') ?? resolve(root, 'game/cat-defense/assets'));
const output = resolve(options.get('--output') ?? resolve(root, 'tests/fixtures'));
const lexical = ([left], [right]) => left < right ? -1 : left > right ? 1 : 0;
const entries = value => Object.entries(value).sort(lexical);
const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value ?? {}, key))
  .map(key => [key, value[key]]));
const point = value => pick(value, ['x', 'y']);
async function readJson(path) {
  try {return JSON.parse(await readFile(path, 'utf8'));}
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Local measured asset metadata is required to capture/check fixtures: ${path}`);
    throw error;
  }
}

function fishingFrame(frame) {
  // Geometry, timing and the native paw transform are retained for every pose.
  // Atlas locations and image paths are unnecessary for these simulation tests.
  const result = pick(frame, ['durationMs', 'bounds', 'handTransform']);
  if (frame.anchors) result.anchors = Object.fromEntries(['feet', 'grip', 'head']
    .filter(name => frame.anchors[name]).map(name => [name, point(frame.anchors[name])]));
  // The rod follows the measured hand rotation; other articulated joints do not
  // participate in getGeometry(), actorEnvelope(), or the shoreline assertions.
  if (frame.arm) result.arm = pick(frame.arm, ['handAngle']);
  return result;
}
function fishingActor(manifest) {
  const result = pick(manifest, ['id', 'name', 'frameSize', 'anchorFacing', 'actor']);
  if (manifest.armRig) result.armRig = pick(manifest.armRig,
    ['id', 'type', 'assemblyScale', 'nativeScale', 'lengths', 'restHandAngle']);
  if (manifest.handLayer) result.handLayer = pick(manifest.handLayer,
    ['size', 'wrist', 'grip', 'overlayBounds']);
  result.animations = Object.fromEntries(entries(manifest.animations).map(([name, clip]) => [name,
    {...pick(clip, ['loop', 'fps']), frames: clip.frames.map(fishingFrame)}]));
  return result;
}
function fishingRod(manifest) {
  const result = pick(manifest, ['id', 'name', 'frameSize', 'prop']);
  result.animations = Object.fromEntries(entries(manifest.animations).map(([name, clip]) => [name,
    {...pick(clip, ['loop', 'fps']), frames: clip.frames.map(frame => pick(frame, ['durationMs', 'frame']))}]));
  return result;
}
function defenseActor(actor) {
  const result = pick(actor, ['id', 'label', 'kind', 'type', 'image', 'frameWidth',
    'frameHeight', 'anchor', 'muzzle', 'actionClip', 'facing']);
  result.clips = Object.fromEntries(entries(actor.clips).map(([name, clip]) => [name,
    {...pick(clip, ['image', 'fps', 'loop']), frames: clip.frames.map(frame => pick(frame, ['x', 'y', 'w', 'h', 'muzzle']))}]));
  return result;
}

const catalog = await readJson(resolve(fishingRoot, 'catalog.json'));
const catEntries = catalog.assets.filter(asset => asset.actor?.kind === 'cat')
  .sort((left, right) => lexical([left.id], [right.id]));
if (catEntries.length !== 17) throw new Error(`Expected 17 measured fishing cat variants, found ${catEntries.length}.`);
const assets = new Map(catalog.assets.map(asset => [asset.id, asset]));
async function fishingManifest(id) {
  const asset = assets.get(id);
  if (!asset) throw new Error(`The local fishing catalog is missing ${id}.`);
  const manifest = await readJson(resolve(fishingRoot, asset.manifest));
  if (manifest.id !== id) throw new Error(`Fishing manifest ID differs from its catalog: ${id}.`);
  return manifest;
}
const fishing = {format: 'measured-fishing-test-fixtures-v1', cats: {}, rods: {}, fish: {}};
for (const asset of catEntries) fishing.cats[asset.id] = fishingActor(await fishingManifest(asset.id));
for (let level = 1; level <= 5; level++) {
  const id = `fishingrod-lvl${level}`;
  fishing.rods[id] = fishingRod(await fishingManifest(id));
}
for (const id of ['cute-clownfish', 'cute-puffer', 'cute-shark', 'cute-tang']) {
  const manifest = await fishingManifest(id);
  fishing.fish[id] = pick(manifest, ['id', 'name', 'frameSize', 'aquarium']);
}
const sourceDefense = await readJson(resolve(defenseRoot, 'manifest.json'));
const defense = {format: 'measured-defense-test-fixtures-v1', cats: {}, enemies: {}};
for (const group of ['cats', 'enemies']) {
  for (const [id, actor] of entries(sourceDefense[group])) defense[group][id] = defenseActor(actor);
}
if (Object.keys(defense.cats).length !== 17 || Object.keys(defense.enemies).length !== 15) {
  throw new Error('Expected 17 measured defense cats and 15 native enemy variants.');
}
// Each actor occupies one compact line. This keeps authored floating-point values
// exact while avoiding a multi-megabyte pretty-printed copy of generated manifests.
function serialize(fixture) {
  return '{\n' + Object.entries(fixture).map(([key, value]) => {
    if (typeof value === 'string') return `  ${JSON.stringify(key)}:${JSON.stringify(value)}`;
    return `  ${JSON.stringify(key)}:{\n` + Object.entries(value)
      .map(([id, actor]) => `    ${JSON.stringify(id)}:${JSON.stringify(actor)}`).join(',\n') + '\n  }';
  }).join(',\n') + '\n}\n';
}
const files = new Map([['fishing-layout.json', serialize(fishing)], ['defense-layout.json', serialize(defense)]]);
const bytes = [...files.values()].reduce((total, source) => total + Buffer.byteLength(source), 0);
if (bytes >= 1024 * 1024) throw new Error(`Geometry fixtures exceed the 1 MiB budget: ${bytes} bytes.`);
for (const [name, source] of files) {
  const path = resolve(output, name);
  if (check) {
    let current;
    try {current = await readFile(path, 'utf8');}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
    if (current !== source) throw new Error(`Measured fixture is stale or missing: ${path}. Run node tools/capture_game_test_fixtures.mjs to refresh.`);
  } else {
    await mkdir(output, {recursive: true});
    await writeFile(path, source);
  }
}
console.log(`${check ? 'Verified' : 'Captured'} fixtures: fishing 17 cats / 5 rods / 4 fish; defense 17 cats / 15 enemies; ${bytes} bytes.`);
