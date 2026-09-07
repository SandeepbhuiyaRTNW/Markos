# Marcus: offline painterly plates

**Implemented: offline p5.brush plates, reactive Paper texture shaders, shared screen treatment, static fallbacks and passing darkest-region contrast checks.**

## Artwork and asset weight

Eight p5.brush texture atlases plus a stationary grain texture: **5,144,525 bytes (4.906 MiB)**. These replace the earlier uncommitted raster landscape/presence assets; no meadow imagery remains.

The one-off `scripts/generate-plates.ts` invokes the authenticated Codex CLI with `-m gpt-6-astra`. The revision run reported `model: gpt-6-astra` and `provider: openai`. Astra authored a deterministic p5.brush sketch; offline art direction replaced thin contour lines with broad curved pigment ribbons, softened the background imprint and strengthened spherical brushwork. The sketch ran headlessly with p5 2.3.2 and p5.brush 2.2.2. Generated JavaScript stays outside the repository; the committed deliverables are the raster textures and the manually maintained offline utility, with no generation build step.

Final authored/art-directed sketch SHA-256: `3b357fd3ebcac97a00eb4568db0204874e7e7a54d021c9b2e97ccbc10a7db164`.

Each 1024×2048 lossless WebP atlas contains a transparent pigment painting in its upper half and an offline-lightened field version below. Registers: marble, stone, olive, aegean, bronze, burden, oxblood, ash. Names are palette positions, not additional emotion classifications. Stone, olive, aegean, weathered bronze, oxblood and marble are the only source pigments.

Regeneration is explicitly manual:

```sh
npm install --prefix /tmp/markos-plate-tools p5@2.3.2 p5.brush@2.2.2 playwright@1.58.2
npx tsx scripts/generate-plates.ts
# After inspecting/art-directing the temporary authored sketch:
npx tsx scripts/generate-plates.ts --render-only
npx tsx scripts/audit-plate-contrast.ts
```

The natural-media APIs used are documented in the [p5.brush repository](https://github.com/acamposuribe/p5.brush/tree/v2.2.2). p5.brush is an offline tool, not an application dependency.

## Runtime and unchanged conversation code

- `Orb3D` and `StoicField` accept the same eight `plates` texture inputs and delegate to `PigmentPlate`.
- `ShaderBackground` retains the existing `emotionToRegister` and lexical fallback. The scalar crosses between adjacent painted plates, eased with the existing 4.5-second time constant.
- Paper’s actual `GrainGradient` shader is restored and composed with the committed brush textures through `ShaderMount` in one field pass. Its moving currents and grain multiply with the painted wash. Runtime p5 and Astra are absent; the orb still samples painted pigment rather than a procedural sphere.
- The existing audio callback still maps listening input ×6 / speaking output ×3 / processing .5 / idle .22. `uLevel` has .32-second attack and 1.4-second release. Only pigment displacement/breathing consumes it.
- Texture reads occur at visual mount, independently of the turn; all eight textures are loaded once per mount. Register updates only set uniforms. No turn waits for art generation or a texture request.
- The `VoiceOrb` body from `const [isRecording` through its final pre-render handler was compared with HEAD and is byte-identical. `git diff -- src/lib src/app/api` is empty. `page.tsx` gains the voice-room CSS class and visual `register` prop, and uses the shared field in the two onboarding/loading branches (with content above it). Additional text-only ink/opacity corrections meet the contrast requirements; no handlers change.
- Multiply composition, transparent torn edges and stationary grain replace the rectangular white backing/glow. Two displaced pigment impressions overlap; there is no circular mask.
- Hidden documents pause uniform updates. The driver is capped near 30fps; Paper caps field rendering at 1.5 million pixels and the orb at 350,000 pixels.

## Screen coverage

| Screen | Shared treatment |
|---|---|
| Intro | Existing `StoicField` + `Orb3D` now use the plate renderer |
| Landing | Existing `StoicField` + `Orb3D` |
| Auth: email/password/code | Same continuous `StoicField` under existing forms |
| Profile onboarding / preparing session | Shared `ShaderBackground` replaces the legacy flat ambient background |
| Sessions and entry | Logged-in `ShaderBackground`; existing entry `StoicField` uses the same plates |
| Voice room | `ShaderBackground` + audio-reactive `Orb3D` via `VoiceOrb` |
| Write | Same logged-in `ShaderBackground` |
| Past session and session notes | Same logged-in `ShaderBackground` under `ConversationView`, `Sidebar`, `SessionSummary` |
| Settings | Same logged-in `ShaderBackground` under `SettingsScreen` |

No requested screen is excluded from the visual treatment. Existing control positions, drawer geometry, forms, navigation, disabled states and actions remain. Opaque input/control/transcript surfaces remain their existing cream colours. Authenticated screen coverage is verified from the component tree; browser visual review covered the dev voice preview, not a live authenticated conversation.

The Next development indicator is disabled through `next.config.ts`. The `/preview` route remains development-only, with a simulated audio envelope and no mic/API turn. `/preview?emotion=calm` and `/preview?emotion=grief` exercise the palette.

## Darkest-region contrast

Audit source: `scripts/audit-plate-contrast.ts`; complete per-colour, per-plate source inventory, measured coordinates and solid-control pairs: `docs/plate-contrast.json`.

Every decoded pixel in the field half is tested after multiplication by the darkest paper-grain pixel, with conservative downward channel rounding. Independent channel minima also bound every bilinear sample and crossfade. The full-range pigment half is decorative orb artwork and never sits behind text. Its minimum luminance over white is included separately in the JSON. **No average luminance is used.**

| Plate | Darkest field coordinate | Worst composed luminance | Heading #14100e | Body #3d352e | Bronze #713b12 | Muted #6b6259 |
|---|---|---:|---:|---:|---:|---:|
| aegean.webp | [274, 576] | 0.9 | 17.123:1 | 10.881:1 | 8.136:1 | 5.406:1 |
| ash.webp | [707, 327] | 0.88 | 16.747:1 | 10.642:1 | 7.958:1 | 5.287:1 |
| bronze.webp | [274, 576] | 0.9 | 17.123:1 | 10.881:1 | 8.136:1 | 5.406:1 |
| burden.webp | [699, 317] | 0.898 | 17.079:1 | 10.853:1 | 8.115:1 | 5.392:1 |
| marble.webp | [274, 576] | 0.9 | 17.123:1 | 10.881:1 | 8.136:1 | 5.406:1 |
| olive.webp | [274, 576] | 0.9 | 17.123:1 | 10.881:1 | 8.136:1 | 5.406:1 |
| oxblood.webp | [696, 314] | 0.886 | 16.864:1 | 10.716:1 | 8.013:1 | 5.324:1 |
| stone.webp | [274, 576] | 0.9 | 17.123:1 | 10.881:1 | 8.136:1 | 5.406:1 |

The animated Paper composition also has an analytical minimum: RGB229 before grain, conservatively RGB228 after the darkest grain. This bounds every animation frame and every plate, independently of sampled screenshots. Worst-case ratios: heading **14.877:1**, body **9.454:1**, bronze **7.069:1**, muted **4.697:1**. All roles pass. The render test separately verifies that field pixels respect this floor and that the background itself moves. Settled intro words at .92 opacity pass at 9.426:1.

**Necessary text corrections:** the existing `#8c8378` processing text cannot reach 4.5:1 even on pure white (maximum 3.728:1); existing `#b0611f` cannot reach body 7:1 on white (maximum 4.589:1). Therefore, after lightening the plates offline, those inherited text-only cases were changed to Marcus muted ink `#6b6259` and darker bronze ink `#713b12`. The older onboarding label received the same bronze ink. Decorative accent colours stay unchanged. The session excerpt uses existing body ink. Hover underlines replace fading, placeholders/loading labels keep full contrast, and disabled behaviour remains unchanged without fading the text. This goes beyond plate lightening because lightening alone cannot satisfy those existing colours.

Inverse cream/white text stays on solid ink controls; it is still tested against every plate in the JSON, and separately against its actual background. Input/placeholder checks use their existing solid surfaces:

| Foreground | Actual solid background | Ratio | Required |
|---|---|---:|---:|
| #faf9f6 | #14100e | 17.966:1 | 7:1 |
| #f4ecdd | #100d0a | 16.503:1 | 7:1 |
| #ffffff | #44403c | 10.272:1 | 7:1 |
| #ffffff | #57534e | 7.629:1 | 7:1 |
| #100d0a | #e7e1d2 | 14.851:1 | 7:1 |
| #14100e | #faf9f6 | 17.966:1 | 7:1 |
| #6b6259 | #e7e1d2 | 4.578:1 | 4.5:1 |
| #6b6259 | #faf9f6 | 5.672:1 | 4.5:1 |

No requested screen is excluded. All audited settled text roles pass their applicable requirement; the raw orb pigment is explicitly not a text background.

## Verification

- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- Targeted ESLint for new/rewritten renderers, voice orb, preview and utilities: passed. Broader edited-file lint also exposes one pre-existing `ConversationView` set-state-in-effect error plus existing unused/ref warnings; verified by linting the HEAD version through stdin. Its fetching/loading effect is unchanged as required.
- All 22 pre-existing local TypeScript regression suites passed (the requested 15 plus the additional local suites present in this checkout). Existing failure-path fixtures can log rejected API/DB operations; assertions and process statuses passed. Live account/API E2E scripts were not run.
- `scripts/test-pigment-render.ts`: isolated headless render passes motion, live audio to `uLevel` (~.999), eased emotion (~.378 after two seconds), zero-alpha orb corners, context-loss fallback, reduced-motion static fallback, and unavailable-WebGL static fallback. Network assertion permits only the fixture document and committed `/plates/` assets. No app conversation is started by this test.
- Browser review verified a visible moving pigment field, the heavy palette, intact voice-room controls, and no white rectangle around the orb.

Existing suite results:

| Suite | Result |
|---|---|
| `scripts/test-comm-assist-metrics.ts` | PASS |
| `scripts/test-comm-assist.ts` | PASS |
| `scripts/test-divorce-knowledge.ts` | PASS |
| `scripts/test-draft-exemption.ts` | PASS |
| `scripts/test-embodied-man-knowledge.ts` | PASS |
| `scripts/test-handsfree-loop.ts` | PASS |
| `scripts/test-handsfree.ts` | PASS |
| `scripts/test-harm-gate.ts` | PASS |
| `scripts/test-knowledge-selector.ts` | PASS |
| `scripts/test-legal-advice-fallback.ts` | PASS |
| `scripts/test-listening-knowledge.ts` | PASS |
| `scripts/test-marcus-voice-v2.ts` | PASS |
| `scripts/test-move-selector.ts` | PASS |
| `scripts/test-postgen-reverify.ts` | PASS |
| `scripts/test-retriever-sql.ts` | PASS |
| `scripts/test-session-state.ts` | PASS |
| `scripts/test-turn-kind-fork.ts` | PASS |
| `scripts/test-turn-logger-insert.ts` | PASS |
| `scripts/test-unit.ts` | PASS |
| `scripts/test-w1-composer-return-path.ts` | PASS |
| `scripts/test-w1-message-persistence.ts` | PASS |
| `scripts/test-w4-await-persist.ts` | PASS |

## Voice activity refinement

The voice-room orb is 244px rather than 204px inside its existing 220px layout wrapper. Listening gently gathers and turns pigment inward; speaking expands the painted volume with outward travelling displacement. Existing voice state reaches `uListening` / `uSpeaking` through visual props; their weights ease over .55 seconds without rebuilding WebGL or reloading textures. The original `uLevel` envelope and emotion mapping remain unchanged. Idle/processing use the quiet painted breathing movement, and reduced-motion/no-WebGL stays static.

Development previews accept `state=listening` or `state=speaking` alongside `emotion`. No controls were added. The graphics regression checks state delivery, eased listening-to-speaking handoff, audio levels, background motion and fallbacks. TypeScript, build and targeted lint passed. No assets were added by this refinement.

## Before-onboarding spoken welcome

`MarcusWelcome` brings the same 244px painted orb to the cinematic intro and pre-auth landing. Once the intro orb settles it says: “I’m Marcus. I’m here to listen. You don’t have to find the right words. We can start wherever you are.” The copy remains visible, with a tap-to-play fallback when autoplay is blocked and a skip action while speaking. Completion or skip is remembered for this tab session. Unmount cancels the owned greeting before authentication/onboarding can proceed.

The user does not have ElevenLabs credentials, so this fixed greeting uses device speech synthesis. Its voice depends on the installed browser/OS voices and is not guaranteed to match the conversation voice. Word-boundary events drive painterly speaking pulses; these represent speech cadence, not measured PCM amplitude. The live conversation envelope, microphone, VAD, fetch and ElevenLabs playback code remain untouched. No server endpoint, runtime LLM call or audio asset was added. Reduced-motion continues to use static artwork while retaining readable copy and optional speech.

Preview: `/preview?screen=welcome` (development only, bypasses the heard flag). The isolated welcome test mocks device speech to verify completion, once-per-session behaviour, autoplay recovery, unavailable-speech continuation and unmount cancellation. Device audio quality still needs listening review; the browser connection became unavailable during verification.
