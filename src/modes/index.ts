import { CC_BRIGHTNESS, CC_EXPRESSION, CC_MODULATION, CC_VOLUME, clamp } from "../midi.ts"
import type { Tonality } from "../scales.ts"
import type { Definition, Mode, ModeFrame, Performer, PlayingHand } from "../types.ts"

export const velocityOf = (expression: number) => 0.25 + 0.75 * clamp(expression, 0, 1)

/** Continuous expression controllers for a hand on its own channel. */
export function expressionControls(hand: PlayingHand, out: Performer) {
	out.control(hand.channel, CC_EXPRESSION, hand.gesture.expression)
	out.control(hand.channel, CC_MODULATION, hand.grab)
	out.control(hand.channel, CC_BRIGHTNESS, (hand.roll + 1) / 2)
}

/** Only the lead hand may write channel-wide controllers unless every hand has its own channel. */
const ownsChannel = (hand: PlayingHand, frame: ModeFrame) => frame.settings.mpe || hand.lead

/** Nearest scale note with hysteresis, so a hand resting on a boundary does not flutter. */
export class Snapper {
	#notes = new Map<string, number>()

	note(key: string, pitch: number, tonality: Tonality, hysteresis = 0.2) {
		const candidate = tonality.nearest(pitch)
		const current = this.#notes.get(key)
		if (
			current !== undefined &&
			current !== candidate &&
			tonality.notes.includes(current) &&
			Math.abs(pitch - current) - Math.abs(pitch - candidate) < hysteresis
		) {
			return current
		}
		this.#notes.set(key, candidate)
		return candidate
	}

	retain(keys: Iterable<string>) {
		const keep = new Set(keys)
		for (const key of this.#notes.keys()) {
			if (!keep.has(key)) {
				this.#notes.delete(key)
			}
		}
	}

	clear() {
		this.#notes.clear()
	}
}

/**
 * Follows a fractional pitch with an anchor note plus pitch bend, re-anchoring (legato) when
 * the bend would exceed the receiver's bend range.
 */
export function follow(anchor: number | undefined, pitch: number, bendRange: number) {
	const range = Math.max(0.5, bendRange)
	const limit = Math.max(0.5, range - 0.5)
	const next = anchor === undefined || Math.abs(pitch - anchor) > limit ? Math.round(pitch) : anchor
	return { anchor: next, bend: clamp((pitch - next) / range, -1, 1) }
}

/** Divisions of a beat chosen by expression: higher hands play faster. */
export const DIVISIONS = [1, 2, 3, 4, 6, 8] as const
export const stepInterval = (bpm: number, expression: number) =>
	60000 / clamp(bpm, 20, 300) / DIVISIONS[Math.min(DIVISIONS.length - 1, Math.floor(clamp(expression, 0, 1) * DIVISIONS.length))]!

class Glide implements Mode {
	#anchors = new Map<string, number>()
	#settle = new Map<string, number>()

	constructor(private readonly tune = false) {}

	update(frame: ModeFrame, out: Performer) {
		const { hands, settings, tonality } = frame
		let secondary = false
		for (const hand of hands) {
			if (!ownsChannel(hand, frame)) {
				// Like a real theremin's volume loop: the other hand shapes loudness and tone.
				secondary = true
				out.control(hand.channel, CC_VOLUME, hand.gesture.expression)
				out.control(hand.channel, CC_BRIGHTNESS, 1 - hand.y)
				continue
			}
			let pitch = hand.gesture.pitch
			if (this.tune) {
				const still = clamp(1 - hand.speed / 0.6, 0, 1)
				const previous = this.#settle.get(hand.id) ?? still
				const settle = previous + (still - previous) * Math.min(1, frame.dt * 6)
				this.#settle.set(hand.id, settle)
				const target = tonality.nearest(pitch)
				pitch += (target - pitch) * settings.autotune * (0.35 + 0.65 * settle)
			}
			const { anchor, bend } = follow(this.#anchors.get(hand.id), pitch, settings.bendRange)
			this.#anchors.set(hand.id, anchor)
			out.hold(hand.id, [anchor], velocityOf(hand.gesture.expression), hand.channel)
			out.bend(hand.channel, bend)
			expressionControls(hand, out)
		}
		if (!secondary && !settings.mpe) {
			out.control(settings.channel, CC_VOLUME, 1)
		}
		const ids = new Set(hands.map((hand) => hand.id))
		for (const map of [this.#anchors, this.#settle]) {
			for (const id of map.keys()) {
				if (!ids.has(id)) {
					map.delete(id)
				}
			}
		}
	}

	reset() {
		this.#anchors.clear()
		this.#settle.clear()
	}
}

/** Sustained notes derived from each hand's snapped pitch. */
class Snapped implements Mode {
	#snapper = new Snapper()

	constructor(private readonly voicing: (note: number, frame: ModeFrame) => number[]) {}

	update(frame: ModeFrame, out: Performer) {
		for (const hand of frame.hands) {
			const note = this.#snapper.note(hand.id, hand.gesture.pitch, frame.tonality)
			out.hold(hand.id, this.voicing(note, frame), velocityOf(hand.gesture.expression), hand.channel)
			if (ownsChannel(hand, frame)) {
				expressionControls(hand, out)
			}
		}
		this.#snapper.retain(frame.hands.map((hand) => hand.id))
	}

	reset() {
		this.#snapper.clear()
	}
}

/** Left hands latch a drone (root and fifth, an octave down); right hands play the melody. */
class Drone implements Mode {
	#snapper = new Snapper()
	#root: number | undefined
	#owner: string | undefined
	#seen = new Set<string>()
	#cancelled = new Set<string>()

	update(frame: ModeFrame, out: Performer) {
		const { hands, tonality, settings } = frame
		for (const hand of hands) {
			if (hand.side !== "left") {
				const note = this.#snapper.note(hand.id, hand.gesture.pitch, tonality)
				out.hold(hand.id, [note], velocityOf(hand.gesture.expression), hand.channel)
				if (ownsChannel(hand, frame)) {
					expressionControls(hand, out)
				}
				continue
			}
			const root = this.#snapper.note(hand.id, hand.gesture.pitch, tonality, 0.35)
			if (!this.#seen.has(hand.id)) {
				this.#seen.add(hand.id)
				if (root === this.#root) {
					// Touching the latched drone again silences it.
					this.#root = undefined
					this.#cancelled.add(hand.id)
					continue
				}
				this.#owner = hand.id
			}
			if (this.#owner === hand.id && !this.#cancelled.has(hand.id)) {
				this.#root = root
			}
		}
		if (this.#root !== undefined) {
			const bass = this.#root - 12
			out.hold("drone", [bass, bass + 7, this.#root], 0.7, settings.channel)
		}
		const ids = new Set(hands.map((hand) => hand.id))
		for (const set of [this.#seen, this.#cancelled]) {
			for (const id of set) {
				if (!ids.has(id)) {
					set.delete(id)
				}
			}
		}
		this.#snapper.retain(ids)
	}

	reset() {
		this.#snapper.clear()
		this.#root = undefined
		this.#owner = undefined
		this.#seen.clear()
		this.#cancelled.clear()
	}

	status() {
		return this.#root === undefined ? "Left hand sets a drone" : `Drone on ${noteLabel(this.#root)}`
	}
}

const noteLabel = (note: number) =>
	["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][((note % 12) + 12) % 12]

interface Clocked {
	next: number
	step: number
}

/** Rhythmic modes: a clock per hand, faster as expression rises. */
class Rhythmic implements Mode {
	#snapper = new Snapper()
	#clocks = new Map<string, Clocked>()

	constructor(private readonly pattern: (note: number, step: number, frame: ModeFrame) => number) {}

	update(frame: ModeFrame, out: Performer) {
		const { hands, settings, time } = frame
		for (const hand of hands) {
			const note = this.#snapper.note(hand.id, hand.gesture.pitch, frame.tonality)
			const interval = stepInterval(settings.bpm, hand.gesture.expression)
			let clock = this.#clocks.get(hand.id)
			if (!clock) {
				clock = { next: time, step: 0 }
				this.#clocks.set(hand.id, clock)
			}
			if (time - clock.next > interval) {
				clock.next = time
			}
			let fired = 0
			while (time >= clock.next && fired++ < 4) {
				const accent = clock.step % 4 === 0 ? 1 : 0.8
				out.trigger(
					hand.id,
					this.pattern(note, clock.step, frame),
					velocityOf(hand.gesture.expression) * accent,
					interval * (0.15 + 0.85 * settings.sustain),
					hand.channel
				)
				clock.step++
				clock.next += interval
			}
			if (ownsChannel(hand, frame)) {
				expressionControls(hand, out)
			}
		}
		const ids = new Set(hands.map((hand) => hand.id))
		for (const id of this.#clocks.keys()) {
			if (!ids.has(id)) {
				this.#clocks.delete(id)
			}
		}
		this.#snapper.retain(ids)
	}

	reset() {
		this.#snapper.clear()
		this.#clocks.clear()
	}
}

const arpeggio = (note: number, step: number, frame: ModeFrame) => {
	const chord = frame.tonality.chord(note, frame.settings.chord)
	const run = [...chord, ...chord.map((n) => n + 12)]
	const cycle = run.length * 2 - 2
	const position = step % cycle
	return run[position < run.length ? position : cycle - position]!
}

/** Strum across the scale's strings: every string a hand crosses is plucked. */
class Strum implements Mode {
	#positions = new Map<string, number>()

	update(frame: ModeFrame, out: Performer) {
		const { hands, tonality, settings } = frame
		const duration = 250 + settings.sustain * 2500
		for (const hand of hands) {
			const position = tonality.positionOf(hand.gesture.pitch)
			const previous = this.#positions.get(hand.id)
			this.#positions.set(hand.id, position)
			const velocity = clamp(0.35 + hand.speed * 0.4, 0.2, 1) * (0.5 + 0.5 * hand.gesture.expression)
			if (previous === undefined) {
				out.trigger(hand.id, tonality.nearest(hand.gesture.pitch), velocity, duration, hand.channel)
				continue
			}
			const low = Math.min(previous, position)
			const high = Math.max(previous, position)
			const crossed = tonality.notes.filter((note) => {
				const string = tonality.positionOf(note)
				return previous < position ? string > low && string <= high : string >= low && string < high
			})
			for (const note of (previous < position ? crossed : crossed.reverse()).slice(0, 12)) {
				out.trigger(hand.id, note, velocity, duration, hand.channel)
			}
			if (ownsChannel(hand, frame)) {
				expressionControls(hand, out)
			}
		}
		const ids = new Set(hands.map((hand) => hand.id))
		for (const id of this.#positions.keys()) {
			if (!ids.has(id)) {
				this.#positions.delete(id)
			}
		}
	}

	reset() {
		this.#positions.clear()
	}
}

export const MODES: readonly Definition<Mode>[] = [
	{
		id: "glide",
		name: "Theremin glide",
		description:
			"Continuous pitch with pitch bend. Without MPE the second hand works the volume loop.",
		create: () => new Glide()
	},
	{
		id: "autotune",
		name: "Autotune glide",
		description: "Glides freely while moving and settles into the scale when the hand rests.",
		create: () => new Glide(true)
	},
	{
		id: "snap",
		name: "Scale notes",
		description: "Each hand plays the nearest note of the chosen scale.",
		create: () => new Snapped((note) => [note])
	},
	{
		id: "harmony",
		name: "Close harmony",
		description: "Melody on top with diatonic thirds below it.",
		create: () =>
			new Snapped((note, frame) => [note, frame.tonality.step(note, -2), frame.tonality.step(note, -4)])
	},
	{
		id: "chords",
		name: "Chords",
		description: "Each hand holds a diatonic chord built on the scale degree under it.",
		create: () => new Snapped((note, frame) => frame.tonality.chord(note, frame.settings.chord))
	},
	{
		id: "arpeggio",
		name: "Arpeggiator",
		description: "Arpeggiates the chord under each hand; raise the hand to play faster.",
		create: () => new Rhythmic(arpeggio)
	},
	{
		id: "pulse",
		name: "Pulse",
		description: "Repeats the note under each hand in time; raise the hand to subdivide.",
		create: () => new Rhythmic((note) => note)
	},
	{
		id: "strum",
		name: "Strum",
		description: "Sweep across the scale like strings; faster sweeps pluck harder.",
		create: () => new Strum()
	},
	{
		id: "drone",
		name: "Drone and melody",
		description: "Left hands latch a drone, right hands play a melody over it.",
		create: () => new Drone()
	}
]

export function findMode(id: string | null | undefined) {
	return MODES.find((mode) => mode.id === id) ?? MODES[0]!
}
