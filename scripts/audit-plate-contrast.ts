/** Offline audit: decoded pixels, not means. Run: npx tsx scripts/audit-plate-contrast.ts */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import sharp from 'sharp';
import assert from 'node:assert/strict';

const screens = ['src/app/page.tsx', ...['IntroSequence', 'OnboardingFlow', 'AppHeader', 'AnalyticsDashboard', 'Sidebar', 'ConversationView', 'SessionSummary', 'SettingsScreen', 'VisualPreview'].map(n => `src/components/${n}.tsx`)];
const colours = new Map<string, Set<string>>();
function record(hex: string, file: string) {
  if (!/^#[a-f\d]{6}$/i.test(hex)) return;
  hex = hex.toLowerCase();
  const uses = colours.get(hex) || new Set<string>(); uses.add(file); colours.set(hex, uses);
}
for (const file of screens) {
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const constants = new Map<string, ts.Expression>();
  function discover(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) constants.set(node.name.text, node.initializer);
    ts.forEachChild(node, discover);
  }
  discover(ast);
  function values(node: ts.Node, visited = new Set<string>()) {
    if (ts.isStringLiteral(node)) record(node.text, file);
    if (ts.isIdentifier(node) && !visited.has(node.text)) {
      visited.add(node.text); const init = constants.get(node.text); if (init) values(init, visited);
    } else ts.forEachChild(node, child => values(child, visited));
  }
  function walk(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'color') values(node.initializer);
    ts.forEachChild(node, walk);
  }
  walk(ast);
  if (/\btext-white\b/.test(source)) record('#ffffff', file);
  assert(!/(?:hover|disabled):opacity-[1-9]|text-muted-foreground\/\d/.test(source), `Contrast-reducing opacity in ${file}`);
  for (const match of source.matchAll(/(?:text|placeholder:text)-\[(#[a-f\d]{6})\]/gi)) record(match[1], file);
}
const css = readFileSync('src/app/globals.css', 'utf8');
for (const match of css.matchAll(/(?:^|[;{\n])\s*(?:color|--[\w-]*foreground)\s*:\s*(#[a-f\d]{6})/gi)) record(match[1], 'src/app/globals.css');
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const luminance = (c: number[]) => c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((l, v, i) => l + v * [.2126, .7152, .0722][i], 0);
const contrast = (a: number, b: number) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
const round = (v: number) => +v.toFixed(3);

async function main() {
  const files = readdirSync('public/plates').filter(f => /\.(webp|png)$/.test(f)).sort();
  const grain = await sharp('public/plates/paper-grain.png').removeAlpha().raw().toBuffer();
  const grainFloor = grain.reduce((min, value) => Math.min(min, value), 255) / 255;
  const channelFloor = [255, 255, 255];
  const plates = [];
  for (const file of files.filter(f => f.endsWith('.webp'))) {
    const { data, info } = await sharp(`public/plates/${file}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let fieldMin = 1, pigmentMin = 1, darkestXY = [0, 0];
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels;
      const pixel = [data[offset], data[offset + 1], data[offset + 2]];
      if (y < info.height / 2) { pigmentMin = Math.min(pigmentMin, luminance(pixel.map(v => v * data[offset + 3] / 255 + 255 - data[offset + 3]))); continue; }
      // Multiply by the DARKEST grain pixel, regardless of actual alignment or UV motion.
      const composed = pixel.map(v => Math.floor(v * grainFloor));
      composed.forEach((v, i) => { channelFloor[i] = Math.min(channelFloor[i], v); });
      const l = luminance(composed);
      if (l < fieldMin) { fieldMin = l; darkestXY = [x, y - info.height / 2]; }
    }
    plates.push({ plate: file, bytes: statSync(`public/plates/${file}`).size, darkestXY, fieldLuminance: round(fieldMin), pigmentLuminance: round(pigmentMin), ratios: Object.fromEntries([...colours.keys()].sort().map(hex => [hex, round(contrast(luminance(rgb(hex)), fieldMin))])) });
  }
  // Componentwise lower bound also covers every bilinear sample and crossfade between plates.
  const floorL = luminance(channelFloor);
  const inverse = new Set(['#faf9f6', '#f4ecdd', '#ffffff']);
  const inventory = [...colours.entries()].sort().map(([hex, uses]) => {
    const role = inverse.has(hex) ? 'inverse-on-solid-control' : ['#6b6259', '#5c534b'].includes(hex) ? 'muted' : 'heading-body';
    const ratio = contrast(luminance(rgb(hex)), floorL);
    const required = role === 'muted' ? 4.5 : 7;
    return { colour: hex, files: [...uses], role, required, darkestFieldRatio: round(ratio), passesOnField: role === 'inverse-on-solid-control' ? null : ratio >= required };
  });
  const solidPairs = [
    ['#faf9f6', '#14100e', 7], ['#f4ecdd', '#100d0a', 7],
    ['#ffffff', '#44403c', 7], ['#ffffff', '#57534e', 7],
    ['#100d0a', '#e7e1d2', 7], ['#14100e', '#faf9f6', 7],
    ['#6b6259', '#e7e1d2', 4.5], ['#6b6259', '#faf9f6', 4.5],
  ].map(([foreground, background, required]) => {
    const ratio = contrast(luminance(rgb(String(foreground))), luminance(rgb(String(background))));
    return { foreground, background, ratio: round(ratio), required, pass: ratio >= Number(required) };
  });
  const introInk = rgb('#2b2721').map((v, i) => v * .92 + channelFloor[i] * .08);
  const introRatio = contrast(luminance(introInk), floorL);
  const report = {
    method: 'Every decoded atlas pixel. Field half only under text; pigment half is decorative orb. Multiply worst grain; floor rounding. Also independent RGB minima for all possible bilinear/crossfade combinations. No mean luminance.',
    totalAssetBytes: files.reduce((n, file) => n + statSync(`public/plates/${file}`).size, 0),
    opacityCases: [{ colour: '#2b2721', opacity: .92, darkestFieldRatio: round(introRatio), required: 7, pass: introRatio >= 7 }],
    grainFloor, crossfadeChannelFloor: channelFloor, crossfadeLuminanceFloor: round(floorL), plates, inventory, solidPairs,
    corrections: [
      'Plates lightened offline. Existing #8c8378 cannot reach muted 4.5 on white (max 3.728); processing text now uses Marcus muted ink #6b6259.',
      'Existing #b0611f cannot reach body 7 on white (max 4.589). Text-only bronze now uses #713b12; decorative accent colours stay unchanged.',
      'Removed text/container opacity reductions on hover, disabled controls, onboarding labels/placeholders and loading copy. Intro settled word opacity is at least .92. Entrance/exit animation frames are not settled text.',
      'Inverse cream/white text is on solid ink controls, not directly on a plate. Both plate ratios and actual solid-control ratios are reported.'
    ],
  };
  writeFileSync('docs/plate-contrast.json', JSON.stringify(report, null, 2) + '\n');
  assert(inventory.every(item => item.passesOnField !== false), 'A text colour fails its darkest-region requirement');
  assert(solidPairs.every(item => item.pass), 'A solid control/input fails contrast');
  assert(introRatio >= 7, 'Settled intro words fail contrast');
  console.log(JSON.stringify({ totalAssetBytes: report.totalAssetBytes, crossfadeChannelFloor: channelFloor, inventory }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
