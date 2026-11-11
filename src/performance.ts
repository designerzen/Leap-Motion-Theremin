import { clamp } from "./midi.ts"
import type { Performer } from "./types.ts"

/** Where reconciled events go: in practice the custom element's MIDI 2.0 event dispatch. */
export interface Emitter {
	noteOn(note: number, velocity: number, id: number, channel: number, key: string): void
	noteOff(note: number, id: number, channel: number): void
	bend(channel: number, value: number): void
	control(channel: number, controller: number, value: number): void
}

interface Sounding {
	note: number
	id: number
	channel: number
}

interface Triggered extends Sounding {
	key: string
	until: number
}

interface Held {
	notes: number[]
	velocity: number
	channel: number
}

const BEND_RESOLUTION = 1 / 8192
const CONTROL_RESOLUTION = 1 / 1024

/**
 * Turns each frame's declarative description of what should sound into the minimal stream of
 * note, bend and controller events. New notes start before old ones end so legato survives.
 */
export class Performance implements Performer {
	#held = new Map<string, Sounding[]>()
	#triggered: Triggered[] = []
	#bends = new Map<number, number>()
	#controls = new Map<string, number>()
	#wantHeld = new Map<string, Held>()
	#wantBends = new Map<number, number>()
	#wantControls = new Map<string, number>()
	#time = 0
	#id = 0

	constructor(private readonly emit: Emitter) {}

	begin(time: number) {
		this.#time = time
		this.#wantHeld.clear()
		this.#wantBends.clear()
		this.#wantControls.clear()
	}

	hold(key: string, notes: readonly number[], velocity: number, channel: number) {
		const valid = notes.filter((note) => note >= 0 && note <= 127).map(Math.round)
		const existing = this.#wantHeld.get(key)
		if (existing && existing.channel === channel) {
			existing.notes.push(...valid)
			return
		}
		this.#wantHeld.set(key, { notes: valid, velocity: clamp(velocity, 0, 1), channel })
	}

	trigger(key: string, note: number, velocity: number, duration: number, channel: number) {
		const number = Math.round(note)
		if (number < 0 || number > 127) {
			return
		}
		const index = this.#triggered.findIndex(
			(voice) => voice.note === number && voice.channel === channel
		)
		if (index >= 0) {
			const [previous] = this.#triggered.splice(index, 1)
			this.emit.noteOff(previous!.note, previous!.id, previous!.channel)
		}
		const id = ++this.#id
		this.emit.noteOn(number, clamp(velocity, 0, 1), id, channel, key)
		this.#triggered.push({ note: number, id, channel, key, until: this.#time + Math.max(10, duration) })
	}

	bend(channel: number, value: number) {
		this.#wantBends.set(channel, clamp(value, -1, 1))
	}

	control(channel: number, controller: number, value: number) {
		this.#wantControls.set(`${channel}:${controller}`, clamp(value, 0, 1))
	}

	commit() {
		for (const [channel, value] of this.#wantBends) {
			const sent = this.#bends.get(channel)
			if (sent === undefined || Math.abs(sent - value) >= BEND_RESOLUTION) {
				this.#bends.set(channel, value)
				this.emit.bend(channel, value)
			}
		}
		for (const [channel, sent] of this.#bends) {
			if (!this.#wantBends.has(channel)) {
				this.#bends.delete(channel)
				if (sent !== 0) {
					this.emit.bend(channel, 0)
				}
			}
		}
		for (const [address, value] of this.#wantControls) {
			const sent = this.#controls.get(address)
			if (sent === undefined || Math.abs(sent - value) >= CONTROL_RESOLUTION) {
				this.#controls.set(address, value)
				const [channel, controller] = address.split(":").map(Number)
				this.emit.control(channel!, controller!, value)
			}
		}
		for (const [key, want] of this.#wantHeld) {
			const current = this.#held.get(key) ?? []
			const notes = [...new Set(want.notes)]
			const keep: Sounding[] = []
			const release: Sounding[] = []
			for (const voice of current) {
				;(voice.channel === want.channel && notes.includes(voice.note) ? keep : release).push(voice)
			}
			for (const note of notes) {
				if (!keep.some((voice) => voice.note === note)) {
					const id = ++this.#id
					this.emit.noteOn(note, want.velocity, id, want.channel, key)
					keep.push({ note, id, channel: want.channel })
				}
			}
			for (const voice of release) {
				this.emit.noteOff(voice.note, voice.id, voice.channel)
			}
			this.#held.set(key, keep)
		}
		for (const [key, voices] of this.#held) {
			if (!this.#wantHeld.has(key)) {
				for (const voice of voices) {
					this.emit.noteOff(voice.note, voice.id, voice.channel)
				}
				this.#held.delete(key)
			}
		}
		this.#triggered = this.#triggered.filter((voice) => {
			if (voice.until > this.#time) {
				return true
			}
			this.emit.noteOff(voice.note, voice.id, voice.channel)
			return false
		})
	}

	/** Notes currently sounding for a voice key, for display. */
	notesFor(key: string) {
		return [
			...(this.#held.get(key) ?? []).map((voice) => voice.note),
			...this.#triggered.filter((voice) => voice.key === key).map((voice) => voice.note)
		]
	}

	get sounding() {
		const notes = new Set<number>()
		for (const voices of this.#held.values()) {
			for (const voice of voices) {
				notes.add(voice.note)
			}
		}
		for (const voice of this.#triggered) {
			notes.add(voice.note)
		}
		return [...notes].sort((a, b) => a - b)
	}

	releaseAll() {
		for (const voices of this.#held.values()) {
			for (const voice of voices) {
				this.emit.noteOff(voice.note, voice.id, voice.channel)
			}
		}
		for (const voice of this.#triggered) {
			this.emit.noteOff(voice.note, voice.id, voice.channel)
		}
		for (const [channel, value] of this.#bends) {
			if (value !== 0) {
				this.emit.bend(channel, 0)
			}
		}
		this.#held.clear()
		this.#triggered = []
		this.#bends.clear()
		this.#wantHeld.clear()
		this.#wantBends.clear()
	}
}
