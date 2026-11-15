import { describe, expect, it } from "vitest"
import { findScale, Tonality } from "../src/scales.ts"
import { Hologram, Terrain } from "../src/surfaces/world.ts"
import type { DrawFrame, Hand } from "../src/types.ts"

const tonality = new Tonality(0, findScale("major"), 48, 72)

/** A 2D context that accepts any call, as happy-dom has no canvas implementation. */
const stub = () =>
	new Proxy({} as Record<string, unknown>, {
		get: (target, key: string) => target[key] ?? (() => undefined),
		set: (target, key: string, value) => ((target[key] = value), true)
	}) as unknown as CanvasRenderingContext2D

const frame = (): DrawFrame => ({
	g: stub(),
	width: 800,
	height: 450,
	time: 1000,
	dt: 1 / 60,
	tonality,
	hands: [],
	events: [],
	theme: { background: "#07080d", foreground: "#fff", muted: "#888", accent: "#7dffb0", font: "sans-serif" },
	reducedMotion: false,
	pixelRatio: 1
})

const hand: Hand = {
	id: "h",
	source: "pointer",
	side: "right",
	x: 0.5,
	y: 0.5,
	z: 0.5,
	grab: 0,
	pinch: 0,
	roll: 0,
	active: true,
	born: 0
}

describe.each([
	["Hologram", () => new Hologram()],
	["Terrain", () => new Terrain()]
])("%s", (_name, create) => {
	it("is a WebGL surface that maps x to a pitch in range", () => {
		const surface = create()
		expect(surface.gl).toBe(true)
		for (const x of [0, 0.5, 1]) {
			const { pitch } = surface.map({ ...hand, x }, tonality)
			expect(pitch).toBeGreaterThanOrEqual(tonality.low)
			expect(pitch).toBeLessThanOrEqual(tonality.high)
		}
	})

	it("falls back to 2D when there is no WebGL context", () => {
		const surface = create()
		surface.resize(800, 450)
		expect(() => surface.draw(frame())).not.toThrow()
		expect(() => surface.dispose?.()).not.toThrow()
	})

	it("survives a missing 2D context in the fallback", () => {
		const surface = create()
		expect(() => surface.draw({ ...frame(), g: null as unknown as CanvasRenderingContext2D })).not.toThrow()
	})
})
