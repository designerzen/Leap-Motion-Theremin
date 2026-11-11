import { describe, expect, it } from "vitest"
import { controlChangeDetail, noteDetail, noteName, pitchBendDetail } from "../src/midi.ts"

describe("MIDI 2.0 encoding", () => {
	it("encodes note on as a channel voice UMP", () => {
		const detail = noteDetail("noteOn", 60, 1, 7, { group: 0, channel: 2 })
		expect(detail.ump).toEqual([0x40923c00, 0xffff0000])
		expect(detail.note.noteName).toBe("C4")
		expect(detail.id).toBe(7)
	})

	it("encodes note off with the same address", () => {
		const detail = noteDetail("noteOff", 69, 0, 1, { group: 1, channel: 0 })
		expect(detail.ump).toEqual([0x41804500, 0])
	})

	it("centres pitch bend at 0x80000000 and spans the full range", () => {
		expect(pitchBendDetail(0, { group: 0, channel: 0 }).value32).toBe(0x80000000)
		expect(pitchBendDetail(-1, { group: 0, channel: 0 }).value32).toBe(0)
		expect(pitchBendDetail(1, { group: 0, channel: 0 }).value32).toBe(0xffffffff)
		expect(pitchBendDetail(0, { group: 0, channel: 3 }).ump[0]).toBe(0x40e30000)
	})

	it("encodes controllers with 32 bit values", () => {
		const detail = controlChangeDetail(11, 1, { group: 0, channel: 0 })
		expect(detail.ump).toEqual([0x40b00b00, 0xffffffff])
	})

	it("names notes", () => {
		expect(noteName(21)).toBe("A0")
		expect(noteName(61)).toBe("C#4")
	})
})
