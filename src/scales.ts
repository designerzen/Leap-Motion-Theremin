import { clamp, NOTE_KEYS } from "./midi.ts"

export interface ScaleDefinition {
	id: string
	name: string
	intervals: readonly number[]
}

export const SCALES: readonly ScaleDefinition[] = [
	{ id: "chromatic", name: "Chromatic", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
	{ id: "major", name: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
	{ id: "minor", name: "Natural minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
	{ id: "harmonic-minor", name: "Harmonic minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
	{ id: "dorian", name: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
	{ id: "phrygian", name: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10] },
	{ id: "lydian", name: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
	{ id: "mixolydian", name: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
	{ id: "pentatonic-major", name: "Major pentatonic", intervals: [0, 2, 4, 7, 9] },
	{ id: "pentatonic-minor", name: "Minor pentatonic", intervals: [0, 3, 5, 7, 10] },
	{ id: "blues", name: "Blues", intervals: [0, 3, 5, 6, 7, 10] },
	{ id: "whole-tone", name: "Whole tone", intervals: [0, 2, 4, 6, 8, 10] },
	{ id: "hirajoshi", name: "Hirajoshi", intervals: [0, 2, 3, 7, 8] },
	{ id: "hijaz", name: "Hijaz", intervals: [0, 1, 4, 5, 7, 8, 10] }
]

export function findScale(id: string | null | undefined) {
	return SCALES.find((scale) => scale.id === id) ?? SCALES[1]!
}

export function parseKey(value: string | null | undefined) {
	if (!value) {
		return 0
	}
	const numeric = Number(value)
	if (Number.isInteger(numeric)) {
		return ((numeric % 12) + 12) % 12
	}
	const normalised = value.trim().toUpperCase().replace("♯", "#").replace("♭", "B")
	const flats: Record<string, string> = { DB: "C#", EB: "D#", GB: "F#", AB: "G#", BB: "A#" }
	const index = NOTE_KEYS.indexOf((flats[normalised] ?? normalised) as (typeof NOTE_KEYS)[number])
	return index < 0 ? 0 : index
}

/**
 * The musical frame every mode and surface works within: a key, scale and playable range.
 * Pitches are fractional MIDI note numbers so continuous gestures keep their nuance.
 */
export class Tonality {
	readonly notes: readonly number[]

	constructor(
		readonly key: number,
		readonly scale: ScaleDefinition,
		readonly low: number,
		readonly high: number
	) {
		const notes: number[] = []
		for (let note = Math.ceil(low); note <= Math.floor(high); note++) {
			if (this.inScale(note)) {
				notes.push(note)
			}
		}
		this.notes = notes.length ? notes : [Math.round(low)]
	}

	get span() {
		return Math.max(1, this.high - this.low)
	}

	inScale(note: number) {
		const pitchClass = (((Math.round(note) - this.key) % 12) + 12) % 12
		return this.scale.intervals.includes(pitchClass)
	}

	/** Continuous position 0..1 across the range to a fractional pitch. */
	pitchAt(position: number) {
		return this.low + clamp(position, 0, 1) * this.span
	}

	positionOf(pitch: number) {
		return (pitch - this.low) / this.span
	}

	/** Index of the nearest scale note within the range. */
	indexOf(pitch: number) {
		let best = 0
		for (let index = 1; index < this.notes.length; index++) {
			if (Math.abs(this.notes[index]! - pitch) < Math.abs(this.notes[best]! - pitch)) {
				best = index
			}
		}
		return best
	}

	nearest(pitch: number) {
		return this.notes[this.indexOf(pitch)]!
	}

	/** Snap to the scale anywhere (not limited to the range), used for harmony above or below it. */
	snap(pitch: number) {
		const rounded = Math.round(pitch)
		for (let distance = 0; distance < 12; distance++) {
			for (const candidate of [rounded - distance, rounded + distance]) {
				if (this.inScale(candidate)) {
					return candidate
				}
			}
		}
		return rounded
	}

	/** Move a scale note by a number of scale steps, which may leave the range. */
	step(note: number, steps: number) {
		const size = this.scale.intervals.length
		const relative = this.snap(note) - this.key
		const octave = Math.floor(relative / 12)
		const degree = this.scale.intervals.indexOf(((relative % 12) + 12) % 12)
		const target = degree + steps
		const wrapped = ((target % size) + size) % size
		const octaves = octave + Math.floor(target / size)
		return this.key + octaves * 12 + this.scale.intervals[wrapped]!
	}

	/** Diatonic chord built by stacking scale thirds on the given root. */
	chord(root: number, shape: ChordShape) {
		const base = this.snap(root)
		switch (shape) {
			case "power":
				return [base, base + 7, base + 12]
			case "sus":
				return [base, this.step(base, 3), this.step(base, 4)]
			case "seventh":
				return [base, this.step(base, 2), this.step(base, 4), this.step(base, 6)]
			case "ninth":
				return [
					base,
					this.step(base, 2),
					this.step(base, 4),
					this.step(base, 6),
					this.step(base, 8)
				]
			default:
				return [base, this.step(base, 2), this.step(base, 4)]
		}
	}
}

export const CHORD_SHAPES = ["triad", "seventh", "ninth", "sus", "power"] as const
export type ChordShape = (typeof CHORD_SHAPES)[number]

export const toMidi = (note: number) => clamp(Math.round(note), 0, 127)
