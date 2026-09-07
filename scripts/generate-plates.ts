/**
 * OFFLINE ONLY. Never imported by src, never run by dev/build or a conversation.
 * Uses the authenticated Codex CLI to ask gpt-6-astra for a p5.brush sketch once.
 * Generated code stays in a temporary directory; only raster textures ship.
 * Tools: npm install --prefix /tmp/markos-plate-tools p5@2.3.2 p5.brush@2.2.2 playwright@1.58.2
 * Run: npx tsx scripts/generate-plates.ts
 * --render-only reuses the authored sketch after inspection (no second model call).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';

async function main() {
  const work = process.env.MARKOS_PLATE_TOOLS || '/tmp/markos-plate-tools';
  mkdirSync(work, { recursive: true });
  const sketchPath = path.join(work, 'authored-sketch.js');
  if (!process.argv.includes('--render-only')) {
    const docs = await fetch('https://raw.githubusercontent.com/acamposuribe/p5.brush/v2.2.2/llms.txt').then(r => r.ok ? r.text() : '');
    const prompt = `Author ONLY JavaScript code (no fences). No tools, network, filesystem, imports, or external assets. Define global function paintPlate(register, seed), register is an integer 0..7. It is called once in p5 draw after createCanvas(1024,1024,WEBGL), pixelDensity(1), background(255), translate(-512,-512), randomSeed(seed), noiseSeed(seed). p5.js 2.3.2 and p5.brush 2.2.2 globals are available.
Art direction: restrained ancient Roman campaign journal, Marcus Aurelius, natural media, large layered broken gestural brush washes. Eight registers from quiet marble/stone/olive/aegean to weathered bronze and oxblood. Palette HEX #80796b stone, #6e7353 olive, #42646a aegean, #92724f weathered bronze, #743e3b oxblood, #ddd6c7 marble. NO bright greens pinks yellow meadow landscapes. Compose an irregular compact breathing mass of overlapping pigment strokes at center, painterly torn edges, dry brush fibres and watercolor blooms, airy white negative space beyond 100..924. NOT yin-yang, figure-eight, clean circle, outline ring, illustration or smooth gradients. The asset will be used both as pigment orb and enlarged faint background: beautiful at both scales. Use 6-12 irregular brush.polygon watercolor washes, flowing diagonal/curving ribbons with organic sides, translucent overlap (fill opacity 105–135, fillTexture border intensity .10–.15, dry fibre brush weight 12 and opacity 150); 20-45 detailed brush.spline dry marks. Avoid expensive huge loops; finish under 15 seconds. Let emotional register shift palette and density gradually. All substantial art must be p5.brush not simulated with plain canvas. Must call brush.noStroke before fills, brush.noFill before strokes. Return naturally after drawing. Documented API below:\n${docs}`;
    execFileSync('codex', ['exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', work, '-m', 'gpt-6-astra', '-o', sketchPath, '-'], { input: prompt, stdio: ['pipe', 'ignore', 'inherit'], timeout: 600_000 });
    const source = readFileSync(sketchPath, 'utf8').trim().replace(/^```(?:javascript|js)?\s*/, '').replace(/\s*```$/, '');
    if (!source.includes('function paintPlate') || /\b(fetch|XMLHttpRequest|WebSocket|import|eval)\s*\(/.test(source)) throw new Error('Unexpected generated code: inspect before rendering');
    writeFileSync(sketchPath, source);
  }
  const requireTools = createRequire(path.join(work, 'package.json'));
  const { chromium } = requireTools('playwright');
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  const out = path.resolve('public/plates');
  mkdirSync(out, { recursive: true });
  const names = ['marble', 'stone', 'olive', 'aegean', 'bronze', 'burden', 'oxblood', 'ash'];
  try {
    for (let i = 0; i < names.length; i++) {
      const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
      await page.route('**/*', (route: { abort: () => Promise<void> }) => route.abort());
      page.on('pageerror', (error: Error) => console.error(error.message));
      await page.setContent('<html><body style="margin:0"></body></html>');
      await page.addScriptTag({ path: path.join(work, 'node_modules/p5/lib/p5.min.js') });
      await page.addScriptTag({ path: path.join(work, 'node_modules/p5.brush/dist/p5.brush.js') });
      await page.addScriptTag({ content: readFileSync(sketchPath, 'utf8') + `\nfunction setup(){pixelDensity(1);createCanvas(1024,1024,WEBGL);noLoop();} function draw(){background(255);translate(-512,-512);randomSeed(7281);noiseSeed(7281);paintPlate(${i},7281);requestAnimationFrame(()=>{window.plateReady=true});} new p5();` });
      await page.waitForFunction('window.plateReady === true', { timeout: 120000 });
      const png = await page.locator('canvas').first().screenshot();
      // Lossless: preserve the darkest-pixel contrast bound through encoding.
      const raw = await sharp(png).removeAlpha().raw().toBuffer();
      // Deepen pigment for the small orb without losing the authored torn boundaries.
      const pigment = Buffer.from(raw);
      const field = Buffer.from(raw);
      for (let j = 0; j < raw.length; j++) {
        pigment[j] = Math.max(0, 255 - (255 - raw[j]) * 3);
        // Text-safe wash is authored OFFLINE, not a runtime colour/gradient generator.
        field[j] = Math.round(236 + pigment[j] / 255 * 19);
      }
      // One atlas per emotional register: pigment above, lightened field below.
      const transparent = Buffer.alloc(1024 * 1024 * 4);
      for (let j = 0, k = 0; j < pigment.length; j += 3, k += 4) {
        const alpha = 255 - Math.min(pigment[j], pigment[j + 1], pigment[j + 2]);
        for (let c = 0; c < 3; c++) transparent[k + c] = alpha ? Math.round((pigment[j + c] - (255 - alpha)) * 255 / alpha) : 0;
        transparent[k + 3] = alpha;
      }
      const pigmentPng = await sharp(transparent, { raw: { width: 1024, height: 1024, channels: 4 } }).png().toBuffer();
      const fieldPng = await sharp(field, { raw: { width: 1024, height: 1024, channels: 3 } }).png().toBuffer();
      await sharp({ create: { width: 1024, height: 2048, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
        .composite([{ input: pigmentPng, top: 0, left: 0 }, { input: fieldPng, top: 1024, left: 0 }])
        .webp({ lossless: true, effort: 6 }).toFile(path.join(out, `${names[i]}.webp`));
      console.log(`Painted ${names[i]}`);
      await page.close();
    }
    // Stationary natural tooth. Deliberately bounded: its darkest channel is 254/255.
    const grain = Buffer.alloc(256 * 256 * 3);
    let seed = 619;
    for (let i = 0; i < grain.length; i += 3) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const c = 254 + (seed % 2); grain[i] = grain[i + 1] = grain[i + 2] = c;
    }
    await sharp(grain, { raw: { width: 256, height: 256, channels: 3 } }).png().toFile(path.join(out, 'paper-grain.png'));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
