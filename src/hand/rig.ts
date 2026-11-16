import type { HandSide } from "../types.ts"

export interface RigData {
	side: string
	positions: number[]
	indices: number[]
	skinIndices: number[]
	skinWeights: number[]
	bones: { name: string, parent: number, pos: number[] }[]
}

type Vec = [number, number, number]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (v: Vec, fallback: Vec): Vec => {
	const length = Math.hypot(...v)
	return length > 1e-8 ? [v[0] / length, v[1] / length, v[2] / length] : fallback
}
const point = (v: ArrayLike<number>, at: number): Vec => [v[at]!, v[at + 1]!, v[at + 2]!]
const difference = (v: ArrayLike<number>, a: number, b: number): Vec => [v[a * 3]! - v[b * 3]!, v[a * 3 + 1]! - v[b * 3 + 1]!, v[a * 3 + 2]! - v[b * 3 + 2]!]

/** CPU bind data and the original plugin's world-direction / transported-up posing. */
export class HandRig {
	readonly normals: Float32Array
	readonly #bind: Vec[] = []
	readonly #world = new Float32Array(21 * 16)
	readonly #directions: Vec[] = []
	readonly #ups: Vec[] = []
	readonly #bindLength: number

	constructor(readonly data: RigData) {
		this.#bindLength = Math.hypot(...data.bones[10]!.pos)
		for (const bone of data.bones) {
			const parent = this.#bind[bone.parent] ?? [0, 0, 0]
			this.#bind.push([parent[0]! + bone.pos[0]!, parent[1]! + bone.pos[1]!, parent[2]! + bone.pos[2]!])
		}
		const normals = this.normals = new Float32Array(data.positions.length)
		for (let i = 0; i < data.indices.length; i += 3) {
			const a = data.indices[i]!, b = data.indices[i + 1]!, c = data.indices[i + 2]!
			const n = cross(difference(data.positions, b, a), difference(data.positions, c, a))
			for (const vertex of [a, b, c]) {
				for (let axis = 0; axis < 3; axis++) normals[vertex * 3 + axis] = normals[vertex * 3 + axis]! + n[axis]!
			}
		}
		for (let i = 0; i < normals.length; i += 3) normals.set(unit(point(normals, i), [0, 1, 0]), i)
	}

	/** Joints are already in world space. Translations retain the scaled bind hierarchy. */
	pose(joints: Float32Array, out: Float32Array) {
		const direction = unit(difference(joints, 9, 0), [0, 1, 0])
		const normal = unit(cross(difference(joints, 5, 0), difference(joints, 17, 0)), [0, 0, -1])
		// The mirrored bind meshes require opposite signs for the same anatomical palm normal.
		const sign = this.data.side === "left" ? 1 : -1
		const up: Vec = [normal[0] * sign, normal[1] * sign, normal[2] * sign]
		const scale = Math.max(1e-6, Math.hypot(...difference(joints, 10, 9)) / this.#bindLength)
		const world = this.#world
		for (let bone = 0; bone < 21; bone++) {
			const at = bone * 16
			const parent = this.data.bones[bone]!.parent
			const parentAt = parent * 16
			let z = direction, transportedUp = up
			if (parent >= 0) {
				const parentDir = this.#directions[parent]!, parentUp = this.#ups[parent]!
				z = bone % 4 === 0 ? parentDir : unit(difference(joints, bone + 1, bone), parentDir)
				const d = Math.max(-1, Math.min(1, dot(parentDir, z)))
				const axis = cross(parentDir, z)
				const length = Math.hypot(...axis)
				transportedUp = parentUp
				if (length > 1e-8) {
					const a = unit(axis, [1, 0, 0]), tangent = cross(a, parentUp)
					const sin = Math.sqrt(Math.max(0, 1 - d * d)), along = dot(a, parentUp) * (1 - d)
					transportedUp = [0, 1, 2].map((i) => parentUp[i]! * d + tangent[i]! * sin + a[i]! * along) as Vec
				}
			}
			// lookAt(direction, zero, up): local +z follows the tracked bone.
			let x = cross(transportedUp, z)
			if (Math.hypot(...x) < 1e-8) x = cross(Math.abs(z[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], z)
			x = unit(x, [1, 0, 0])
			const y = cross(z, x)
			this.#directions[bone] = z
			this.#ups[bone] = y
			world.fill(0, at, at + 16)
			for (let i = 0; i < 3; i++) {
				world[at + i] = x[i]! * scale
				world[at + 4 + i] = y[i]! * scale
				world[at + 8 + i] = z[i]! * scale
				if (parent < 0) {
					world[at + 12 + i] = joints[27 + i]! - direction[i]! * 2.47 * scale
				} else {
					const p = this.data.bones[bone]!.pos
					world[at + 12 + i] = world[parentAt + 12 + i]! + world[parentAt + i]! * p[0]! + world[parentAt + 4 + i]! * p[1]! + world[parentAt + 8 + i]! * p[2]!
				}
			}
			world[at + 15] = 1
			out.set(world.subarray(at, at + 16), at)
			const bind = this.#bind[bone]!
			for (let i = 0; i < 3; i++) out[at + 12 + i] = world[at + 12 + i]! - world[at + i]! * bind[0] - world[at + 4 + i]! * bind[1] - world[at + 8 + i]! * bind[2]
		}
	}
}

const rigs = new Map<HandSide, Promise<HandRig>>()
export function loadRig(side: HandSide): Promise<HandRig> {
	let rig = rigs.get(side)
	if (!rig) {
		rig = (side === "left" ? import("./rig-left.json") : import("./rig-right.json")).then(({ default: data }) => new HandRig(data))
		rigs.set(side, rig)
	}
	return rig
}
