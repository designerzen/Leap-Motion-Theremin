Theremid
====================

Play in the air. Theremid is a hand-tracking instrument controller for the web: wave your hands over a **Leap Motion / Ultraleap** sensor, in front of a **camera**, or use a **mouse, pen, touch screen or keyboard**. Choose from nine play modes and eleven surfaces to play on, two of them 3D worlds that show your hands.

It began as my entry to Music Hack Day London 2014 (made over 24 hours, 12–13 December 2014). That original code is preserved in [`legacy/`](legacy/). Version 2 is a ground-up rewrite as a dependency-free web component that doubles as a **[HarmonEasy](https://github.com/designerzen/harmoneasy) input**.

## Play modes

| Mode | What it does |
| --- | --- |
| Theremin glide | Continuous pitch using a held note plus pitch bend. Without MPE, the second hand works the volume loop. |
| Autotune glide | Glides freely while the hand moves, then settles into the scale when it rests. |
| Scale notes | Each hand plays the nearest note of the chosen key and scale. |
| Close harmony | The melody on top, with diatonic thirds below it. |
| Chords | Each hand holds a diatonic triad, seventh, ninth, sus or power chord. |
| Arpeggiator | Arpeggiates the chord under each hand. Raise the hand to play faster. |
| Pulse | Repeats the note under each hand in time. Raise the hand to subdivide. |
| Strum | Sweep across the scale like strings. Faster sweeps pluck harder. |
| Drone and melody | Left hands latch a drone; right hands play over it. Touch the drone's note again to stop it. |

## Surfaces

Each surface has its own look and its own geometry. The hand's position becomes pitch and expression differently on each one.

| Surface | Layout |
| --- | --- |
| Aether | The classic theremin: pitch antenna, volume loop, and a field that bends around your hands. |
| Strings | A harp of scale strings that ring when played. |
| Ribbon | An Ondes Martenot ribbon over a keyboard. |
| Orbit | A dial: angle sets pitch, distance from the centre sets expression. |
| Lattice | A harmonic table of hexagons: up a fifth, diagonally a third. Chords become shapes. |
| Horizon | Synthwave lanes running to a vanishing point. |
| Nebula | A particle cloud. Pitch rises upwards. |
| Oscilloscope | A phosphor scope that draws Lissajous figures when two hands play. |
| Aurora | Northern lights: every note raises a curtain of light. |
| Hologram | The original 2014 scene rebuilt in WebGL: fog, a sphere, a box per hand, an audio point cloud, bone hands, film grain and a glitch when you make a fist. |
| Terrain | A wireframe landscape rolling out of the sound, with glowing pillars for the scale notes and your hands above it. |

## Hand sources

- **Pointer:** mouse, pen and multi-touch. Each finger is a hand, and pen or touch pressure counts as push.
- **Keyboard:** focus the surface, move with the arrow keys (hold Shift for fine moves), and hold Space or Enter to play.
- **Leap Motion:** connects to the tracking service's WebSocket JSON protocol (`ws://127.0.0.1:6437/v6.json`), so no vendor SDK is needed. On Ultraleap Gemini, run Ultraleap's WebSocket bridge. It reports palm position, grab, pinch, roll and every finger joint.
- **Camera:** MediaPipe Hand Landmarker, loaded on demand. It reports the same hand features and joints, and can show a faint mirrored backdrop.

When a source supplies finger joints, the surfaces draw your actual hands: as a skeleton over the 2D surfaces and as translucent bone hands inside the 3D ones, in the manner of the original Leap rigged hand.

Each hand sends notes with velocity, plus CC11 expression, CC1 modulation (from a fist) and CC74 brightness (from palm roll).

## Controls

The panel shows **Mode**, **Surface**, **Key** and **Scale**, with a one-line explanation under the mode and surface, plus toggles for **Leap Motion** and **Camera** whose light shows whether tracking is running. Settings that only some modes use (chord shape, tempo, settle, note length) appear only when that mode is selected. **More** opens the rest: the note range, how tracked hands trigger (*Play when* a hand is in view, pinching, or open) and how steady the tracking is, and the MIDI bend range and *A channel per hand* (MPE).

## Use it

```html
<script type="module">
	import { ThereminSynth } from "theremid"

	const theremid = document.querySelector("theremid-input")
	// Theremid makes no sound itself. Voice it with the bundled synth, or any listener.
	document.addEventListener("pointerdown", () => {
		const synth = new ThereminSynth()
		synth.attach(theremid)
		theremid.analyser = synth.analyser
	}, { once: true })
</script>

<theremid-input mode="glide" surface="aether" key="A" scale="pentatonic-minor" low="45" high="81"></theremid-input>
```

Attributes: `mode`, `surface`, `key`, `scale`, `low`, `high`, `chord`, `bpm`, `autotune`, `sustain`, `bend-range`, `mpe`, `channel`, `group`, `sources` (`"leap camera"`, or `"none"`), `gate`, `smoothing`, `leap-url`, `mirror`, `camera-backdrop`, `hide-controls`, `disabled` and `muted`. The 3D surfaces need WebGL2 and fall back to a flat drawing without it. Theme it with the CSS custom properties `--theremid-background`, `--theremid-foreground`, `--theremid-muted`, `--theremid-accent`, `--theremid-font` and `--theremid-height`.

Events: `noteOn`, `noteOff`, `pitchBend` and `controlChange`, each with MIDI 2.0 UMP words in `event.detail.ump`; also `instrumentChange` and `instrumentDisconnect`.

### In HarmonEasy

Theremid is HarmonEasy's `leap-motion` input: see [integration/harmoneasy.md](integration/harmoneasy.md) for the registry entries. HarmonEasy's existing `InputWebComponent` hosts the element as it is.

## Develop

```bash
pnpm install
pnpm dev        # demo at http://localhost:5173
pnpm test       # vitest
pnpm build      # dist/ (library and types) and dist-demo/ (static site)
```

---

Released under the [**GPL 2.0 licence**](http://www.gnu.org/licenses/gpl-2.0.txt).
