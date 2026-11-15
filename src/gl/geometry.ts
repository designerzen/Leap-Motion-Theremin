export interface MeshData {
	positions: Float32Array
	normals?: Float32Array
	indices?: Uint16Array | Uint32Array
}

/** A unit cube centred on the origin. */
export function cubeData(): MeshData {
	// Each face: its normal and a tangent; the bitangent is normal × tangent.
	const faces = [
		[1, 0, 0, 0, 1, 0],
		[-1, 0, 0, 0, 1, 0],
		[0, 1, 0, 0, 0, 1],
		[0, -1, 0, 0, 0, 1],
		[0, 0, 1, 1, 0, 0],
		[0, 0, -1, 1, 0, 0]
	] as const
	const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const
	const positions = new Float32Array(24 * 3)
	const normals = new Float32Array(24 * 3)
	const indices = new Uint16Array(36)
	faces.forEach(([nx, ny, nz, ux, uy, uz], face) => {
		const vx = ny * uz - nz * uy
		const vy = nz * ux - nx * uz
		const vz = nx * uy - ny * ux
		corners.forEach(([a, b], corner) => {
			const at = (face * 4 + corner) * 3
			positions[at] = (nx + ux * a + vx * b) * 0.5
			positions[at + 1] = (ny + uy * a + vy * b) * 0.5
			positions[at + 2] = (nz + uz * a + vz * b) * 0.5
			normals[at] = nx
			normals[at + 1] = ny
			normals[at + 2] = nz
		})
		indices.set([0, 1, 2, 0, 2, 3].map((index) => face * 4 + index), face * 6)
	})
	return { positions, normals, indices }
}

/** A unit sphere with smooth normals. */
export function sphereData(rings = 10, segments = 16): MeshData {
	const count = (rings + 1) * (segments + 1)
	const positions = new Float32Array(count * 3)
	const indices = new Uint16Array(rings * segments * 6)
	for (let ring = 0; ring <= rings; ring++) {
		const theta = (ring / rings) * Math.PI
		for (let segment = 0; segment <= segments; segment++) {
			const phi = (segment / segments) * Math.PI * 2
			const at = (ring * (segments + 1) + segment) * 3
			positions[at] = Math.sin(theta) * Math.cos(phi)
			positions[at + 1] = Math.cos(theta)
			positions[at + 2] = Math.sin(theta) * Math.sin(phi)
		}
	}
	let cursor = 0
	for (let ring = 0; ring < rings; ring++) {
		for (let segment = 0; segment < segments; segment++) {
			const a = ring * (segments + 1) + segment
			const b = a + segments + 1
			indices.set([a, a + 1, b, a + 1, b + 1, b], cursor)
			cursor += 6
		}
	}
	return { positions, normals: positions, indices }
}

/** A unit icosahedron with flat faces, for the small orb that stands in for a pointer. */
export function icosahedronData(): MeshData {
	const t = (1 + Math.sqrt(5)) / 2
	const vertices = [
		[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
		[0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
		[t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
	] as const
	const faces = [
		0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
		1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
		3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
		4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1
	]
	const positions = new Float32Array(faces.length * 3)
	const normals = new Float32Array(faces.length * 3)
	const corner = new Float32Array(3)
	for (let face = 0; face < faces.length; face += 3) {
		let nx = 0
		let ny = 0
		let nz = 0
		for (let index = 0; index < 3; index++) {
			const [x, y, z] = vertices[faces[face + index]!]!
			const length = Math.hypot(x, y, z)
			corner.set([x / length, y / length, z / length])
			positions.set(corner, (face + index) * 3)
			nx += corner[0]!
			ny += corner[1]!
			nz += corner[2]!
		}
		const length = Math.hypot(nx, ny, nz)
		for (let index = 0; index < 3; index++) {
			normals.set([nx / length, ny / length, nz / length], (face + index) * 3)
		}
	}
	return { positions, normals }
}

/** An open tube of radius 1 running from y = 0 to y = 1, for bones. */
export function cylinderData(segments = 8): MeshData {
	const positions = new Float32Array((segments + 1) * 2 * 3)
	const normals = new Float32Array(positions.length)
	const indices = new Uint16Array(segments * 6)
	for (let segment = 0; segment <= segments; segment++) {
		const phi = (segment / segments) * Math.PI * 2
		const x = Math.cos(phi)
		const z = Math.sin(phi)
		for (let end = 0; end < 2; end++) {
			const at = (segment * 2 + end) * 3
			positions.set([x, end, z], at)
			normals.set([x, 0, z], at)
		}
	}
	for (let segment = 0; segment < segments; segment++) {
		const a = segment * 2
		const c = a + 2
		indices.set([a, a + 1, c, c, a + 1, c + 1], segment * 6)
	}
	return { positions, normals, indices }
}

/** A mesh in a vertex array object: positions at attribute 0 and normals at attribute 1. */
export class Mesh {
	readonly #gl: WebGL2RenderingContext
	readonly #vao: WebGLVertexArrayObject
	readonly #buffers: WebGLBuffer[] = []
	readonly #count: number
	readonly #indexType: number
	readonly #indexed: boolean

	constructor(gl: WebGL2RenderingContext, data: MeshData, dynamic = false) {
		this.#gl = gl
		this.#vao = gl.createVertexArray()
		gl.bindVertexArray(this.#vao)
		const usage = dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW
		this.#attribute(0, data.positions, usage)
		if (data.normals) {
			this.#attribute(1, data.normals, usage)
		} else {
			gl.vertexAttrib3f(1, 0, 1, 0)
		}
		this.#indexed = !!data.indices
		this.#indexType = data.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
		if (data.indices) {
			const buffer = gl.createBuffer()
			this.#buffers.push(buffer)
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer)
			gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW)
		}
		this.#count = data.indices ? data.indices.length : data.positions.length / 3
		gl.bindVertexArray(null)
	}

	#attribute(location: number, data: Float32Array, usage: number) {
		const gl = this.#gl
		const buffer = gl.createBuffer()
		this.#buffers.push(buffer)
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
		gl.bufferData(gl.ARRAY_BUFFER, data, usage)
		gl.enableVertexAttribArray(location)
		gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0)
	}

	/** Replace the vertices of a dynamic mesh with the same number of vertices. */
	update(positions: Float32Array, normals?: Float32Array) {
		const gl = this.#gl
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffers[0]!)
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions)
		if (normals) {
			gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffers[1]!)
			gl.bufferSubData(gl.ARRAY_BUFFER, 0, normals)
		}
	}

	draw(mode = this.#gl.TRIANGLES) {
		const gl = this.#gl
		gl.bindVertexArray(this.#vao)
		if (this.#indexed) {
			gl.drawElements(mode, this.#count, this.#indexType, 0)
		} else {
			gl.drawArrays(mode, 0, this.#count)
		}
	}

	dispose() {
		this.#gl.deleteVertexArray(this.#vao)
		this.#buffers.forEach((buffer) => this.#gl.deleteBuffer(buffer))
	}
}

/**
 * Coloured line segments rebuilt every frame: attribute 0 is the position and attribute 1 the
 * colour, so a colour that fades to black becomes a fade to transparent under additive blending.
 */
export class LineBatch {
	readonly #gl: WebGL2RenderingContext
	readonly #vao: WebGLVertexArrayObject
	readonly #buffer: WebGLBuffer
	#data: Float32Array
	#capacity: number
	#length = 0

	constructor(gl: WebGL2RenderingContext, capacity = 1024) {
		this.#gl = gl
		this.#capacity = capacity
		this.#data = new Float32Array(capacity * 6)
		this.#vao = gl.createVertexArray()
		this.#buffer = gl.createBuffer()
		gl.bindVertexArray(this.#vao)
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer)
		gl.bufferData(gl.ARRAY_BUFFER, this.#data.byteLength, gl.DYNAMIC_DRAW)
		gl.enableVertexAttribArray(0)
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0)
		gl.enableVertexAttribArray(1)
		gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12)
		gl.bindVertexArray(null)
	}

	clear() {
		this.#length = 0
	}

	add(
		ax: number, ay: number, az: number, ar: number, ag: number, ab: number,
		bx: number, by: number, bz: number, br: number, bg: number, bb: number
	) {
		if (this.#length + 2 > this.#capacity) {
			this.#capacity *= 2
			const grown = new Float32Array(this.#capacity * 6)
			grown.set(this.#data)
			this.#data = grown
			const gl = this.#gl
			gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer)
			gl.bufferData(gl.ARRAY_BUFFER, grown.byteLength, gl.DYNAMIC_DRAW)
		}
		const data = this.#data
		const at = this.#length * 6
		data[at] = ax
		data[at + 1] = ay
		data[at + 2] = az
		data[at + 3] = ar
		data[at + 4] = ag
		data[at + 5] = ab
		data[at + 6] = bx
		data[at + 7] = by
		data[at + 8] = bz
		data[at + 9] = br
		data[at + 10] = bg
		data[at + 11] = bb
		this.#length += 2
	}

	draw() {
		if (!this.#length) {
			return
		}
		const gl = this.#gl
		gl.bindVertexArray(this.#vao)
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffer)
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.#data, 0, this.#length * 6)
		gl.drawArrays(gl.LINES, 0, this.#length)
	}

	dispose() {
		this.#gl.deleteVertexArray(this.#vao)
		this.#gl.deleteBuffer(this.#buffer)
	}
}

/** Points whose positions are rewritten every frame, with a static per-point seed at attribute 1. */
export class PointCloud {
	readonly #gl: WebGL2RenderingContext
	readonly #vao: WebGLVertexArrayObject
	readonly #buffers: WebGLBuffer[]
	readonly positions: Float32Array

	constructor(gl: WebGL2RenderingContext, positions: Float32Array, seeds: Float32Array) {
		this.#gl = gl
		this.positions = positions
		this.#vao = gl.createVertexArray()
		gl.bindVertexArray(this.#vao)
		const position = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, position)
		gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW)
		gl.enableVertexAttribArray(0)
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)
		const seed = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, seed)
		gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW)
		gl.enableVertexAttribArray(1)
		gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0)
		this.#buffers = [position, seed]
		gl.bindVertexArray(null)
	}

	/** Upload `positions` and draw every point. */
	draw() {
		const gl = this.#gl
		gl.bindVertexArray(this.#vao)
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffers[0]!)
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.positions)
		gl.drawArrays(gl.POINTS, 0, this.positions.length / 3)
	}

	dispose() {
		this.#gl.deleteVertexArray(this.#vao)
		this.#buffers.forEach((buffer) => this.#gl.deleteBuffer(buffer))
	}
}

/**
 * A flat grid of `columns` × `rows` vertices on the xz plane, x from -0.5 to 0.5 and z from 0 to
 * -(rows - 1), with a per-vertex height at attribute 1 that is rewritten from `heights`.
 */
export class GridMesh {
	readonly #gl: WebGL2RenderingContext
	readonly #lines: WebGLVertexArrayObject
	readonly #fill: WebGLVertexArrayObject
	readonly #buffers: WebGLBuffer[] = []
	readonly #lineCount: number
	readonly #fillCount: number
	readonly heights: Float32Array

	constructor(gl: WebGL2RenderingContext, readonly columns: number, readonly rows: number) {
		this.#gl = gl
		this.heights = new Float32Array(columns * rows)
		const grid = new Float32Array(columns * rows * 2)
		for (let row = 0; row < rows; row++) {
			for (let column = 0; column < columns; column++) {
				const at = (row * columns + column) * 2
				grid[at] = column / (columns - 1) - 0.5
				grid[at + 1] = -row
			}
		}
		const lines: number[] = []
		const triangles: number[] = []
		for (let row = 0; row < rows; row++) {
			for (let column = 0; column < columns; column++) {
				const index = row * columns + column
				if (column < columns - 1) {
					lines.push(index, index + 1)
				}
				if (row < rows - 1) {
					lines.push(index, index + columns)
				}
				if (column < columns - 1 && row < rows - 1) {
					triangles.push(index, index + 1, index + columns, index + 1, index + columns + 1, index + columns)
				}
			}
		}
		this.#lineCount = lines.length
		this.#fillCount = triangles.length

		const position = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, position)
		gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW)
		const height = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, height)
		gl.bufferData(gl.ARRAY_BUFFER, this.heights, gl.DYNAMIC_DRAW)
		const lineIndices = gl.createBuffer()
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineIndices)
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(lines), gl.STATIC_DRAW)
		const fillIndices = gl.createBuffer()
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fillIndices)
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(triangles), gl.STATIC_DRAW)
		this.#buffers.push(position, height, lineIndices, fillIndices)

		const build = (indices: WebGLBuffer) => {
			const vao = gl.createVertexArray()
			gl.bindVertexArray(vao)
			gl.bindBuffer(gl.ARRAY_BUFFER, position)
			gl.enableVertexAttribArray(0)
			gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
			gl.bindBuffer(gl.ARRAY_BUFFER, height)
			gl.enableVertexAttribArray(1)
			gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0)
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices)
			return vao
		}
		this.#lines = build(lineIndices)
		this.#fill = build(fillIndices)
		gl.bindVertexArray(null)
	}

	/** Upload `heights` to the GPU. */
	upload() {
		const gl = this.#gl
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#buffers[1]!)
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.heights)
	}

	drawLines() {
		this.#gl.bindVertexArray(this.#lines)
		this.#gl.drawElements(this.#gl.LINES, this.#lineCount, this.#gl.UNSIGNED_SHORT, 0)
	}

	drawFill() {
		this.#gl.bindVertexArray(this.#fill)
		this.#gl.drawElements(this.#gl.TRIANGLES, this.#fillCount, this.#gl.UNSIGNED_SHORT, 0)
	}

	dispose() {
		this.#gl.deleteVertexArray(this.#lines)
		this.#gl.deleteVertexArray(this.#fill)
		this.#buffers.forEach((buffer) => this.#gl.deleteBuffer(buffer))
	}
}
