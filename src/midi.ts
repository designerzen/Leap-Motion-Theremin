/**
 * MIDI 2.0 Universal MIDI Packet encoding, matching HarmonEasy's instrument event contract
 * (packages/audiobus/ui/interfaces/instrument.ts) so that any HarmonEasy InputWebComponent
 * host can forward these events without translation.
 */

export const NOTE_ON = "noteOn"
export const NOTE_OFF = "noteOff"
export const PITCH_BEND = "pitchBend"
export const CONTROL_CHANGE = "controlChange"
export const EVENT_INSTRUMENT_DISCONNECT = "instrumentDisconnect"
export const EVENT_INSTRUMENT_CHANGE = "instrumentChange"

export const CC_MODULATION = 1
export const CC_VOLUME = 7
export const CC_EXPRESSION = 11
export const CC_BRIGHTNESS = 74

export type UMP64 = readonly [number, number]

export interface MIDIAddress {
	readonly group: number
	readonly channel: number
}

export interface InstrumentNote {
	readonly noteNumber: number
	readonly noteKey: string
	readonly noteName: string
	readonly octave: number
	readonly frequency: number
}

export interface NoteDetail extends MIDIAddress {
	readonly note: InstrumentNote
	readonly velocity: number
	readonly velocity16: number
	readonly id: number
	readonly isMidi: false
	readonly ump: UMP64
}

export interface PitchBendDetail extends MIDIAddress {
	readonly value: number
	readonly value32: number
	readonly ump: UMP64
}

export interface ControlChangeDetail extends MIDIAddress {
	readonly controller: number
	readonly value: number
	readonly value32: number
	readonly ump: UMP64
}

export const NOTE_KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const

export const clamp = (value: number, min: number, max: number) =>
	Math.max(min, Math.min(max, value))

export function noteName(noteNumber: number) {
	const note = Math.round(noteNumber)
	return NOTE_KEYS[((note % 12) + 12) % 12]! + (Math.floor(note / 12) - 1)
}

export function frequency(pitch: number) {
	return 440 * 2 ** ((pitch - 69) / 12)
}

export function instrumentNote(noteNumber: number): InstrumentNote {
	const number = clamp(Math.round(noteNumber), 0, 127)
	const noteKey = NOTE_KEYS[number % 12]!
	const octave = Math.floor(number / 12) - 1
	return Object.freeze({
		noteNumber: number,
		noteKey,
		octave,
		noteName: noteKey + octave,
		frequency: frequency(number)
	})
}

/** MIDI 2.0 channel voice header (message type 4). Group and channel are zero based. */
export function midi2Header(status: number, address: MIDIAddress) {
	return (0x40000000 | (address.group << 24) | (status << 20) | (address.channel << 16)) >>> 0
}

export function noteDetail(
	type: typeof NOTE_ON | typeof NOTE_OFF,
	noteNumber: number,
	velocity: number,
	id: number,
	address: MIDIAddress
): NoteDetail {
	const note = instrumentNote(noteNumber)
	const level = clamp(velocity, 0, 1)
	const velocity16 = Math.round(level * 0xffff)
	const ump: UMP64 = Object.freeze([
		(midi2Header(type === NOTE_ON ? 9 : 8, address) | (note.noteNumber << 8)) >>> 0,
		(velocity16 << 16) >>> 0
	])
	return Object.freeze({
		group: address.group,
		channel: address.channel,
		note,
		velocity: level,
		velocity16,
		id,
		isMidi: false,
		ump
	})
}

/** Normalised bend: -1 is full down, 0 centre, 1 full up. */
export function pitchBendDetail(value: number, address: MIDIAddress): PitchBendDetail {
	const bend = clamp(value, -1, 1)
	const value32 = Math.round(bend < 0 ? (bend + 1) * 0x80000000 : 0x80000000 + bend * 0x7fffffff)
	return Object.freeze({
		group: address.group,
		channel: address.channel,
		value: bend,
		value32,
		ump: Object.freeze([midi2Header(0xe, address), value32]) as UMP64
	})
}

export function controlChangeDetail(
	controller: number,
	value: number,
	address: MIDIAddress
): ControlChangeDetail {
	const level = clamp(value, 0, 1)
	const value32 = Math.round(level * 0xffffffff)
	return Object.freeze({
		group: address.group,
		channel: address.channel,
		controller,
		value: level,
		value32,
		ump: Object.freeze([
			(midi2Header(0xb, address) | (controller << 8)) >>> 0,
			value32
		]) as UMP64
	})
}
