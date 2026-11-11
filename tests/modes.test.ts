import { describe, expect, it } from "vitest"
import { findMode, follow } from "../src/modes/index.ts"
import { findScale, Tonality } from "../src/scales.ts"
import type { ModeFrame, Performer, PlayingHand } from "../src/types.ts"

const tonality = new Tonality(0, findScale("major"), 48, 72)
const settings: ModeFrame["settings"] = {
	bendRange: 2,
	mpe: false,
	channel: 0,
	chord: "triad",
	bpm: 120,
	autotune: 1,
	sustain: 0.5
}

const hand = (pitch: number, overrides: Partial<PlayingHand> = {}): PlayingHand => ({
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
	born: 0,
	gesture: { pitch, expression: 0.5 },
	speed: 0,
	lead: true,
	channel: 0,
	...overrides
})

function capture() {
	const held = new Map<string, readonly number[]>()
	const triggered: number[] = []
	const bends: number[] = []
	const out: Performer = {
		hold: (key, notes) => held.set(key, notes),
		trigger: (_key, note) => triggered.push(note),
		bend: (_channel, value) => bends.push(value),
		control: () => {}
	}
	return { held, triggered, bends, out }
}

const frame = (hands: PlayingHand[], time = 0): ModeFrame => ({
	hands,
	tonality,
	settings,
	time,
	dt: 1 / 60
})

describe("follow", () => {
	it("bends within range and re-anchors beyond it", () => {
		expect(follow(undefined, 60.4, 2)).toEqual({ anchor: 60, bend: expect.closeTo(0.2) })
		expect(follow(60, 61.4, 2).anchor).toBe(60)
		expect(follow(60, 61.6, 2).anchor).toBe(62)
	})
})

describe("modes", () => {
	it("glide holds an anchor note and bends to the exact pitch", () => {
		const mode = findMode("glide").create()
		const { held, bends, out } = capture()
		mode.update(frame([hand(60.5)]), out)
		expect(held.get("h")).toEqual([61])
		expect(bends[0]).toBeCloseTo(-0.25)
	})

	it("autotune pulls a resting hand into the scale", () => {
		const mode = findMode("autotune").create()
		const { held, bends, out } = capture()
		for (let index = 0; index < 60; index++) {
			mode.update(frame([hand(61.4)]), out)
		}
		// The nearest C major note to 61.4 is D (62), so the sounding pitch should settle there.
		expect(held.get("h")![0]! + bends.at(-1)! * 2).toBeCloseTo(62, 1)
	})

	it("snap plays scale notes with hysteresis", () => {
		const mode = findMode("snap").create()
		const { held, out } = capture()
		mode.update(frame([hand(60.9)]), out)
		expect(held.get("h")).toEqual([60])
		mode.update(frame([hand(61.05)]), out)
		expect(held.get("h")).toEqual([60])
		mode.update(frame([hand(61.6)]), out)
		expect(held.get("h")).toEqual([62])
	})

	it("chords hold a diatonic triad", () => {
		const mode = findMode("chords").create()
		const { held, out } = capture()
		mode.update(frame([hand(67)]), out)
		expect(held.get("h")).toEqual([67, 71, 74])
	})

	it("strum plucks every string crossed", () => {
		const mode = findMode("strum").create()
		const { triggered, out } = capture()
		mode.update(frame([hand(59.7)]), out)
		mode.update(frame([hand(65.5)]), out)
		expect(triggered).toEqual([60, 60, 62, 64, 65])
	})

	it("pulse repeats in time", () => {
		const mode = findMode("pulse").create()
		const { triggered, out } = capture()
		const low = hand(60, { gesture: { pitch: 60, expression: 0 } })
		for (let time = 0; time <= 1008; time += 16) {
			mode.update(frame([low], time), out)
		}
		// Quarter notes at 120 bpm: beats at 0, 500 and 1000 ms.
		expect(triggered).toEqual([60, 60, 60])
	})

	it("drone latches from the left hand and toggles off", () => {
		const mode = findMode("drone").create()
		const { held, out } = capture()
		const left = hand(60, { id: "l", side: "left" })
		mode.update(frame([left]), out)
		held.clear()
		mode.update(frame([]), out)
		expect(held.get("drone")).toEqual([48, 55, 60])
		held.clear()
		mode.update(frame([{ ...left, id: "l2" }]), out)
		expect(held.has("drone")).toBe(false)
	})
})
