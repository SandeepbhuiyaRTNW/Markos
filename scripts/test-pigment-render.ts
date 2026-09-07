/** Headless graphics verification, isolated from the app/API/microphone. Same offline tools as generate-plates.ts. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import sharp from 'sharp';
import assert from 'node:assert/strict';

async function main() {
  const requireTools = createRequire(`${process.env.MARKOS_PLATE_TOOLS || '/tmp/markos-plate-tools'}/package.json`);
  const { chromium } = requireTools('playwright');
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import PigmentPlate from './src/components/PigmentPlate'; window.level=0; window.weight=0; const root=createRoot(document.getElementById('root')); window.redraw=()=>root.render(React.createElement('div', {style:{position:'relative',width:640,height:400}}, React.createElement(PigmentPlate,{mode:'field',register:window.weight}), React.createElement('div',{id:'orb',style:{position:'absolute',left:200,top:90,width:220,height:220}}, React.createElement(PigmentPlate,{mode:'orb',register:window.weight,getLevel:()=>window.level})))); window.redraw();`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const css = readFileSync('src/app/globals.css', 'utf8').split('/* Offline p5.brush')[1];
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
  try {
    for (const mode of ['motion', 'reduced', 'no-webgl']) {
      const page = await browser.newPage({ viewport: { width: 640, height: 400 }, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
      const errors: string[] = [], requests: string[] = [];
      page.on('pageerror', (e: Error) => { errors.push(e.message); console.error('PAGE ERROR', e.message); });
      page.on('console', (message: { type: () => string; text: () => string }) => { if (message.type() === 'error' || message.type() === 'warning') console.log(message.text()); });
      await page.route('**/*', async (route: { request: () => { url: () => string }; fulfill: (r: object) => Promise<void>; abort: () => Promise<void> }) => {
        const url = new URL(route.request().url()); requests.push(url.pathname);
        if (url.pathname.startsWith('/plates/') && /^\/plates\/[a-z-]+\.(webp|png)$/.test(url.pathname)) return route.fulfill({ body: readFileSync(`public${url.pathname}`), contentType: url.pathname.endsWith('png') ? 'image/png' : 'image/webp' });
        if (url.pathname === '/') return route.fulfill({ body: `<html><style>body{margin:0}/* Offline p5.brush${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script></html>`, contentType: 'text/html' });
        return route.abort();
      });
      if (mode === 'no-webgl') await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
          if (kind.includes('webgl')) return null;
          return Reflect.apply(original, this, [kind, ...args]);
        } as typeof original;
      });
      await page.goto('http://plate-test.invalid/');
      await page.waitForFunction('document.querySelectorAll(".pigment-plate").length === 2');
      if (mode === 'motion') {
        await page.waitForFunction('document.querySelectorAll("[data-painted=true]").length === 2');
        const before = await page.screenshot();
        await page.evaluate('window.level=1;window.weight=1;window.redraw()');
        await page.waitForTimeout(2000);
        const after = await page.screenshot();
        const a = await sharp(before).raw().toBuffer(), b = await sharp(after).raw().toBuffer();
        let changed = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
        assert(changed > 1000, `Expected moving pigment, only ${changed} channels changed`);
        const uniforms = await page.evaluate(`Array.from(document.querySelectorAll('.plate-canvas')).map(el=>{const m=el.paperShaderMount;const gl=m.canvasElement.getContext('webgl2'); const program=gl.getParameter(gl.CURRENT_PROGRAM);return {level:gl.getUniform(program,gl.getUniformLocation(program,'uLevel')), register:gl.getUniform(program,gl.getUniformLocation(program,'uRegister'))}})`);
        assert(uniforms[1].level > .9, 'Existing audio envelope must reach uLevel');
        const cornerAlpha = await page.evaluate(`(()=>{const m=document.querySelector('#orb .plate-canvas').paperShaderMount;m.setUniforms({uMotionTime:0});const gl=m.canvasElement.getContext('webgl2');const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return pixel[3]})()`);
        assert.equal(cornerAlpha, 0, 'Orb corners must be transparent, never a white rectangle');

        assert(uniforms[0].register > .1 && uniforms[0].register < .9, 'Emotion must ease rather than snap');
        await page.evaluate(`document.querySelectorAll('.plate-canvas canvas').forEach(c=>c.dispatchEvent(new Event('webglcontextlost',{cancelable:true})))`);
        assert.equal(await page.locator('[data-painted=true]').count(), 0, 'Context loss must reveal plates');
        console.log(`PASS motion: ${changed} changed channels; live uLevel ${uniforms[1].level.toFixed(3)}; eased register ${uniforms[0].register.toFixed(3)}; context-loss fallback`);
      } else {
        await page.waitForTimeout(700);
        assert.equal(await page.locator('canvas').count(), 0, `${mode} must not retain a canvas`);
        const before = await page.screenshot(); await page.waitForTimeout(150); const after = await page.screenshot();
        assert(before.equals(after), `${mode} must be static`);
        console.log(`PASS ${mode}: static field + pigment; no canvas`);
      }
      assert.deepEqual(errors, [], `Unexpected ${mode} errors`);
      assert(requests.every(url => url === '/' || url.startsWith('/plates/')), 'Rendering can request only committed texture assets');
      await page.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
