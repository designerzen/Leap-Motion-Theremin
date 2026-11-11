import { clamp, noteName, NOTE_KEYS } from "../midi.ts"
import type { Tonality } from "../scales.ts"
import type { DrawFrame, Gesture, Hand, Surface } from "../types.ts"
import { fade, hsl, hueFor, isRoot, label, linear, soundingNotes, strikeEnergy, toX } from "./common.ts"

const SWEEP = Math.PI * 1.5

/** A dial: angle around the centre sets pitch (like a knob, with a gap below), radius sets expression. */
export class Orbit implements Surface {
	#width = 1
	#height = 1

	resize(width: number, height: number) {
		this.#width = width
		this.#height = height
	}

	get #geometry() {
		return {
			cx: this.#width / 2,
			cy: this.#height / 2,
			radius: Math.max(20, Math.min(this.#width, this.#height) * 0.42)
		}
	}

	map(hand: Hand, tonality: Tonality): Gesture {
		const { cx, cy, radius } = this.#geometry
		const dx = hand.x * this.#width - cx
		const dy = hand.y * this.#height - cy
		const angle = Math.atan2(dx, -dy)
		return {
			pitch: tonality.pitchAt((angle + SWEEP / 2) / SWEEP),
			expression: clamp(Math.hypot(dx, dy) / radius, 0, 1)
		}
	}

	draw(frame: DrawFrame) {
		const { g, tonality, hands, theme, time } = frame
		const { cx, cy, radius } = this.#geometry
		const at = (angle: number, r: number) => [cx + Math.sin(angle) * r, cy - Math.cos(angle) * r] as const
		const angleOf = (pitch: number) => tonality.positionOf(pitch) * SWEEP - SWEEP / 2
		fade(frame, 0.3)
		g.lineWidth = 1
		for (const ring of [0.25, 0.5, 0.75, 1]) {
			g.strokeStyle = `rgba(255,255,255,${ring === 1 ? 0.18 : 0.06})`
			g.beginPath()
			g.arc(cx, cy, radius * ring, -Math.PI / 2 - SWEEP / 2, -Math.PI / 2 + SWEEP / 2)
			g.stroke()
		}
		const lit = soundingNotes(frame)
		for (let note = Math.ceil(tonality.low); note <= tonality.high; note++) {
			const angle = angleOf(note)
			const inScale = tonality.inScale(note)
			const [x1, y1] = at(angle, radius * (inScale ? 0.9 : 0.95))
			const [x2, y2] = at(angle, radius)
			g.strokeStyle = inScale ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.12)"
			g.beginPath()
			g.moveTo(x1, y1)
			g.lineTo(x2, y2)
			g.stroke()
			if (!inScale) {
				continue
			}
			const energy = Math.max(lit.has(note) ? 0.8 : 0, strikeEnergy(frame, note))
			const [dx, dy] = at(angle, radius * 1.07)
			g.fillStyle = hsl(hueFor(note), 85, 40 + energy * 35, 0.4 + energy * 0.6)
			g.beginPath()
			g.arc(dx, dy, 3 + energy * 5 + (isRoot(tonality, note) ? 2 : 0), 0, Math.PI * 2)
			g.fill()
			if (isRoot(tonality, note) || energy > 0.1) {
				const [lx, ly] = at(angle, radius * 1.17)
				label(frame, noteName(note), lx, ly, { colour: energy > 0.1 ? theme.foreground : theme.muted, size: 10 })
			}
		}
		for (const hand of hands) {
			const angle = angleOf(hand.gesture.pitch)
			const hue = hueFor(hand.gesture.pitch)
			const [nx, ny] = at(angle, radius)
			g.strokeStyle = hsl(hue, 80, 60, hand.notes.length ? 0.9 : 0.3)
			g.lineWidth = hand.notes.length ? 2.5 : 1
			g.beginPath()
			g.moveTo(cx, cy)
			g.lineTo(nx, ny)
			g.stroke()
			if (hand.notes.length) {
				g.lineWidth = 6
				g.strokeStyle = hsl(hue, 90, 60, 0.35)
				g.beginPath()
				g.arc(cx, cy, radius * hand.gesture.expression, -Math.PI / 2 - SWEEP / 2, -Math.PI / 2 + angle)
				g.stroke()
			}
		}
		const pulse = frame.reducedMotion ? 0 : Math.sin(time / 400) * 2
		g.fillStyle = theme.accent
		g.beginPath()
		g.arc(cx, cy, 5 + pulse, 0, Math.PI * 2)
		g.fill()
	}
}

/**
 * A harmonic table: hexagons where up is a fifth, up-right a major third and up-left a minor
 * third, so chords are compact shapes. Push (pressure or reach) sets expression.
 */
export class Lattice implements Surface {
	#width = 1
	#height = 1

	resize(width: number, height: number) {
		this.#width = width
		this.#height = height
	}

	get #size() {
		return Math.max(16, Math.min(this.#width / 12, this.#height / 7))
	}

	static centre(tonality: Tonality) {
		const middle = (tonality.low + tonality.high) / 2
		return tonality.key + 12 * Math.round((middle - tonality.key) / 12)
	}

	/** Axial (flat topped) hex coordinates under a point relative to the centre. */
	#hexAt(x: number, y: number) {
		const size = this.#size
		const q = ((2 / 3) * x) / size
		const r = ((-1 / 3) * x + (Math.sqrt(3) / 3) * y) / size
		let rx = Math.round(q)
		let rz = Math.round(r)
		const ry = Math.round(-q - r)
		const dx = Math.abs(rx - q)
		const dy = Math.abs(ry - (-q - r))
		const dz = Math.abs(rz - r)
		if (dx > dy && dx > dz) {
			rx = -ry - rz
		} else if (dz > dy) {
			rz = -rx - ry
		}
		return { q: rx, r: rz }
	}

	static pitchOf(centre: number, q: number, r: number) {
		return centre - 3 * q - 7 * r
	}

	map(hand: Hand, tonality: Tonality): Gesture {
		const { q, r } = this.#hexAt(hand.x * this.#width - this.#width / 2, hand.y * this.#height - this.#height / 2)
		return {
			pitch: clamp(Lattice.pitchOf(Lattice.centre(tonality), q, r), 0, 127),
			expression: clamp(0.3 + 0.7 * hand.z, 0, 1)
		}
	}

	draw(frame: DrawFrame) {
		const { g, width, height, tonality, theme } = frame
		fade(frame, 1)
		const size = this.#size
		const centre = Lattice.centre(tonality)
		const lit = soundingNotes(frame)
		const columns = Math.ceil(width / (size * 1.5) / 2) + 1
		const rows = Math.ceil(height / (size * Math.sqrt(3)) / 2) + 2
		g.lineWidth = 1.5
		for (let q = -columns; q <= columns; q++) {
			for (let r = -rows - Math.ceil(columns / 2); r <= rows + Math.ceil(columns / 2); r++) {
				const x = width / 2 + size * 1.5 * q
				const y = height / 2 + size * Math.sqrt(3) * (r + q / 2)
				if (x < -size || x > width + size || y < -size || y > height + size) {
					continue
				}
				const pitch = Lattice.pitchOf(centre, q, r)
				if (pitch < 0 || pitch > 127) {
					continue
				}
				const inRange = pitch >= tonality.low && pitch <= tonality.high
				const inScale = tonality.inScale(pitch)
				const energy = Math.max(lit.has(pitch) ? 0.9 : 0, strikeEnergy(frame, pitch))
				g.beginPath()
				for (let corner = 0; corner < 6; corner++) {
					const angle = (Math.PI / 3) * corner
					const cx = x + Math.cos(angle) * (size - 2)
					const cy = y + Math.sin(angle) * (size - 2)
					corner === 0 ? g.moveTo(cx, cy) : g.lineTo(cx, cy)
				}
				g.closePath()
				const hue = hueFor(pitch)
				g.fillStyle = energy > 0.05
					? hsl(hue, 90, 35 + energy * 30, 0.95)
					: inScale
						? hsl(hue, 45, isRoot(tonality, pitch) ? 30 : 18, inRange ? 0.9 : 0.35)
						: `rgba(255,255,255,${inRange ? 0.03 : 0.015})`
				g.fill()
				g.strokeStyle = isRoot(tonality, pitch) ? hsl(hue, 70, 60, inRange ? 0.9 : 0.4) : "rgba(255,255,255,0.08)"
				g.stroke()
				if (size > 18) {
					label(frame, isRoot(tonality, pitch) ? noteName(pitch) : NOTE_KEYS[pitch % 12]!, x, y, {
						colour: energy > 0.05 || (inScale && inRange) ? theme.foreground : theme.muted,
						size: Math.min(13, size / 2.4)
					})
				}
			}
		}
	}
}

/** A synthwave horizon: scale notes are lanes running to the vanishing point. */
export class Horizon implements Surface {
	map = linear
	#travel = 0

	draw(frame: DrawFrame) {
		const { g, width, height, tonality, hands, dt } = frame
		const horizon = height * 0.42
		const vx = width / 2
		const sky = g.createLinearGradient(0, 0, 0, horizon)
		sky.addColorStop(0, "#090414")
		sky.addColorStop(1, "#3b0f4f")
		g.fillStyle = sky
		g.fillRect(0, 0, width, horizon)
		g.fillStyle = "#07030d"
		g.fillRect(0, horizon, width, height - horizon)
		const lit = soundingNotes(frame)
		// Sun, swelling with what is sounding.
		const glow = Math.min(1, lit.size / 4)
		const sunRadius = height * (0.2 + glow * 0.04)
		const sun = g.createLinearGradient(0, horizon - sunRadius, 0, horizon)
		sun.addColorStop(0, "#ffd36e")
		sun.addColorStop(1, "#ff3d8b")
		g.save()
		g.beginPath()
		g.arc(vx, horizon, sunRadius, Math.PI, 0)
		g.clip()
		g.fillStyle = sun
		g.fillRect(vx - sunRadius, horizon - sunRadius, sunRadius * 2, sunRadius)
		g.fillStyle = "#2a0b3a"
		for (let band = 1; band < 7; band++) {
			const y = horizon - (sunRadius * band) / 7
			g.fillRect(vx - sunRadius, y, sunRadius * 2, band * 0.9)
		}
		g.restore()
		// Floor rows travel towards the player, faster with more expression.
		const energy = hands.reduce((sum, hand) => sum + (hand.notes.length ? hand.gesture.expression : 0), 0)
		if (!frame.reducedMotion) {
			this.#travel = (this.#travel + dt * (0.15 + energy * 0.6)) % 1
		}
		g.strokeStyle = "rgba(255, 61, 139, 0.35)"
		g.lineWidth = 1
		for (let row = 0; row < 14; row++) {
			const depth = (row + this.#travel) / 14
			const y = horizon + (height - horizon) * depth * depth
			g.beginPath()
			g.moveTo(0, y)
			g.lineTo(width, y)
			g.stroke()
		}
		for (const note of tonality.notes) {
			const bx = toX(tonality.positionOf(note), width)
			const strike = Math.max(lit.has(note) ? 0.8 : 0, strikeEnergy(frame, note))
			g.strokeStyle = strike > 0.05 ? hsl(hueFor(note), 95, 60, 0.5 + strike / 2) : "rgba(0, 220, 255, 0.28)"
			g.lineWidth = isRoot(tonality, note) ? 2 : 1 + strike * 3
			g.beginPath()
			g.moveTo(vx + (bx - vx) * 0.03, horizon)
			g.lineTo(bx, height)
			g.stroke()
		}
		for (const hand of hands) {
			const floorY = height - 6
			g.fillStyle = "rgba(0,0,0,0.5)"
			g.beginPath()
			g.ellipse(hand.px, floorY, 18 + hand.z * 14, 4, 0, 0, Math.PI * 2)
			g.fill()
			g.strokeStyle = hsl(hueFor(hand.gesture.pitch), 90, 60, hand.notes.length ? 0.6 : 0.2)
			g.setLineDash([3, 5])
			g.beginPath()
			g.moveTo(hand.px, hand.py)
			g.lineTo(hand.px, floorY)
			g.stroke()
			g.setLineDash([])
		}
		for (const note of tonality.notes) {
			if (isRoot(tonality, note)) {
				label(frame, noteName(note), toX(tonality.positionOf(note), width), height - 14, { colour: "#7fefff" })
			}
		}
	}
}
