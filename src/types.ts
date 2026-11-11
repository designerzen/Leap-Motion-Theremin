import type { ChordShape, Tonality } from "./scales.ts"

export type HandSource = "pointer" | "keyboard" | "leap" | "camera"
export type HandSide = "left" | "right"

/** A tracked hand (or pointer) in normalised screen space: x right, y down, z away. */
export interface Hand {
	id: string
	source: HandSource
	side: HandSide
	x: number
	y: number
	/** Push: pressure, or how far the hand reaches towards the screen or sensor, 0..1. */
	z: number
	/** Fist closure, 0..1. */
	grab: number
	/** Thumb to index pinch, 0..1. */
	pinch: number
	/** Palm roll, -1..1. */
	roll: number
	/** Whether this hand should sound (pointer pressed, hand present, pinch held...). */
	active: boolean
	/** Timestamp (ms) when this hand was first seen. */
	born: number
}

/** What a surface makes of a hand: a fractional MIDI pitch and an expression amount. */
export interface Gesture {
	pitch: number
	expression: number
}

export interface PlayingHand extends Hand {
	gesture: Gesture
	/** Normalised units per second. */
	speed: number
	/** The hand that leads melody (and owns pitch bend when not in MPE). */
	lead: boolean
	/** MIDI channel this hand plays on. */
	channel: number
}

export interface PerformanceSettings {
	bendRange: number
	mpe: boolean
	channel: number
	chord: ChordShape
	bpm: number
	autotune: number
	sustain: number
}

export interface ModeFrame {
	hands: PlayingHand[]
	tonality: Tonality
	settings: PerformanceSettings
	/** Milliseconds, from performance.now(). */
	time: number
	/** Seconds since the previous frame. */
	dt: number
}

/** Declarative output: modes describe what should sound each frame, the element reconciles. */
export interface Performer {
	/** Sustain these notes under the given voice key until a later frame omits them. */
	hold(key: string, notes: readonly number[], velocity: number, channel: number): void
	/** Fire and forget a note for a duration in milliseconds, credited to a voice key. */
	trigger(key: string, note: number, velocity: number, duration: number, channel: number): void
	bend(channel: number, value: number): void
	control(channel: number, controller: number, value: number): void
}

export interface Mode {
	update(frame: ModeFrame, out: Performer): void
	reset(): void
	/** Short status line for the heads up display, e.g. the latched drone. */
	status?(): string
}

export interface NoteEvent {
	note: number
	velocity: number
	time: number
	x: number
	y: number
	handId: string
}

export interface Theme {
	background: string
	foreground: string
	muted: string
	accent: string
	font: string
}

export interface DrawHand extends PlayingHand {
	/** Notes currently sounding for this hand. */
	notes: readonly number[]
	/** Pixel position on the canvas. */
	px: number
	py: number
}

export interface DrawFrame {
	g: CanvasRenderingContext2D
	width: number
	height: number
	time: number
	dt: number
	tonality: Tonality
	/** Every visible hand, including hovering ones that are not sounding. */
	hands: readonly DrawHand[]
	/** Recent note-ons, newest last. */
	events: readonly NoteEvent[]
	theme: Theme
	reducedMotion: boolean
	/** Time domain samples (-1..1) when an analyser is attached, otherwise undefined. */
	waveform?: Float32Array
}

export interface Surface {
	/** Called with the canvas size in CSS pixels before mapping or drawing when it changes. */
	resize?(width: number, height: number): void
	map(hand: Hand, tonality: Tonality): Gesture
	draw(frame: DrawFrame): void
}

export interface Definition<T> {
	id: string
	name: string
	description: string
	create(): T
}
