import { clamp, noteName } from "../midi.ts"
import type { Tonality } from "../scales.ts"
import type { DrawFrame, Gesture, Hand } from "../types.ts"

/** Circle of fifths colouring: harmonically close notes get neighbouring hues. */
export const hueFor = (pitch: number) => ((((Math.round(pitch) * 7) % 12) + 12) % 12) * 30

export const hsl = (hue: number, saturation: number, lightness: number, alpha = 1) =>
	`hsl(${hue.toFixed(1)} ${saturation}% ${lightness}% / ${alpha})`

/** Keep the lowest and highest notes off the very edges, where they are hard to reach and read. */
export const MARGIN = 0.03

/** Horizontal pixel position of a 0..1 position across the range. */
export const toX = (position: number, width: number) => (MARGIN + position * (1 - 2 * MARGIN)) * width

/** Range position (0..1) under a normalised horizontal coordinate. */
export const fromX = (x: number) => clamp((x - MARGIN) / (1 - 2 * MARGIN), 0, 1)

/** The default mapping: pitch rises left to right, expression rises with the hand. */
export const linear = (hand: Hand, tonality: Tonality): Gesture => ({
	pitch: tonality.pitchAt(fromX(hand.x)),
	expression: clamp(1 - hand.y, 0, 1)
})

/** Paint over the previous frame with a translucent background, leaving motion trails. */
export function fade(frame: DrawFrame, amount: number) {
	const { g, width, height, theme, reducedMotion } = frame
	g.save()
	g.globalCompositeOperation = "source-over"
	g.globalAlpha = reducedMotion ? 1 : clamp(amount, 0, 1)
	g.fillStyle = theme.background
	g.fillRect(0, 0, width, height)
	g.restore()
}

export function clear(frame: DrawFrame) {
	fade(frame, 1)
}

/** Which notes are sounding anywhere, for highlighting. */
export const soundingNotes = (frame: DrawFrame) =>
	new Set(frame.hands.flatMap((hand) => hand.notes as number[]))

/** Most recent energy for a note from note-on events: 1 when struck, decaying to 0. */
export function strikeEnergy(frame: DrawFrame, note: number, decay = 700) {
	let energy = 0
	for (const event of frame.events) {
		if (event.note === note) {
			energy = Math.max(energy, event.velocity * clamp(1 - (frame.time - event.time) / decay, 0, 1))
		}
	}
	return energy
}

export function label(
	frame: DrawFrame,
	text: string,
	x: number,
	y: number,
	options: { colour?: string; size?: number; align?: CanvasTextAlign; baseline?: CanvasTextBaseline } = {}
) {
	const { g, theme } = frame
	g.save()
	g.font = `${options.size ?? 11}px ${theme.font}`
	g.textAlign = options.align ?? "center"
	g.textBaseline = options.baseline ?? "middle"
	g.fillStyle = options.colour ?? theme.muted
	g.fillText(text, x, y)
	g.restore()
}

/** Note names along an edge for every scale note in a linear pitch layout. */
export function scaleLabels(frame: DrawFrame, y: number) {
	const { tonality, width } = frame
	const spacing = width / Math.max(1, tonality.notes.length)
	const every = spacing < 22 ? Math.ceil(22 / spacing) : 1
	const lit = soundingNotes(frame)
	tonality.notes.forEach((note, index) => {
		const isRoot = ((note - tonality.key) % 12 + 12) % 12 === 0
		if (index % every && !isRoot && !lit.has(note)) {
			return
		}
		label(frame, noteName(note), toX(tonality.positionOf(note), width), y, {
			colour: lit.has(note) ? hsl(hueFor(note), 90, 70) : isRoot ? frame.theme.foreground : frame.theme.muted,
			size: isRoot ? 12 : 10
		})
	})
}

export const isRoot = (tonality: Tonality, note: number) => ((note - tonality.key) % 12 + 12) % 12 === 0
