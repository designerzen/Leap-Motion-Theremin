import type { Mesh } from "./geometry.ts"
import { normalMatrix } from "./math.ts"
import type { Mat4 } from "./math.ts"
import { ShaderProgram } from "./program.ts"

/** Exponential squared fog, as THREE.FogExp2: the fraction of fog colour at a given distance. */
const FOG = `
uniform vec3 uCamera;
uniform vec3 uFogColour;
uniform float uFogDensity;
float fogAmount(vec3 world) {
	float depth = length(world - uCamera);
	return 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
}`

const LIT_VERTEX = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
uniform mat4 uViewProjection;
uniform mat4 uModel;
uniform mat3 uNormalMatrix;
out vec3 vNormal;
out vec3 vWorld;
void main() {
	vec4 world = uModel * vec4(aPosition, 1.0);
	vWorld = world.xyz;
	vNormal = uNormalMatrix * aNormal;
	gl_Position = uViewProjection * world;
}`

/** Lambert lighting from one point light and an ambient term, or the normal as colour. */
const LIT_FRAGMENT = `#version 300 es
precision highp float;
${FOG}
uniform vec3 uColour;
uniform vec3 uEmissive;
uniform vec3 uAmbient;
uniform vec3 uLightColour;
uniform vec3 uLightPosition;
uniform float uAlpha;
uniform float uNormalColour;
in vec3 vNormal;
in vec3 vWorld;
out vec4 outColor;
void main() {
	vec3 n = normalize(vNormal);
	if (!gl_FrontFacing) {
		n = -n;
	}
	vec3 lit;
	if (uNormalColour > 0.5) {
		lit = n * 0.5 + 0.5;
	} else {
		float diffuse = max(dot(n, normalize(uLightPosition - vWorld)), 0.0);
		lit = uColour * (uAmbient + uLightColour * diffuse) + uEmissive;
	}
	outColor = vec4(mix(lit, uFogColour, fogAmount(vWorld)), uAlpha);
}`

const LINE_VERTEX = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aColour;
uniform mat4 uViewProjection;
out vec3 vColour;
out vec3 vWorld;
void main() {
	vColour = aColour;
	vWorld = aPosition;
	gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`

/** Additive lines: fog fades them out rather than towards a colour. */
const LINE_FRAGMENT = `#version 300 es
precision highp float;
${FOG}
in vec3 vColour;
in vec3 vWorld;
out vec4 outColor;
void main() {
	outColor = vec4(vColour * (1.0 - fogAmount(vWorld)), 1.0);
}`

const POINT_VERTEX = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aSeed;
uniform mat4 uViewProjection;
uniform mat4 uModel;
uniform float uPointSize;
out float vSeed;
out vec3 vWorld;
void main() {
	vec4 world = uModel * vec4(aPosition, 1.0);
	vWorld = world.xyz;
	vSeed = aSeed;
	gl_Position = uViewProjection * world;
	gl_PointSize = uPointSize * (0.6 + 0.8 * aSeed);
}`

const POINT_FRAGMENT = `#version 300 es
precision highp float;
${FOG}
uniform vec3 uColour;
in float vSeed;
in vec3 vWorld;
out vec4 outColor;
void main() {
	float d = length(gl_PointCoord - 0.5) * 2.0;
	if (d > 1.0) {
		discard;
	}
	float soft = 1.0 - d * d;
	outColor = vec4(uColour * (0.35 + 0.65 * vSeed) * soft * (1.0 - fogAmount(vWorld)), 1.0);
}`

const TERRAIN_VERTEX = `#version 300 es
layout(location = 0) in vec2 aGrid;
layout(location = 1) in float aHeight;
uniform mat4 uViewProjection;
uniform float uWidth;
uniform float uSpacing;
uniform float uScroll;
uniform float uFloor;
out vec3 vWorld;
out float vHeight;
void main() {
	vec3 world = vec3(aGrid.x * uWidth, uFloor + aHeight, aGrid.y * uSpacing + uScroll);
	vWorld = world;
	vHeight = aHeight;
	gl_Position = uViewProjection * vec4(world, 1.0);
}`

const TERRAIN_FRAGMENT = `#version 300 es
precision highp float;
${FOG}
uniform vec3 uColour;
uniform vec3 uFill;
uniform float uPeak;
uniform float uSolid;
in vec3 vWorld;
in float vHeight;
out vec4 outColor;
void main() {
	float lift = clamp(abs(vHeight) / uPeak, 0.0, 1.0);
	vec3 line = uColour * 0.3 + (uColour * 0.7 + 0.3) * lift;
	vec3 colour = mix(line, uFill, uSolid);
	outColor = vec4(mix(colour, uFogColour, fogAmount(vWorld)), 1.0);
}`

export const createLineProgram = (gl: WebGL2RenderingContext) => new ShaderProgram(gl, LINE_VERTEX, LINE_FRAGMENT)
export const createPointProgram = (gl: WebGL2RenderingContext) => new ShaderProgram(gl, POINT_VERTEX, POINT_FRAGMENT)
export const createTerrainProgram = (gl: WebGL2RenderingContext) =>
	new ShaderProgram(gl, TERRAIN_VERTEX, TERRAIN_FRAGMENT)

/** Fog and camera uniforms, shared by every program that includes the fog chunk. */
export function setFog(program: ShaderProgram, camera: ArrayLike<number>, colour: ArrayLike<number>, density: number) {
	program.vec3v("uCamera", camera)
	program.vec3v("uFogColour", colour)
	program.float("uFogDensity", density)
}

/** Lit, fogged meshes. Fill the public scene fields, call `begin()`, then `draw()` per mesh. */
export class Lit {
	readonly program: ShaderProgram
	readonly viewProjection = new Float32Array(16)
	readonly camera = new Float32Array(3)
	readonly light = new Float32Array(3)
	readonly lightColour = new Float32Array([0.6, 0.6, 1])
	readonly ambient = new Float32Array([0.533, 0.4, 0.4])
	readonly fogColour = new Float32Array(3)
	fogDensity = 0
	readonly #normal = new Float32Array(9)

	constructor(gl: WebGL2RenderingContext) {
		this.program = new ShaderProgram(gl, LIT_VERTEX, LIT_FRAGMENT)
	}

	begin() {
		const program = this.program.use()
		program.mat4("uViewProjection", this.viewProjection)
		program.vec3v("uLightPosition", this.light)
		program.vec3v("uLightColour", this.lightColour)
		program.vec3v("uAmbient", this.ambient)
		setFog(program, this.camera, this.fogColour, this.fogDensity)
	}

	draw(
		mesh: Mesh,
		model: Mat4,
		colour: ArrayLike<number>,
		emissive: ArrayLike<number>,
		alpha: number,
		normalColour = 0
	) {
		const program = this.program
		program.mat4("uModel", model)
		program.mat3("uNormalMatrix", normalMatrix(this.#normal, model))
		program.vec3v("uColour", colour)
		program.vec3v("uEmissive", emissive)
		program.float("uAlpha", alpha)
		program.float("uNormalColour", normalColour)
		mesh.draw()
	}

	dispose() {
		this.program.dispose()
	}
}
