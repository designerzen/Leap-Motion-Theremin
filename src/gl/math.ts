/** Column-major 4x4 matrix, laid out as WebGL expects. */
export type Mat4 = Float32Array
/** Column-major 3x3 matrix. */
export type Mat3 = Float32Array
export type Rgb = readonly [number, number, number]

export function identity(out: Mat4) {
	out.fill(0)
	out[0] = out[5] = out[10] = out[15] = 1
	return out
}

export const createMat4 = (): Mat4 => identity(new Float32Array(16))

export function perspective(out: Mat4, fovY: number, aspect: number, near: number, far: number) {
	const f = 1 / Math.tan(fovY / 2)
	const range = 1 / (near - far)
	out.fill(0)
	out[0] = f / aspect
	out[5] = f
	out[10] = (far + near) * range
	out[11] = -1
	out[14] = 2 * far * near * range
	return out
}

/** A view matrix looking from the eye at the target with +y up. */
export function lookAt(out: Mat4, ex: number, ey: number, ez: number, tx: number, ty: number, tz: number) {
	const zx = ex - tx
	const zy = ey - ty
	const zz = ez - tz
	const zl = 1 / (Math.hypot(zx, zy, zz) || 1)
	const fx = zx * zl
	const fy = zy * zl
	const fz = zz * zl
	// x = up × z with up = (0, 1, 0)
	const xl = 1 / (Math.hypot(fz, fx) || 1)
	const xx = fz * xl
	const xz = -fx * xl
	const yx = fy * xz
	const yy = fz * xx - fx * xz
	const yz = -fy * xx
	out[0] = xx
	out[1] = yx
	out[2] = fx
	out[3] = 0
	out[4] = 0
	out[5] = yy
	out[6] = fy
	out[7] = 0
	out[8] = xz
	out[9] = yz
	out[10] = fz
	out[11] = 0
	out[12] = -(xx * ex + xz * ez)
	out[13] = -(yx * ex + yy * ey + yz * ez)
	out[14] = -(fx * ex + fy * ey + fz * ez)
	out[15] = 1
	return out
}

const product = new Float32Array(16)

/** out = a × b. The output may alias either input. */
export function multiply(out: Mat4, a: Mat4, b: Mat4) {
	for (let column = 0; column < 4; column++) {
		for (let row = 0; row < 4; row++) {
			let sum = 0
			for (let k = 0; k < 4; k++) {
				sum += a[k * 4 + row]! * b[column * 4 + k]!
			}
			product[column * 4 + row] = sum
		}
	}
	out.set(product)
	return out
}

/** out = m × translation. The output may alias m. */
export function translate(out: Mat4, m: Mat4, x: number, y: number, z: number) {
	if (out !== m) {
		out.set(m)
	}
	for (let row = 0; row < 4; row++) {
		out[12 + row] = m[row]! * x + m[4 + row]! * y + m[8 + row]! * z + m[12 + row]!
	}
	return out
}

/** out = m × scale. The output may alias m. */
export function scale(out: Mat4, m: Mat4, x: number, y: number, z: number) {
	for (let row = 0; row < 4; row++) {
		out[row] = m[row]! * x
		out[4 + row] = m[4 + row]! * y
		out[8 + row] = m[8 + row]! * z
		out[12 + row] = m[12 + row]!
	}
	return out
}

/** out = m × rotation about x. The output may alias m. */
export function rotateX(out: Mat4, m: Mat4, angle: number) {
	const s = Math.sin(angle)
	const c = Math.cos(angle)
	if (out !== m) {
		out.set(m)
	}
	for (let row = 0; row < 4; row++) {
		const a1 = m[4 + row]!
		const a2 = m[8 + row]!
		out[4 + row] = a1 * c + a2 * s
		out[8 + row] = a2 * c - a1 * s
	}
	return out
}

/** out = m × rotation about y. The output may alias m. */
export function rotateY(out: Mat4, m: Mat4, angle: number) {
	const s = Math.sin(angle)
	const c = Math.cos(angle)
	if (out !== m) {
		out.set(m)
	}
	for (let row = 0; row < 4; row++) {
		const a0 = m[row]!
		const a2 = m[8 + row]!
		out[row] = a0 * c - a2 * s
		out[8 + row] = a0 * s + a2 * c
	}
	return out
}

/** out = m × rotation about z. The output may alias m. */
export function rotateZ(out: Mat4, m: Mat4, angle: number) {
	const s = Math.sin(angle)
	const c = Math.cos(angle)
	if (out !== m) {
		out.set(m)
	}
	for (let row = 0; row < 4; row++) {
		const a0 = m[row]!
		const a1 = m[4 + row]!
		out[row] = a0 * c + a1 * s
		out[4 + row] = a1 * c - a0 * s
	}
	return out
}

/** A scale then a translation, for spheres at joints. */
export function fromPositionScale(out: Mat4, x: number, y: number, z: number, sx: number, sy = sx, sz = sx) {
	identity(out)
	out[0] = sx
	out[5] = sy
	out[10] = sz
	out[12] = x
	out[13] = y
	out[14] = z
	return out
}

/**
 * Place a unit cylinder (radius 1, y from 0 to 1, see `cylinderData`) so that it runs from a to b
 * with the given radius.
 */
export function orient(
	out: Mat4,
	ax: number, ay: number, az: number,
	bx: number, by: number, bz: number,
	radius: number
) {
	const dx = bx - ax
	const dy = by - ay
	const dz = bz - az
	const length = Math.hypot(dx, dy, dz)
	const ux = length ? dx / length : 0
	const uy = length ? dy / length : 1
	const uz = length ? dz / length : 0
	// A helper axis that is not parallel to the bone gives the first perpendicular.
	const hx = Math.abs(ux) < 0.9 ? 1 : 0
	const hy = hx ? 0 : 1
	let px = hy * uz
	let py = -hx * uz
	let pz = hx * uy - hy * ux
	const pl = 1 / (Math.hypot(px, py, pz) || 1)
	px *= pl
	py *= pl
	pz *= pl
	const qx = uy * pz - uz * py
	const qy = uz * px - ux * pz
	const qz = ux * py - uy * px
	out[0] = px * radius
	out[1] = py * radius
	out[2] = pz * radius
	out[3] = 0
	out[4] = dx
	out[5] = dy
	out[6] = dz
	out[7] = 0
	out[8] = qx * radius
	out[9] = qy * radius
	out[10] = qz * radius
	out[11] = 0
	out[12] = ax
	out[13] = ay
	out[14] = az
	out[15] = 1
	return out
}

/** The matrix that transforms normals for a model matrix (the cofactor of its upper 3x3). */
export function normalMatrix(out: Mat3, m: Mat4) {
	const c0x = m[0]!, c0y = m[1]!, c0z = m[2]!
	const c1x = m[4]!, c1y = m[5]!, c1z = m[6]!
	const c2x = m[8]!, c2y = m[9]!, c2z = m[10]!
	out[0] = c1y * c2z - c1z * c2y
	out[1] = c1z * c2x - c1x * c2z
	out[2] = c1x * c2y - c1y * c2x
	out[3] = c2y * c0z - c2z * c0y
	out[4] = c2z * c0x - c2x * c0z
	out[5] = c2x * c0y - c2y * c0x
	out[6] = c0y * c1z - c0z * c1y
	out[7] = c0z * c1x - c0x * c1z
	out[8] = c0x * c1y - c0y * c1x
	return out
}

export const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

export const mix = (a: number, b: number, amount: number) => a + (b - a) * amount

/** Seeded random numbers so decorative layouts stay put between runs. */
export function seeded(seed: number) {
	let state = seed >>> 0
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0
		return state / 0x100000000
	}
}

/** HSL (hue in degrees, saturation and lightness 0..1) to RGB 0..1 written into out. */
export function hslToRgb(hue: number, saturation: number, lightness: number, out: Float32Array | number[], offset = 0) {
	const h = ((hue % 360) + 360) % 360
	const a = saturation * Math.min(lightness, 1 - lightness)
	for (let index = 0; index < 3; index++) {
		const k = (index * 8 + h / 30) % 12
		out[offset + index] = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
	}
	return out
}

/** Parse a CSS hex or rgb() colour into 0..1 channels, or return the fallback. */
export function parseColour(css: string | undefined, fallback: Rgb): Rgb {
	const text = css?.trim().toLowerCase() ?? ""
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)?.[1]
	if (hex) {
		const full = hex.length === 3 ? hex.replace(/./g, "$&$&") : hex
		const value = parseInt(full, 16)
		return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
	}
	const channels = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text)
	if (channels) {
		return [Number(channels[1]) / 255, Number(channels[2]) / 255, Number(channels[3]) / 255]
	}
	return fallback
}
