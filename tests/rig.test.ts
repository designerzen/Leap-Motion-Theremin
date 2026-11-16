import { describe, expect, it } from "vitest"
import { HandRig } from "../src/hand/rig.ts"
import left from "../src/hand/rig-left.json"
import right from "../src/hand/rig-right.json"

/** Flat world-space hands pointing +y, with mirrored knuckle rows. */
function flat(mirror: number) {
	const joints = new Float32Array(63)
	for (let finger = 0; finger < 5; finger++) {
		for (let segment = 0; segment < 4; segment++) {
			const at = (1 + finger * 4 + segment) * 3
			joints[at] = (finger - 2) * mirror
			joints[at + 1] = 4 + segment * 2
		}
	}
	return joints
}

describe.each([["left", left, -1], ["right", right, 1]] as const)("%s rig", (_side, data, mirror) => {
	it("poses a flat hand with finite matrices, tracked scale, and mirrored palm frames", () => {
		const rig = new HandRig(data)
		const joints = flat(mirror)
		const matrices = new Float32Array(21 * 16)
		rig.pose(joints, matrices)
		expect([...matrices].every(Number.isFinite)).toBe(true)
		const scale = 2 / Math.hypot(...data.bones[10]!.pos)
		expect(matrices[8]).toBeCloseTo(0)
		expect(matrices[9]).toBeCloseTo(scale)
		expect(matrices[10]).toBeCloseTo(0)
		expect(Math.hypot(...matrices.subarray(0, 3))).toBeCloseTo(scale)
		expect(matrices[6]).toBeGreaterThan(0) // local +y (back of hand) faces the camera
		expect(matrices[13]).toBeCloseTo(4 - 2.47 * scale)
		// Skinning maps each bind joint to its parent's rotated bind offset.
		const mcp = data.bones[9]!.pos
		const child = data.bones[10]!.pos
		const bind = mcp.map((v, axis) => v + child[axis]!)
		for (let axis = 0; axis < 3; axis++) {
			const at = 10 * 16
			const childWorld = matrices[at + axis]! * bind[0]! + matrices[at + 4 + axis]! * bind[1]! + matrices[at + 8 + axis]! * bind[2]! + matrices[at + 12 + axis]!
			const parentAt = 9 * 16
			const expected = matrices[parentAt + axis]! * bind[0]! + matrices[parentAt + 4 + axis]! * bind[1]! + matrices[parentAt + 8 + axis]! * bind[2]! + matrices[parentAt + 12 + axis]!
			expect(childWorld).toBeCloseTo(expected)
		}
		for (let at = 0; at < rig.normals.length; at += 3) expect(Math.hypot(...rig.normals.subarray(at, at + 3))).toBeCloseTo(1)
	})

	it("keeps matrices finite when tracked segments collapse or reverse", () => {
		const rig = new HandRig(data)
		const joints = flat(mirror)
		joints.set(joints.subarray(3, 6), 6)
		joints[10] = -10
		const matrices = new Float32Array(21 * 16)
		rig.pose(joints, matrices)
		expect([...matrices].every(Number.isFinite)).toBe(true)
		rig.pose(new Float32Array(63), matrices)
		expect([...matrices].every(Number.isFinite)).toBe(true)
	})
})
