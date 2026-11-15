import { describe, expect, it } from "vitest"
import { handFromLandmarks } from "../src/tracking/camera.ts"
import { handsFromFrame } from "../src/tracking/leap.ts"
import type { LeapFrame } from "../src/tracking/leap.ts"
import type { Hand } from "../src/types.ts"

function leapFrame(): LeapFrame {
	return {
		interactionBox: { center: [0, 200, 0], size: [200, 200, 200] },
		hands: [{ id: 7, type: "right", palmPosition: [0, 200, 0], wrist: [-40, 200, 20] }],
		pointables: Array.from({ length: 5 }, (_, type) => ({
			handId: 7,
			type: type as 0 | 1 | 2 | 3 | 4,
			tool: false,
			carpPosition: [-20, 180 + type * 10, 20],
			mcpPosition: [0, 180 + type * 10, 10],
			pipPosition: [20, 180 + type * 10, 0],
			dipPosition: [40, 180 + type * 10, -10],
			tipPosition: [60, 180 + type * 10, -20]
		}))
	}
}

describe("Leap hand joints", () => {
	it("maps all fingers into the interaction box and skips the thumb's metacarpal", () => {
		const frame = leapFrame()
		const hand = handsFromFrame(frame, new Map(), 10).get(7)!
		const joints = hand.joints!
		expect(joints).toHaveLength(63)
		expect(Array.from(joints.slice(0, 3))).toEqual([
			expect.closeTo(0.3), expect.closeTo(0.5), expect.closeTo(0.4)
		])
		expect(joints[8 * 3]).toBeGreaterThan(joints[0]!)
		for (let joint = 1; joint <= 4; joint++) {
			expect(joints[joint * 3]).toBeCloseTo(0.5 + (joint - 1) * 0.1)
			expect(joints[joint * 3 + 1]).toBeCloseTo(0.6)
			expect(joints[joint * 3 + 2]).toBeCloseTo(0.45 + (joint - 1) * 0.05)
		}
		for (let finger = 1; finger < 5; finger++) {
			expect(joints[(finger * 4 + 4) * 3]).toBeCloseTo(0.8)
			expect(joints[(finger * 4 + 4) * 3 + 1]).toBeCloseTo(0.6 - finger * 0.05)
		}
	})

	it("ignores tools and pointables belonging to other hands", () => {
		const frame = leapFrame()
		frame.pointables!.push({ ...frame.pointables![1]!, tool: true, tipPosition: [-100, 0, 0] })
		frame.pointables!.push({ ...frame.pointables![1]!, handId: 99, tipPosition: [-100, 0, 0] })
		const hand = handsFromFrame(frame, new Map(), 0).get(7)!
		expect(hand.joints![8 * 3]).toBeCloseTo(0.8)
		frame.pointables = frame.pointables!.filter((pointable) => pointable.tool)
		expect(handsFromFrame(frame, new Map(), 0).get(7)!.joints).toBeUndefined()
	})

	it("reuses the hand and joint buffer, clears absent joints, and removes absent hands", () => {
		const frame = leapFrame()
		const hands = new Map<number, Hand>()
		handsFromFrame(frame, hands, 10)
		const hand = hands.get(7)!
		const joints = hand.joints!
		frame.pointables![1]!.tipPosition = [500, -500, -500]
		expect(handsFromFrame(frame, hands, 20)).toBe(hands)
		expect(hands.get(7)).toBe(hand)
		expect(hand.born).toBe(10)
		expect(hand.joints).toBe(joints)
		expect(Array.from(joints.slice(24, 27))).toEqual([1, 1, 1])
		frame.pointables = []
		handsFromFrame(frame, hands, 30)
		expect(hand.joints).toBeUndefined()
		handsFromFrame(leapFrame(), hands, 35)
		expect(hand.joints).toBe(joints)
		delete frame.pointables
		handsFromFrame(frame, hands, 36)
		expect(hand.joints).toBeUndefined()
		handsFromFrame({}, hands, 40)
		expect(hands.size).toBe(0)
	})

	it("estimates the wrist from direction and width, or lowers it below the palm", () => {
		const frame = leapFrame()
		const leap = frame.hands![0]!
		delete leap.wrist
		leap.direction = [1, 0, 0]
		leap.palmWidth = 100
		let hand = handsFromFrame(frame, new Map(), 0).get(7)!
		expect(hand.joints![0]).toBeCloseTo(0.2)
		delete leap.direction
		hand = handsFromFrame(frame, new Map(), 0).get(7)!
		expect(hand.joints![0]).toBeCloseTo(hand.x)
		expect(hand.joints![1]).toBeCloseTo(0.7)
		expect(hand.joints![2]).toBeCloseTo(hand.z)
	})
})

describe("camera hand joints", () => {
	const landmarks = () => Array.from({ length: 21 }, (_, index) => ({
		x: 0.2 + index * 0.02,
		y: 0.3 + index * 0.01,
		z: -index * 0.01
	}))

	it("mirrors x and maps relative depth to push", () => {
		const points = landmarks()
		const hand = handFromLandmarks(points, "right", true, undefined, 0)
		expect(hand.joints).toHaveLength(63)
		for (let index = 0; index < 21; index++) {
			expect(hand.joints![index * 3]).toBeCloseTo(1 - points[index]!.x)
			expect(hand.joints![index * 3 + 1]).toBeCloseTo(points[index]!.y)
			expect(hand.joints![index * 3 + 2]).toBeCloseTo(Math.min(1, hand.z - points[index]!.z * 2))
		}
	})

	it("reuses the previous buffer and clamps unmirrored coordinates and depth", () => {
		const points = landmarks()
		const previous = handFromLandmarks(points, "left", false, undefined, 10)
		points[8] = { x: 2, y: -1, z: -2 }
		points[4] = { x: -1, y: 2, z: 2 }
		const hand = handFromLandmarks(points, "left", false, previous, 20)
		expect(hand.joints).toBe(previous.joints)
		expect(hand.born).toBe(10)
		expect(hand.joints![0]).toBeCloseTo(points[0]!.x)
		expect(Array.from(hand.joints!.slice(24, 27))).toEqual([1, 0, 1])
		expect(Array.from(hand.joints!.slice(12, 15))).toEqual([0, 1, 0])
		previous.joints = new Float32Array(3)
		expect(handFromLandmarks(points, "left", false, previous, 30).joints).toHaveLength(63)
	})
})
