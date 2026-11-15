import { ShaderProgram } from "./program.ts"

const FULLSCREEN = `#version 300 es
out vec2 vUv;
void main() {
	vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	vUv = p;
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

/** Optional bright pass followed by a 9 tap gaussian along uDirection, at half resolution. */
const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTexture;
uniform vec2 uDirection;
uniform float uThreshold;
in vec2 vUv;
out vec4 outColor;

vec3 tap(vec2 uv) {
	vec3 c = texture(uTexture, uv).rgb;
	if (uThreshold >= 0.0) {
		float peak = max(c.r, max(c.g, c.b));
		c *= smoothstep(uThreshold, uThreshold + 0.3, peak);
	}
	return c;
}

void main() {
	vec3 sum = tap(vUv) * 0.2270270270;
	sum += (tap(vUv + uDirection * 1.3846153846) + tap(vUv - uDirection * 1.3846153846)) * 0.3162162162;
	sum += (tap(vUv + uDirection * 3.2307692308) + tap(vUv - uDirection * 3.2307692308)) * 0.0702702703;
	outColor = vec4(sum, 1.0);
}`

/**
 * Glitch (DigitalGlitch: block displacement and an RGB split), focus (FocusShader: radial soft
 * focus), bloom added on top, then film (FilmShader: grain and scanlines) in one pass.
 */
const COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uResolution;
uniform float uTime;
uniform float uNoise;
uniform float uScanlines;
uniform float uScanCount;
uniform float uGlitch;
uniform float uFocus;
uniform float uFocusDistance;
uniform float uWaveFactor;
uniform float uBloomAmount;
in vec2 vUv;
out vec4 outColor;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
	vec2 uv = vUv;
	float split = 0.0;
	if (uGlitch > 0.0) {
		float tick = floor(uTime * 14.0);
		// Horizontal tears: whole bands slide sideways.
		float band = floor(uv.y * (14.0 + 26.0 * hash(vec2(tick, 1.0))));
		float tear = step(1.0 - uGlitch * 0.35, hash(vec2(band, tick)));
		uv.x += (hash(vec2(band, tick + 17.0)) - 0.5) * 0.3 * uGlitch * tear;
		// Blocks: rectangles of the picture jump to somewhere else.
		vec2 block = floor(uv * vec2(7.0, 11.0));
		float jump = step(1.0 - uGlitch * 0.12, hash(block + tick * 3.1));
		uv += (vec2(hash(block + 1.7), hash(block + 9.3)) - 0.5) * 0.14 * uGlitch * jump;
		uv = clamp(uv, 0.0, 1.0);
		split = uGlitch * 0.014 * (0.4 + hash(vec2(tick, 5.0)));
	}

	vec4 org;
	if (split > 0.0) {
		org = vec4(texture(uScene, uv + vec2(split, 0.0)).r, texture(uScene, uv).g, texture(uScene, uv - vec2(split, 0.0)).b, 1.0);
	} else {
		org = texture(uScene, uv);
	}

	// Focus: seven taps spread further towards the edges, keeping the darkest of them sharp.
	vec4 color = org;
	vec4 add = org;
	vec4 tmp;
	vec2 vin = (uv - vec2(0.5)) * vec2(1.4);
	float sampleDist = dot(vin, vin) * 2.0;
	float f = (uWaveFactor * 100.0 + sampleDist) * uFocusDistance * 4.0;
	vec2 size = (1.0 / uResolution) * vec2(f);
	add += tmp = texture(uScene, uv + vec2(0.111964, 0.993712) * size); if (tmp.b < color.b) color = tmp;
	add += tmp = texture(uScene, uv + vec2(0.846724, 0.532032) * size); if (tmp.b < color.b) color = tmp;
	add += tmp = texture(uScene, uv + vec2(0.943883, -0.330279) * size); if (tmp.b < color.b) color = tmp;
	add += tmp = texture(uScene, uv + vec2(0.330279, -0.943883) * size); if (tmp.b < color.b) color = tmp;
	add += tmp = texture(uScene, uv + vec2(-0.532032, -0.846724) * size); if (tmp.b < color.b) color = tmp;
	add += tmp = texture(uScene, uv + vec2(-0.993712, -0.111964) * size); if (tmp.b < color.b) color = tmp;
	add += tmp = texture(uScene, uv + vec2(-0.707107, 0.707107) * size); if (tmp.b < color.b) color = tmp;
	color = color * vec4(2.0) - (add / vec4(8.0));
	color = color + (add / vec4(8.0) - color) * (vec4(1.0) - vec4(sampleDist * 0.5));
	vec3 focused = color.rgb * color.rgb * vec3(0.95) + color.rgb;
	vec3 rgb = mix(org.rgb, focused, uFocus);

	rgb += texture(uBloom, uv).rgb * uBloomAmount;

	// Film: static, scanlines, and a touch of additive grain so dark scenes show it too.
	float x = vUv.x * vUv.y * uTime * 1000.0;
	x = mod(x, 13.0) * mod(x, 123.0);
	float dx = mod(x, 0.01);
	vec3 result = rgb + rgb * clamp(0.1 + dx * 100.0, 0.0, 1.0);
	vec2 sc = vec2(sin(vUv.y * uScanCount), cos(vUv.y * uScanCount));
	result += rgb * vec3(sc.x, sc.y, sc.x) * uScanlines;
	result += (hash(vUv * uResolution + uTime) - 0.5) * 0.035;
	rgb = rgb + clamp(uNoise, 0.0, 1.0) * (result - rgb);

	outColor = vec4(rgb, 1.0);
}`

/** What the final pass does this frame. */
export interface PostSettings {
	/** Seconds, wrapped by the caller; 0 freezes grain and glitch. */
	time: number
	/** Film noise (FilmShader nIntensity) and scanline (sIntensity) strengths, 0..1. */
	noise: number
	scanlines: number
	/** Scanline frequency in radians across the height (FilmShader sCount). */
	scanCount: number
	/** Glitch amount 0..1; 0 skips the effect. */
	glitch: number
	/** Mix of the focus shader's contrast boost, 0..1, and its sample spread. */
	focus: number
	focusDistance: number
	waveFactor: number
	/** Bloom strength and the brightness above which things bloom. */
	bloom: number
	threshold: number
}

interface Target {
	texture: WebGLTexture
	framebuffer: WebGLFramebuffer
	depth: WebGLRenderbuffer | null
	width: number
	height: number
}

/**
 * Renders a scene offscreen, then blooms it (bright pass and separable blur at half resolution)
 * and composites film, glitch and focus onto the canvas. Call `begin()`, draw the scene, `end()`.
 */
export class PostProcess {
	readonly #gl: WebGL2RenderingContext
	readonly #blur: ShaderProgram
	readonly #composite: ShaderProgram
	readonly #empty: WebGLVertexArrayObject
	#scene: Target | undefined
	#half: [Target, Target] | undefined

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl
		this.#blur = new ShaderProgram(gl, FULLSCREEN, BLUR)
		this.#composite = new ShaderProgram(gl, FULLSCREEN, COMPOSITE)
		this.#empty = gl.createVertexArray()
	}

	#target(width: number, height: number, depth: boolean): Target {
		const gl = this.#gl
		const texture = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_2D, texture)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		const framebuffer = gl.createFramebuffer()
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
		let renderbuffer: WebGLRenderbuffer | null = null
		if (depth) {
			renderbuffer = gl.createRenderbuffer()
			gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer)
			gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height)
			gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer)
		}
		const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
		gl.bindFramebuffer(gl.FRAMEBUFFER, null)
		if (status !== gl.FRAMEBUFFER_COMPLETE) {
			throw new Error(`Offscreen framebuffer is incomplete (${status})`)
		}
		return { texture, framebuffer, depth: renderbuffer, width, height }
	}

	#release(target: Target | undefined) {
		if (target) {
			this.#gl.deleteTexture(target.texture)
			this.#gl.deleteFramebuffer(target.framebuffer)
			if (target.depth) {
				this.#gl.deleteRenderbuffer(target.depth)
			}
		}
	}

	/** Bind the offscreen scene target, sized to the canvas, with the viewport set. */
	begin() {
		const gl = this.#gl
		const width = Math.max(1, gl.drawingBufferWidth)
		const height = Math.max(1, gl.drawingBufferHeight)
		if (!this.#scene || this.#scene.width !== width || this.#scene.height !== height) {
			this.#release(this.#scene)
			this.#half?.forEach((target) => this.#release(target))
			const halfWidth = Math.max(1, width >> 1)
			const halfHeight = Math.max(1, height >> 1)
			this.#scene = this.#target(width, height, true)
			this.#half = [this.#target(halfWidth, halfHeight, false), this.#target(halfWidth, halfHeight, false)]
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.#scene.framebuffer)
		gl.viewport(0, 0, width, height)
	}

	/** Run the passes and leave the result on the canvas. */
	end(settings: PostSettings) {
		const gl = this.#gl
		const scene = this.#scene
		const half = this.#half
		if (!scene || !half) {
			return
		}
		gl.disable(gl.DEPTH_TEST)
		gl.disable(gl.BLEND)
		gl.disable(gl.CULL_FACE)
		gl.depthMask(true)
		gl.bindVertexArray(this.#empty)

		const [first, second] = half
		gl.viewport(0, 0, first.width, first.height)
		this.#blur.use()
		this.#blur.int("uTexture", 0)
		gl.activeTexture(gl.TEXTURE0)

		gl.bindFramebuffer(gl.FRAMEBUFFER, first.framebuffer)
		gl.bindTexture(gl.TEXTURE_2D, scene.texture)
		this.#blur.vec2("uDirection", 1 / first.width, 0)
		this.#blur.float("uThreshold", settings.threshold)
		gl.drawArrays(gl.TRIANGLES, 0, 3)

		gl.bindFramebuffer(gl.FRAMEBUFFER, second.framebuffer)
		gl.bindTexture(gl.TEXTURE_2D, first.texture)
		this.#blur.vec2("uDirection", 0, 1 / first.height)
		this.#blur.float("uThreshold", -1)
		gl.drawArrays(gl.TRIANGLES, 0, 3)

		gl.bindFramebuffer(gl.FRAMEBUFFER, null)
		gl.viewport(0, 0, scene.width, scene.height)
		const composite = this.#composite.use()
		composite.int("uScene", 0)
		composite.int("uBloom", 1)
		composite.vec2("uResolution", scene.width, scene.height)
		composite.float("uTime", settings.time)
		composite.float("uNoise", settings.noise)
		composite.float("uScanlines", settings.scanlines)
		composite.float("uScanCount", settings.scanCount)
		composite.float("uGlitch", settings.glitch)
		composite.float("uFocus", settings.focus)
		composite.float("uFocusDistance", settings.focusDistance)
		composite.float("uWaveFactor", settings.waveFactor)
		composite.float("uBloomAmount", settings.bloom)
		gl.bindTexture(gl.TEXTURE_2D, scene.texture)
		gl.activeTexture(gl.TEXTURE1)
		gl.bindTexture(gl.TEXTURE_2D, second.texture)
		gl.drawArrays(gl.TRIANGLES, 0, 3)
		gl.activeTexture(gl.TEXTURE0)
		gl.bindVertexArray(null)
	}

	dispose() {
		this.#release(this.#scene)
		this.#half?.forEach((target) => this.#release(target))
		this.#scene = undefined
		this.#half = undefined
		this.#blur.dispose()
		this.#composite.dispose()
		this.#gl.deleteVertexArray(this.#empty)
	}
}
