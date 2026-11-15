function compile(gl: WebGL2RenderingContext, type: number, source: string) {
	const shader = gl.createShader(type)
	if (!shader) {
		throw new Error("Could not create a shader")
	}
	gl.shaderSource(shader, source)
	gl.compileShader(shader)
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader)
		gl.deleteShader(shader)
		throw new Error(`${type === gl.VERTEX_SHADER ? "Vertex" : "Fragment"} shader failed to compile: ${log}`)
	}
	return shader
}

/** A linked GLSL ES 3.00 program with cached uniform lookups. */
export class ShaderProgram {
	readonly program: WebGLProgram
	readonly #gl: WebGL2RenderingContext
	readonly #locations = new Map<string, WebGLUniformLocation | null>()

	constructor(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
		this.#gl = gl
		const vertexShader = compile(gl, gl.VERTEX_SHADER, vertex)
		let fragmentShader: WebGLShader
		try {
			fragmentShader = compile(gl, gl.FRAGMENT_SHADER, fragment)
		} catch (error) {
			gl.deleteShader(vertexShader)
			throw error
		}
		const program = gl.createProgram()
		gl.attachShader(program, vertexShader)
		gl.attachShader(program, fragmentShader)
		gl.linkProgram(program)
		gl.deleteShader(vertexShader)
		gl.deleteShader(fragmentShader)
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			const log = gl.getProgramInfoLog(program)
			gl.deleteProgram(program)
			throw new Error(`Program failed to link: ${log}`)
		}
		this.program = program
	}

	use() {
		this.#gl.useProgram(this.program)
		return this
	}

	#at(name: string) {
		let location = this.#locations.get(name)
		if (location === undefined) {
			location = this.#gl.getUniformLocation(this.program, name)
			this.#locations.set(name, location)
		}
		return location
	}

	float(name: string, value: number) {
		this.#gl.uniform1f(this.#at(name), value)
	}

	int(name: string, value: number) {
		this.#gl.uniform1i(this.#at(name), value)
	}

	vec2(name: string, x: number, y: number) {
		this.#gl.uniform2f(this.#at(name), x, y)
	}

	vec3(name: string, x: number, y: number, z: number) {
		this.#gl.uniform3f(this.#at(name), x, y, z)
	}

	vec3v(name: string, value: ArrayLike<number>) {
		this.#gl.uniform3f(this.#at(name), value[0]!, value[1]!, value[2]!)
	}

	mat3(name: string, value: Float32Array) {
		this.#gl.uniformMatrix3fv(this.#at(name), false, value)
	}

	mat4(name: string, value: Float32Array) {
		this.#gl.uniformMatrix4fv(this.#at(name), false, value)
	}

	dispose() {
		this.#gl.deleteProgram(this.program)
		this.#locations.clear()
	}
}
