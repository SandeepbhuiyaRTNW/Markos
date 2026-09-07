/** Isolated welcome lifecycle checks; speech is mocked, no microphone or TTS service. */
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import assert from 'node:assert/strict';

async function main() {
  const requireTools = createRequire('/tmp/markos-plate-tools/package.json');
  const { chromium } = requireTools('playwright');
  const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import MarcusWelcome from './src/components/MarcusWelcome'; const root=createRoot(document.getElementById('root'));window.done=0;window.mount=()=>root.render(React.createElement(MarcusWelcome,{onComplete:()=>window.done++}));window.unmount=()=>root.render(null);window.mount();`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const mode of ['speaking', 'blocked', 'unavailable']) {
      const page = await browser.newPage({ reducedMotion: 'reduce' });
      const requests: string[] = [], errors: string[] = [];
      page.on('pageerror', (error: Error) => errors.push(error.message));
      await page.route('**/*', async (route: { request: () => { url: () => string }; fulfill: (arg: object) => Promise<void>; abort: () => Promise<void> }) => {
        const url = new URL(route.request().url()); requests.push(url.pathname);
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
        return route.abort();
      });
      // tsx preserves function names when serializing the mock into the page.
      await page.addInitScript('window.__name = function (target) { return target; }');
      await page.addInitScript((scenario: string) => {
        const w = window as unknown as Record<string, unknown>;
        w.calls = 0; w.cancels = 0;
        class Utterance { constructor(public text: string) {} }
        Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true });
        Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: scenario === 'unavailable' ? undefined : {
          speaking: false, pending: false, getVoices: () => [],
          speak: (u: { onstart?: () => void; onerror?: (e: { error: string }) => void }) => { w.calls = Number(w.calls) + 1; w.utterance = u; setTimeout(() => scenario === 'blocked' && Number(w.calls) === 1 ? u.onerror?.({ error: 'not-allowed' }) : u.onstart?.(), 0); },
          cancel: () => { w.cancels = Number(w.cancels) + 1; },
        } });
      }, mode);
      await page.goto('http://welcome-test.invalid/');
      if (mode === 'unavailable') {
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        assert.equal(await page.evaluate('window.done'), 1);
      } else {
        if (mode === 'blocked') await page.getByRole('button', { name: 'Hear Marcus' }).click();
        await page.getByRole('button', { name: 'Skip introduction' }).waitFor({ timeout: 5000 }).catch(async (error: Error) => { console.log(mode, await page.locator('body').innerText(), await page.evaluate('({calls:window.calls,cancels:window.cancels})'), errors); throw error; });
        if (mode === 'speaking') {
          await page.evaluate('window.utterance.onboundary();window.utterance.onend()');
          assert.equal(await page.evaluate('window.done'), 1);
          await page.evaluate('window.unmount()');
          await page.waitForFunction('document.querySelector("#root").children.length === 0');
          await page.evaluate('window.mount()');
          await page.waitForFunction('window.done === 2');
          assert.equal(await page.evaluate('window.calls'), 1, 'Welcome must not repeat after completion');
        } else {
          await page.evaluate('window.unmount()');
          await page.waitForFunction('document.querySelector("#root").children.length === 0');
          assert(Number(await page.evaluate('window.cancels')) >= 1, 'Unmount must stop the owned greeting');
        }
      }
      assert.deepEqual(errors, []);
      assert(requests.every(path => path === '/' || path.startsWith('/plates/')), 'Welcome must not call a server voice/conversation endpoint');
      console.log(`PASS welcome ${mode}`);
      await page.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
