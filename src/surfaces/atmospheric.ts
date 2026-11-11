import { clamp, frequency, noteName } from "../midi.ts"
import type { Tonality } from "../scales.ts"
import type { DrawFrame, Gesture, Hand, Surface } from "../types.ts"
import { fade, hsl, hueFor, isRoot, label, linear, scaleLabels, toX } from "./common.ts"

/** Seeded random numbers so decorative layouts stay put between frames. */
function random(seed: number) {
	let state = seed >>> 0
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0
		return state / 0x100000000
	}
}

/** A particle cloud that swirls around sounding hands. Pitch rises upwards. */
export class Nebula implements Surface {
	#x = new Float32Array(0)
	#y = new Float32Array(0)
	#vx = new Float32Array(0)
	#vy = new Float32Array(0)
	#hue = new Float32Array(0)
	#width = 0
	#height = 0

	map(hand: Hand, tonality: Tonality): Gesture {
		return { pitch: tonality.pitchAt(1 - hand.y), expression: clamp(hand.x, 0, 1) }
	}

	resize(width: number, height: number) {
		const count = 900
		if (this.#x.length !== count) {
			this.#x = new Float32Array(count)
			this.#y = new Float32Array(count)
			this.#vx = new Float32Array(count)
			this.#vy = new Float32Array(count)
			this.#hue = new Float32Array(count).fill(220)
			const next = random(7)
			for (let index = 0; index < count; index++) {
				this.#x[index] = next() * width
				this.#y[index] = next() * height
			}
		} else if (this.#width && this.#height) {
			for (let index = 0; index < count; index++) {
				this.#x[index] = (this.#x[index]! / this.#width) * width
				this.#y[index] = (this.#y[index]! / this.#height) * height
			}
		}
		this.#width = width
		this.#height = height
	}

	draw(frame: DrawFrame) {
		const { g, width, height, hands, tonality, time, reducedMotion } = frame
		if (!this.#x.length) {
			this.resize(width, height)
		}
		fade(frame, 0.2)
		for (const note of tonality.notes) {
			const y = (1 - tonality.positionOf(note)) * height
			g.fillStyle = isRoot(tonality, note) ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.035)"
			g.fillRect(0, y, width, 1)
			if (isRoot(tonality, note)) {
				label(frame, noteName(note), 6, y - 7, { align: "left" })
			}
		}
		const count = reducedMotion ? 250 : this.#x.length
		const step = Math.min(frame.dt, 0.05) * 60
		g.save()
		g.globalCompositeOperation = "lighter"
		for (let index = 0; index < count; index++) {
			let x = this.#x[index]!
			let y = this.#y[index]!
			let vx = this.#vx[index]!
			let vy = this.#vy[index]!
			// Gentle flow field when nothing is playing.
			vx += Math.sin(y * 0.01 + time * 0.0003) * 0.02
			vy += Math.cos(x * 0.01 + time * 0.0002) * 0.02
			let hue = this.#hue[index]!
			let closest = Infinity
			for (const hand of hands) {
				const dx = hand.px - x
				const dy = hand.py - y
				const distance = Math.hypot(dx, dy) + 1
				const strength = (hand.notes.length ? 30 + 90 * hand.gesture.expression : 8) / (distance + 40)
				vx += (dx / distance) * strength * 0.15 - (dy / distance) * strength * 0.25
				vy += (dy / distance) * strength * 0.15 + (dx / distance) * strength * 0.25
				if (hand.notes.length && distance < closest) {
					closest = distance
					hue += (hueFor(hand.gesture.pitch) - hue) * 0.05
				}
			}
			vx *= 0.95
			vy *= 0.95
			x += vx * step
			y += vy * step
			if (x < 0) x += width
			if (x > width) x -= width
			if (y < 0) y += height
			if (y > height) y -= height
			this.#x[index] = x
			this.#y[index] = y
			this.#vx[index] = vx
			this.#vy[index] = vy
			this.#hue[index] = hue
			const speed = Math.min(1, Math.hypot(vx, vy) / 4)
			g.fillStyle = hsl(hue, 30 + speed * 60, 40 + speed * 30, 0.5 + speed * 0.5)
			g.fillRect(x, y, 1.6, 1.6)
		}
		g.restore()
	}
}

/** A phosphor oscilloscope: the waveform being played, or a Lissajous figure for two hands. */
export class Scope implements Surface {
	map = linear

	draw(frame: DrawFrame) {
		const { g, width, height, hands, waveform, time } = frame
		fade(frame, 0.28)
		g.strokeStyle = "rgba(125, 255, 176, 0.07)"
		g.lineWidth = 1
		for (let column = 1; column < 10; column++) {
			g.beginPath()
			g.moveTo((width * column) / 10, 0)
			g.lineTo((width * column) / 10, height)
			g.stroke()
		}
		for (let row = 1; row < 8; row++) {
			g.beginPath()
			g.moveTo(0, (height * row) / 8)
			g.lineTo(width, (height * row) / 8)
			g.stroke()
		}
		const playing = hands.filter((hand) => hand.notes.length)
		const voices = playing.flatMap((hand) =>
			hand.notes.map((note) => ({ note, amplitude: hand.gesture.expression }))
		)
		const middle = height / 2
		g.save()
		g.shadowColor = "#7dffb0"
		g.shadowBlur = 8
		g.strokeStyle = "#7dffb0"
		g.lineWidth = 2
		g.beginPath()
		if (waveform?.length && voices.length) {
			for (let x = 0; x < width; x++) {
				const sample = waveform[Math.floor((x / width) * waveform.length)] ?? 0
				const y = middle - sample * height * 0.4
				x === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
			}
		} else {
			const window = 0.02
			for (let x = 0; x <= width; x += 2) {
				const t = (x / width) * window
				let sample = 0
				for (const voice of voices) {
					sample += Math.sin(2 * Math.PI * frequency(voice.note) * t) * voice.amplitude
				}
				const y = middle - (sample / Math.max(1, voices.length)) * height * 0.38
				x === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
			}
		}
		g.stroke()
		if (playing.length >= 2) {
			const [a, b] = playing as [(typeof playing)[0], (typeof playing)[0]]
			const fa = frequency(a.gesture.pitch)
			const fb = frequency(b.gesture.pitch)
			const radius = Math.min(width, height) * 0.3
			const drift = frame.reducedMotion ? 0 : time / 700
			g.strokeStyle = "rgba(180, 255, 210, 0.8)"
			g.lineWidth = 1.5
			g.beginPath()
			for (let step = 0; step <= 600; step++) {
				const t = (step / 600) * (8 / Math.min(fa, fb))
				const x = width / 2 + Math.sin(2 * Math.PI * fa * t + drift) * radius * a.gesture.expression
				const y = middle + Math.sin(2 * Math.PI * fb * t) * radius * b.gesture.expression
				step === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
			}
			g.stroke()
		}
		g.restore()
		scaleLabels(frame, height - 10)
	}
}

interface Curtain {
	x: number
	hue: number
	born: number
	strength: number
}

/** Northern lights: every note raises a curtain of light over a dark landscape. */
export class Aurora implements Surface {
	map = linear
	#curtains: Curtain[] = []
	#seen = 0

	draw(frame: DrawFrame) {
		const { g, width, height, hands, events, time, tonality, reducedMotion } = frame
		const sky = g.createLinearGradient(0, 0, 0, height)
		sky.addColorStop(0, "#02040c")
		sky.addColorStop(1, "#0b1a2a")
		g.fillStyle = sky
		g.fillRect(0, 0, width, height)
		const stars = random(42)
		for (let index = 0; index < 120; index++) {
			const twinkle = reducedMotion ? 0.5 : 0.35 + 0.35 * Math.sin(time / 500 + index)
			g.fillStyle = `rgba(255,255,255,${twinkle})`
			g.fillRect(stars() * width, stars() * height * 0.75, 1.2, 1.2)
		}
		for (const event of events) {
			if (event.time > this.#seen) {
				this.#curtains.push({
					x: toX(tonality.positionOf(event.note), width),
					hue: hueFor(event.note),
					born: event.time,
					strength: event.velocity
				})
			}
		}
		this.#seen = events.at(-1)?.time ?? this.#seen
		this.#curtains = this.#curtains.filter((curtain) => time - curtain.born < 3000).slice(-40)
		const ground = height * 0.86
		g.save()
		g.globalCompositeOperation = "lighter"
		const curtain = (x: number, hue: number, reach: number, alpha: number, seed: number) => {
			const top = ground - reach
			const light = g.createLinearGradient(0, ground, 0, top)
			light.addColorStop(0, hsl(hue, 90, 60, alpha))
			light.addColorStop(0.6, hsl((hue + 40) % 360, 80, 55, alpha * 0.4))
			light.addColorStop(1, hsl((hue + 80) % 360, 80, 50, 0))
			g.fillStyle = light
			for (let strip = -8; strip <= 8; strip++) {
				const sway = reducedMotion ? 0 : Math.sin(strip * 0.6 + time / 600 + seed) * 10
				g.fillRect(x + strip * 3 + sway, top, 2.5, reach)
			}
		}
		for (const item of this.#curtains) {
			const age = (time - item.born) / 3000
			curtain(item.x, item.hue, height * (0.25 + age * 0.45), (1 - age) * 0.35 * item.strength, item.born)
		}
		for (const hand of hands) {
			if (hand.notes.length) {
				curtain(hand.px, hueFor(hand.gesture.pitch), height * (0.2 + 0.6 * hand.gesture.expression), 0.5, 0)
			}
		}
		g.restore()
		// Landscape silhouette.
		const hills = random(3)
		g.fillStyle = "#010205"
		g.beginPath()
		g.moveTo(0, height)
		for (let x = 0; x <= width + 40; x += 40) {
			g.lineTo(x, ground + hills() * 18 - 6)
		}
		g.lineTo(width, height)
		g.closePath()
		g.fill()
		scaleLabels(frame, height - 10)
	}
}
