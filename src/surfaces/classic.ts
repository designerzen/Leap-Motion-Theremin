import { clamp, frequency, noteName } from "../midi.ts"
import type { Tonality } from "../scales.ts"
import type { DrawFrame, Gesture, Hand, Surface } from "../types.ts"
import { fade, hsl, hueFor, isRoot, label, linear, scaleLabels, soundingNotes, strikeEnergy, fromX, MARGIN, toX } from "./common.ts"

/** The original instrument: a pitch antenna on the right, a volume loop on the left. */
export class Aether implements Surface {
	map = linear

	draw(frame: DrawFrame) {
		const { g, width, height, tonality, hands, time, theme } = frame
		fade(frame, 0.35)
		const antennaX = width - 18
		const centreY = height * 0.5
		// Equipotential field lines centred on the antenna, one per scale note.
		g.lineWidth = 1
		for (const note of tonality.notes) {
			const x = toX(tonality.positionOf(note), width)
			const radius = antennaX - x
			if (radius <= 2) {
				continue
			}
			g.beginPath()
			for (let step = 0; step <= 48; step++) {
				const angle = Math.PI * (0.5 + step / 48)
				let px = antennaX + Math.cos(angle) * radius
				let py = centreY + Math.sin(angle) * radius * (height / width) * 1.6
				for (const hand of hands) {
					const distance = Math.hypot(px - hand.px, py - hand.py)
					const pull = (hand.active ? 26 : 10) * Math.exp(-distance / 60)
					px += ((hand.px - px) / (distance + 1)) * pull
					py += ((hand.py - py) / (distance + 1)) * pull
				}
				step === 0 ? g.moveTo(px, py) : g.lineTo(px, py)
			}
			const energy = strikeEnergy(frame, note)
			g.strokeStyle = isRoot(tonality, note)
				? hsl(hueFor(note), 70, 60, 0.35 + energy * 0.6)
				: hsl(200, 30, 60, 0.08 + energy * 0.6)
			g.stroke()
		}
		// Pitch antenna.
		const rod = g.createLinearGradient(antennaX - 4, 0, antennaX + 4, 0)
		rod.addColorStop(0, "#5b6170")
		rod.addColorStop(0.5, "#e9edf5")
		rod.addColorStop(1, "#4a4f5c")
		g.fillStyle = rod
		g.fillRect(antennaX - 3, height * 0.08, 6, height * 0.84)
		// Volume loop.
		g.strokeStyle = "#c9ced9"
		g.lineWidth = 4
		g.beginPath()
		g.ellipse(46, height - 30, 34, 10, 0, 0, Math.PI * 2)
		g.stroke()
		// Sounding hands radiate a waveform to the antenna.
		for (const hand of hands) {
			if (!hand.notes.length) {
				continue
			}
			const cycles = clamp(frequency(hand.gesture.pitch) / 40, 2, 60)
			g.beginPath()
			for (let x = hand.px; x <= antennaX; x += 3) {
				const t = (x - hand.px) / Math.max(1, antennaX - hand.px)
				const y =
					hand.py +
					(centreY - hand.py) * t * t +
					Math.sin(t * cycles * Math.PI * 2 - time / 90) * 10 * hand.gesture.expression * (1 - t)
				x === hand.px ? g.moveTo(x, y) : g.lineTo(x, y)
			}
			g.strokeStyle = hsl(hueFor(hand.gesture.pitch), 90, 65, 0.8)
			g.lineWidth = 2
			g.stroke()
		}
		scaleLabels(frame, height - 10)
		label(frame, "pitch", antennaX - 6, height * 0.05, { align: "right", colour: theme.muted })
		label(frame, "volume", 46, height - 48, { colour: theme.muted })
	}
}

/** A harp of scale strings that ring when struck and shimmer under a hovering hand. */
export class Strings implements Surface {
	map = linear
	#energy = new Map<number, number>()
	#phase = new Map<number, number>()

	draw(frame: DrawFrame) {
		const { g, width, height, tonality, hands, dt, events, time } = frame
		fade(frame, frame.reducedMotion ? 1 : 0.6)
		for (const event of events) {
			if (time - event.time < dt * 1000 + 1) {
				this.#energy.set(event.note, Math.max(this.#energy.get(event.note) ?? 0, event.velocity))
			}
		}
		const lit = soundingNotes(frame)
		const top = height * 0.06
		const bottom = height - 26
		for (const note of tonality.notes) {
			const x = toX(tonality.positionOf(note), width)
			let energy = (this.#energy.get(note) ?? 0) * Math.exp(-dt * 1.8)
			if (lit.has(note)) {
				energy = Math.max(energy, 0.35)
			}
			this.#energy.set(note, energy)
			const phase = (this.#phase.get(note) ?? 0) + dt * clamp(frequency(note) / 8, 6, 60)
			this.#phase.set(note, phase)
			const amplitude = frame.reducedMotion ? 0 : energy * 9
			g.beginPath()
			for (let step = 0; step <= 32; step++) {
				const t = step / 32
				const y = top + (bottom - top) * t
				let bow = Math.sin(t * Math.PI) * Math.sin(phase) * amplitude
				for (const hand of hands) {
					if (!hand.notes.length) {
						const near = Math.exp(-Math.abs(hand.px - x) / 14) * Math.exp(-Math.abs(hand.py - y) / 50)
						bow += near * 6 * Math.sign(hand.px - x || 1)
					}
				}
				step === 0 ? g.moveTo(x + bow, y) : g.lineTo(x + bow, y)
			}
			const root = isRoot(tonality, note)
			g.strokeStyle = energy > 0.01
				? hsl(hueFor(note), 90, 55 + energy * 25, 0.5 + energy * 0.5)
				: root
					? "rgba(220, 200, 160, 0.7)"
					: "rgba(200, 205, 215, 0.35)"
			g.lineWidth = root ? 2.2 : 1.2 + energy * 2
			g.stroke()
		}
		// Bridge and pins.
		g.fillStyle = "rgba(190, 150, 100, 0.55)"
		g.fillRect(0, top - 4, width, 3)
		g.fillRect(0, bottom + 1, width, 3)
		scaleLabels(frame, height - 12)
	}
}

/** An Ondes Martenot style ribbon over a keyboard: trace pitch with continuous trails. */
export class Ribbon implements Surface {
	map(hand: Hand, tonality: Tonality): Gesture {
		// The keyboard strip along the bottom is the quietest part of the field.
		return { pitch: tonality.pitchAt(fromX(hand.x)), expression: clamp(1 - hand.y / 0.76, 0, 1) }
	}
	#trails = new Map<string, { x: number; y: number; hue: number }[]>()

	draw(frame: DrawFrame) {
		const { g, width, height, tonality, hands, theme } = frame
		fade(frame, 1)
		const keysTop = height * 0.76
		const keyWidth = (width * (1 - 2 * MARGIN)) / tonality.span
		const lit = soundingNotes(frame)
		// Field grid: a faint column per semitone, stronger for scale notes.
		for (let note = Math.ceil(tonality.low); note <= tonality.high; note++) {
			const x = toX(tonality.positionOf(note), width)
			g.fillStyle = tonality.inScale(note) ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.015)"
			g.fillRect(x - 0.5, 0, 1, keysTop)
		}
		for (let row = 1; row < 4; row++) {
			g.fillStyle = "rgba(255,255,255,0.04)"
			g.fillRect(0, (keysTop * row) / 4, width, 1)
		}
		// Keyboard.
		for (let note = Math.ceil(tonality.low); note <= Math.floor(tonality.high); note++) {
			const x = toX(tonality.positionOf(note), width) - keyWidth / 2
			const black = [1, 3, 6, 8, 10].includes(((note % 12) + 12) % 12)
			const on = lit.has(note)
			g.fillStyle = on
				? hsl(hueFor(note), 85, 60)
				: black
					? "#1a1c24"
					: tonality.inScale(note)
						? "#e8e6df"
						: "#a9a7a1"
			g.fillRect(x + 1, black ? keysTop : keysTop + 4, keyWidth - 2, height - keysTop - (black ? 18 : 4))
			if (isRoot(tonality, note) && keyWidth > 9) {
				label(frame, noteName(note), x + keyWidth / 2, height - 10, {
					colour: black || on ? theme.foreground : "#20232c",
					size: 9
				})
			}
		}
		// Ring trails.
		const live = new Set<string>()
		for (const hand of hands) {
			live.add(hand.id)
			const trail = this.#trails.get(hand.id) ?? []
			trail.push({ x: hand.px, y: Math.min(hand.py, keysTop - 4), hue: hueFor(hand.gesture.pitch) })
			if (trail.length > 48) {
				trail.shift()
			}
			this.#trails.set(hand.id, trail)
			if (!hand.notes.length) {
				continue
			}
			g.lineCap = "round"
			for (let index = 1; index < trail.length; index++) {
				const a = trail[index - 1]!
				const b = trail[index]!
				g.strokeStyle = hsl(b.hue, 90, 62, index / trail.length)
				g.lineWidth = 1 + (index / trail.length) * 6 * hand.gesture.expression
				g.beginPath()
				g.moveTo(a.x, a.y)
				g.lineTo(b.x, b.y)
				g.stroke()
			}
			g.fillStyle = hsl(hueFor(hand.gesture.pitch), 90, 70, 0.6)
			g.fillRect(hand.px - 1, 0, 2, keysTop)
		}
		for (const id of this.#trails.keys()) {
			if (!live.has(id)) {
				this.#trails.delete(id)
			}
		}
	}
}
