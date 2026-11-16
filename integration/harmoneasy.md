# Theremid as HarmonEasy's Leap Motion input

Theremid is an event-only custom element, `<theremid-input>`. It follows the same contract as HarmonEasy's built in UI controllers, such as `xy-pitch-controller`:

- It dispatches `noteOn`, `noteOff`, `pitchBend` and `controlChange` `CustomEvent`s from the host element, with `bubbles` and `composed` set. Each `detail` carries MIDI 2.0 UMP words in `detail.ump`, encoded exactly as `packages/audiobus/ui/interfaces/instrument.ts` does.
- Note events carry a voice `id`, which is preserved on `noteOff`.
- It dispatches `instrumentDisconnect` when removed, and `instrumentChange` whenever a setting changes. Every setting is a reflected attribute, so `InputWebComponent.saveAttributes()` persists it with the workspace.
- It has a `stop()` method that releases every sounding note.
- Its shadow DOM settings are real `<select>` and `<input>` elements with `name`s and labels, so `installComponentUi` exposes them as device controls (and MIDI Learn targets) without extra code.

Because of this, HarmonEasy's existing `InputWebComponent` hosts it unchanged.

## What changed in HarmonEasy

HarmonEasy's `leap-motion` input used to be `io/inputs/input-leap-motion.ts`, which needed the abandoned Leap JavaScript SDK loaded as `window.Leap` and so was never available. It is now this component, registered under the same id so saved workspaces and the `hardware/leap-motion/aurora` preset still resolve. The edits, all in the `audiobus` submodule:

- `package.json`: a `theremid` dependency on this repository's `theremid-harmoneasy` branch. HarmonEasy builds with Vite, so it imports the TypeScript source through the `theremid/source` export and no build step is needed. For local development with both repositories side by side, point it at `link:../../../Leap-Motion-Theremin` instead.
- `ui/input-components.ts`: a `LEAP_MOTION` entry with `tag: "theremid-input"` and `load: () => import("theremid/source")`. `input-definitions.ts` and `input-factory.ts` already turn every entry here into an `InputWebComponent`.
- `io/input-factory.ts`: the old explicit `leap-motion` factory entry and its `window.Leap` availability check are gone; the UI component path handles it.
- `io/inputs/input-leap-motion.ts`: deleted.
- `io/input-definitions.ts` and `app/harmoneasy/presets/inputs/leap-motion/aurora.json`: descriptions no longer mention the SDK.

Run `pnpm install` at the HarmonEasy root afterwards so the dependency is fetched.

## Notes for chains

- **Pitch bend range.** Theremin glide and autotune glide send a held note plus pitch bend. Set Theremid's *Bend range* (under *More*) to match the output instrument's bend range (2 semitones by default). With a wider range on the instrument, glides re-trigger less often.
- **MPE.** With *A channel per hand* on, each hand plays on its own channel, starting one above the base channel, so several hands can bend independently. Use an MPE-capable output, or a Channeler transformer, to route these channels.
- **Controllers.** Each hand sends CC11 (expression, from hand height or radius), CC1 (modulation, from a closed fist) and CC74 (brightness, from palm roll). In glide modes without MPE, the second hand sends CC7 (volume), like a real theremin's volume loop.
- **Transformers.** The Scale notes, Chords, Arpeggiator, Pulse and Strum modes already quantise to the chosen key and scale. In glide modes, put a Harmoniser after Theremid if you want HarmonEasy to quantise instead.
- **Leap Motion.** The element connects to `ws://127.0.0.1:6437/v6.json`, the tracking service's WebSocket protocol, and reads palm and finger joint positions from it. Ultraleap Gemini needs Ultraleap's WebSocket bridge running. Override the address with the `leap-url` attribute.
- **Camera.** MediaPipe Hand Landmarker is loaded from jsDelivr on first use. HarmonEasy already depends on `@mediapipe/tasks-vision`, so it can self-host the files by setting `CAMERA_ASSETS.module`, `.wasm` and `.model` before the camera starts.
- **3D surfaces.** Hologram and Terrain draw with WebGL2 on a second canvas beneath the controls, and show tracked hands as the original Leap rigged hand mesh, loaded as a separate chunk on first use. Where WebGL2 is unavailable they fall back to a flat drawing, so the input still works.
