# Using Theremid as a HarmonEasy input

Theremid is an event-only custom element, `<theremid-input>`. It follows the same contract as HarmonEasy's built in UI controllers, such as `xy-pitch-controller`:

- It dispatches `noteOn`, `noteOff`, `pitchBend` and `controlChange` `CustomEvent`s from the host element, with `bubbles` and `composed` set. Each `detail` carries MIDI 2.0 UMP words in `detail.ump`, encoded exactly as `packages/audiobus/ui/interfaces/instrument.ts` does.
- Note events carry a voice `id`, which is preserved on `noteOff`.
- It dispatches `instrumentDisconnect` when removed, and `instrumentChange` whenever a setting changes. Every setting is a reflected attribute, so `InputWebComponent.saveAttributes()` persists it with the workspace.
- It has a `stop()` method that releases every sounding note.
- Its shadow DOM settings are real `<select>` and `<input>` elements with `name`s and labels, so `installComponentUi` exposes them as device controls (and MIDI Learn targets) without extra code.

Because of this, HarmonEasy's existing `InputWebComponent` hosts it unchanged. Registering it takes three small edits in the `audiobus` submodule.

## 1. Add the dependency

In `packages/audiobus/package.json`, add one of:

```json
"theremid": "github:designerzen/Leap-Motion-Theremin#theremid-harmoneasy"
```

or, for local development with both repositories checked out side by side:

```json
"theremid": "link:../../../Leap-Motion-Theremin"
```

Then run `pnpm install`. HarmonEasy builds with Vite, so you can also import the TypeScript source directly through the `theremid/source` export.

## 2. Add an input ID

In `packages/audiobus/io/inputs/input-types.ts`, next to the other UI controllers:

```ts
export const THEREMID = "theremid" as const
```

Add `typeof THEREMID` to the union of UI input IDs, if that file keeps one.

## 3. Register the component

In `packages/audiobus/ui/input-components.ts`:

```ts
[INPUT_TYPES.THEREMID]: {
	tag: "theremid-input",
	name: "Theremid",
	description:
		"Play in the air with Leap Motion, a camera or a pointer: theremin glides, scales, chords, arpeggios and strums over nine visual surfaces",
	subtype: "pointer",
	load: () => import("theremid")
},
```

`input-definitions.ts` and `input-factory.ts` already map every entry of `UI_INPUT_COMPONENTS` to `InputWebComponent`, so nothing else needs to change. The same object is exported from the package as `HARMONEASY_INPUT_COMPONENT` (from `theremid/harmoneasy`) if you prefer to spread it in.

## Notes for chains

- **Pitch bend range.** Theremin glide and autotune glide send a held note plus pitch bend. Set Theremid's *Bend range* to match the output instrument's bend range (2 semitones by default). With a wider range on the instrument, glides re-trigger less often.
- **MPE.** With *MPE* on, each hand plays on its own channel, starting one above the base channel, so several hands can bend independently. Use an MPE-capable output, or a Channeler transformer, to route these channels.
- **Controllers.** Each hand sends CC11 (expression, from hand height or radius), CC1 (modulation, from a closed fist) and CC74 (brightness, from palm roll). In glide modes without MPE, the second hand sends CC7 (volume), like a real theremin's volume loop.
- **Transformers.** The Scale notes, Chords, Arpeggiator, Pulse and Strum modes already quantise to the chosen key and scale. In glide modes, put a Harmoniser after Theremid if you want HarmonEasy to quantise instead.
- **Leap Motion.** The element connects to `ws://127.0.0.1:6437/v6.json`, the tracking service's WebSocket protocol. Ultraleap Gemini needs Ultraleap's WebSocket bridge running. Override the address with the `leap-url` attribute.
- **Camera.** MediaPipe Hand Landmarker is loaded from jsDelivr on first use. HarmonEasy already depends on `@mediapipe/tasks-vision@1.2.0`, so it can self-host the files by setting `CAMERA_ASSETS.module`, `.wasm` and `.model` before the camera starts.
