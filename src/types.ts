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
	/**
	 * Finger joints when the source tracks them (Leap Motion, camera): 21 points as x, y, z
	 * triples in the same space as x, y and z above, in the order of JOINT_NAMES.
	 */
	joints?: Float32Array
}

/** MediaPipe's 21 point hand topology; Leap bones are mapped onto the same indices. */
export const JOINT_NAMES = [
	"wrist",
	"thumb-cmc", "thumb-mcp", "thumb-ip", "thumb-tip",
	"index-mcp", "index-pip", "index-dip", "index-tip",
	"middle-mcp", "middle-pip", "middle-dip", "middle-tip",
	"ring-mcp", "ring-pip", "ring-dip", "ring-tip",
	"pinky-mcp", "pinky-pip", "pinky-dip", "pinky-tip"
] as const

export const JOINT_COUNT = JOINT_NAMES.length

/** Pairs of joint indices that a bone connects, finger by finger then across the palm. */
export const HAND_BONES: readonly (readonly [number, number])[] = [
	[0, 1], [1, 2], [2, 3], [3, 4],
	[0, 5], [5, 6], [6, 7], [7, 8],
	[9, 10], [10, 11], [11, 12],
	[13, 14], [14, 15], [15, 16],
	[0, 17], [17, 18], [18, 19], [19, 20],
	[5, 9], [9, 13], [13, 17]
]

/** Joints that outline the palm, in order, for a filled palm shape. */
export const PALM_OUTLINE: readonly number[] = [0, 1, 5, 9, 13, 17]

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
	/**
	 * For surfaces that declare `gl`: a WebGL2 context on a canvas beneath `g`. The 2D context is
	 * then a transparent overlay for labels and the hand cursors. Absent when WebGL2 is unavailable,
	 * in which case the surface should draw a 2D fallback.
	 */
	gl?: WebGL2RenderingContext
	/** Device pixel size of the WebGL canvas (`width` and `height` are CSS pixels). */
	pixelRatio: number
}

export interface Surface {
	/** Draw in 3D: the element supplies a WebGL2 canvas beneath the 2D overlay. */
	readonly gl?: boolean
	/** Called with the canvas size in CSS pixels before mapping or drawing when it changes. */
	resize?(width: number, height: number): void
	map(hand: Hand, tonality: Tonality): Gesture
	draw(frame: DrawFrame): void
	/** Release GPU resources when the surface is swapped out or the element is removed. */
	dispose?(): void
}

export interface Definition<T> {
	id: string
	name: string
	description: string
	/** Names of the settings controls that matter for this item, shown when it is selected. */
	settings?: readonly string[]
	create(): T
}
