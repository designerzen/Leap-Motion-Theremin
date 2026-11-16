import type { HandRig } from "../hand/rig.ts"
import { LIT_FRAGMENT, setFog } from "./materials.ts"
import type { Lit } from "./materials.ts"
import { ShaderProgram } from "./program.ts"

const SKIN_VERTEX = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aSkinIndex;
layout(location = 3) in vec2 aSkinWeight;
uniform mat4 uViewProjection;
uniform mat4 uBones[21];
out vec3 vNormal;
out vec3 vWorld;
void main() {
	mat4 skin = uBones[int(aSkinIndex.x)] * aSkinWeight.x + uBones[int(aSkinIndex.y)] * aSkinWeight.y;
	vec4 world = skin * vec4(aPosition, 1.0);
	vWorld = world.xyz;
	vNormal = mat3(skin) * aNormal;
	gl_Position = uViewProjection * world;
}`

/** Two-weight skinning, with the same Lambert lighting and fog as the world meshes. */
export class SkinnedLit {
	readonly #program: ShaderProgram
	constructor(gl: WebGL2RenderingContext) {
		this.#program = new ShaderProgram(gl, SKIN_VERTEX, LIT_FRAGMENT)
	}

	draw(mesh: SkinnedMesh, bones: Float32Array, scene: Lit, colour: Float32Array, emissive: Float32Array) {
		const p = this.#program.use()
		p.mat4("uViewProjection", scene.viewProjection)
		// uniformMatrix4fv accepts a packed array of matrices as well as a single matrix.
		p.mat4("uBones[0]", bones)
		p.vec3v("uLightPosition", scene.light)
		p.vec3v("uLightColour", scene.lightColour)
		p.vec3v("uAmbient", scene.ambient)
		setFog(p, scene.camera, scene.fogColour, scene.fogDensity)
		p.vec3v("uColour", colour)
		p.vec3v("uEmissive", emissive)
		p.float("uAlpha", 0.7)
		p.float("uNormalColour", 0)
		mesh.draw()
	}

	dispose() {
		this.#program.dispose()
	}
}

export class SkinnedMesh {
	readonly #vao: WebGLVertexArrayObject
	readonly #buffers: WebGLBuffer[] = []
	readonly #count: number
	constructor(readonly gl: WebGL2RenderingContext, readonly rig: HandRig) {
		this.#vao = gl.createVertexArray()
		gl.bindVertexArray(this.#vao)
		const data = rig.data
		const attributes = [new Float32Array(data.positions), rig.normals, new Float32Array(data.skinIndices), new Float32Array(data.skinWeights)]
		attributes.forEach((values, location) => {
			const buffer = gl.createBuffer()
			this.#buffers.push(buffer)
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
			gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW)
			gl.enableVertexAttribArray(location)
			gl.vertexAttribPointer(location, location < 2 ? 3 : 2, gl.FLOAT, false, 0, 0)
		})
		const indices = gl.createBuffer()
		this.#buffers.push(indices)
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices)
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.indices), gl.STATIC_DRAW)
		this.#count = data.indices.length
		gl.bindVertexArray(null)
	}

	draw() {
		this.gl.bindVertexArray(this.#vao)
		this.gl.drawElements(this.gl.TRIANGLES, this.#count, this.gl.UNSIGNED_SHORT, 0)
	}

	dispose() {
		this.gl.deleteVertexArray(this.#vao)
		for (const buffer of this.#buffers) this.gl.deleteBuffer(buffer)
	}
}
