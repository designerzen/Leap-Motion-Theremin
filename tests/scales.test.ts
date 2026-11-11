import { describe, expect, it } from "vitest"
import { findScale, parseKey, Tonality } from "../src/scales.ts"

const cMajor = new Tonality(0, findScale("major"), 48, 72)

describe("Tonality", () => {
	it("lists scale notes inside the range", () => {
		expect(cMajor.notes[0]).toBe(48)
		expect(cMajor.notes.at(-1)).toBe(72)
		expect(cMajor.notes).not.toContain(49)
	})

	it("snaps to the nearest scale note", () => {
		expect(cMajor.nearest(48.9)).toBe(48)
		expect(cMajor.nearest(49.1)).toBe(50)
		expect(cMajor.nearest(10)).toBe(48)
	})

	it("steps through scale degrees across octaves", () => {
		expect(cMajor.step(60, 2)).toBe(64)
		expect(cMajor.step(71, 1)).toBe(72)
		expect(cMajor.step(60, -1)).toBe(59)
	})

	it("builds diatonic chords", () => {
		expect(cMajor.chord(62, "triad")).toEqual([62, 65, 69])
		expect(cMajor.chord(67, "seventh")).toEqual([67, 71, 74, 77])
		expect(cMajor.chord(60, "power")).toEqual([60, 67, 72])
	})

	it("parses keys by name, flat or number", () => {
		expect(parseKey("A")).toBe(9)
		expect(parseKey("Bb")).toBe(10)
		expect(parseKey("14")).toBe(2)
	})
})
