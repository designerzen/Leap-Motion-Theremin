import { loadRig } from "../hand/rig.ts"
import { SkinnedLit, SkinnedMesh } from "../gl/skin.ts"
import type { HandSide } from "../types.ts"
import { GridMesh, LineBatch, Mesh, PointCloud, cubeData, cylinderData, icosahedronData, sphereData } from "../gl/geometry.ts"
import {
	Lit,
	createLineProgram,
	createPointProgram,
	createTerrainProgram,
	setFog
} from "../gl/materials.ts"
import {
	clamp01,
	createMat4,
	fromPositionScale,
	hslToRgb,
	identity,
	lookAt,
	multiply,
	orient,
	parseColour,
	perspective,
	rotateX,
	rotateY,
	scale,
	seeded,
	translate
} from "../gl/math.ts"
import type { Rgb } from "../gl/math.ts"
import { PostProcess } from "../gl/postprocess.ts"
import type { PostSettings } from "../gl/postprocess.ts"
import type { ShaderProgram } from "../gl/program.ts"
import { HAND_BONES, JOINT_COUNT, PALM_OUTLINE } from "../types.ts"
import type { DrawFrame, DrawHand, Surface } from "../types.ts"
import { hsl, hueFor, isRoot, linear, scaleLabels, soundingNotes, toX } from "./common.ts"

const FOV = Math.PI / 4
const MAX_HANDS = 8
const SAMPLES = 2048
/** Hands are drawn smaller than the tracking volume, about the palm, like the original's scale setting. */
const HAND_SCALE = 0.7

/** The original rigged hand was tinted with hue 0.564. */
const HAND_HUE = 203
const BACKGROUND: Rgb = [0.027, 0.031, 0.051]
const ACCENT: Rgb = [0.35, 0.75, 1]
/** The original scene's fog colour, 0x00ff77. */
const GREEN: Rgb = [0, 1, 0.467]
const WHITE = new Float32Array([1, 1, 1])
const BLACK = new Float32Array([0, 0, 0])

/** Everything both worlds share on the GPU. */
class Common {
	readonly lit: Lit
	readonly skin: SkinnedLit
	readonly rigs = new Map<HandSide, SkinnedMesh>()
	#disposed = false
	readonly cube: Mesh
	readonly sphere: Mesh
	readonly orb: Mesh
	readonly bone: Mesh
	readonly palm: Mesh
	readonly post: PostProcess

	constructor(readonly gl: WebGL2RenderingContext) {
		this.lit = new Lit(gl)
		this.skin = new SkinnedLit(gl)
		for (const side of ["left", "right"] as const) {
			void loadRig(side).then((rig) => {
				if (!this.#disposed) this.rigs.set(side, new SkinnedMesh(gl, rig))
			}).catch((error: unknown) => console.warn("Theremid: hand rig could not load", error))
		}
		this.cube = new Mesh(gl, cubeData())
		this.sphere = new Mesh(gl, sphereData(14, 20))
		this.orb = new Mesh(gl, icosahedronData())
		this.bone = new Mesh(gl, cylinderData(8))
		this.palm = new Mesh(gl, { positions: new Float32Array(36), normals: new Float32Array(36) }, true)
		this.post = new PostProcess(gl)
	}

	dispose() {
		this.#disposed = true
		this.skin.dispose()
		for (const rig of this.rigs.values()) rig.dispose()
		this.rigs.clear()
		this.lit.dispose()
		for (const mesh of [this.cube, this.sphere, this.orb, this.bone, this.palm]) {
			mesh.dispose()
		}
		this.post.dispose()
	}
}

/**
 * Shared plumbing for the 3D surfaces: lazily created GPU resources keyed on the context, a 2D
 * fallback, the waveform, the hands and the postprocessing stack.
 *
 * World units: the plane z = 0 is the hand plane. Normalised hand x spans `spanX` centred on 0,
 * y (down) spans `spanY` around `centreY`, and z pushes away from the camera (towards -z).
 */
abstract class World implements Surface {
	readonly gl = true
	map = linear
	protected width = 1
	protected height = 1
	protected spanX = 1
	protected spanY = 1
	protected spanZ = 1
	protected centreY = 0
	protected background: Rgb = BACKGROUND
	protected accent: Rgb = ACCENT
	/** Time domain samples: the live waveform, or a gentle synthetic one when silent. */
	protected readonly samples = new Float32Array(SAMPLES)
	/** Smoothed loudness 0..1. */
	protected level = 0
	protected readonly projection = createMat4()
	protected readonly view = createMat4()
	protected readonly model = createMat4()
	#common: Common | undefined
	#failed: WebGL2RenderingContext | undefined
	#glitch = 0
	#backgroundCss = ""
	#accentCss = ""
	readonly #bones = new Float32Array(21 * 16)
	readonly #pose = new Float32Array(JOINT_COUNT * 3)
	readonly #palm = new Float32Array(36)
	readonly #palmNormals = new Float32Array(36)
	readonly #tint = new Float32Array(3)
	readonly #emissive = new Float32Array(3)
	readonly #post: PostSettings = {
		time: 0,
		noise: 0.8,
		scanlines: 0.7,
		scanCount: 1448,
		glitch: 0,
		focus: 0.6,
		focusDistance: 0.94,
		waveFactor: 0.00125,
		bloom: 0.7,
		threshold: 0.55
	}

	protected abstract build(gl: WebGL2RenderingContext, common: Common): void
	protected abstract release(): void
	protected abstract render(frame: DrawFrame, gl: WebGL2RenderingContext, common: Common): void

	resize(width: number, height: number) {
		this.width = width
		this.height = height
	}

	draw(frame: DrawFrame) {
		if (frame.width !== this.width || frame.height !== this.height) {
			this.resize(frame.width, frame.height)
		}
		const gl = frame.gl
		if (gl && gl !== this.#failed) {
			try {
				this.#theme(frame)
				if (this.#common?.gl !== gl) {
					this.#destroy()
					this.#common = new Common(gl)
					this.build(gl, this.#common)
				}
				this.#analyse(frame)
				this.render(frame, gl, this.#common)
				scaleLabels(frame, frame.height - 10)
				return
			} catch (error) {
				console.warn("Theremid: the 3D surface could not draw, falling back to 2D", error)
				this.#failed = gl
				this.#destroy()
			}
		}
		this.#fallback(frame)
	}

	dispose() {
		this.#destroy()
	}

	#destroy() {
		this.release()
		this.#common?.dispose()
		this.#common = undefined
	}

	/** Without WebGL: a dark field with a lane for every scale note. */
	#fallback(frame: DrawFrame) {
		const { g, width, height, tonality, theme } = frame
		if (!g) {
			return
		}
		g.fillStyle = theme.background
		g.fillRect(0, 0, width, height)
		const lit = soundingNotes(frame)
		for (const note of tonality.notes) {
			const sounding = lit.has(note)
			g.fillStyle = sounding
				? hsl(hueFor(note), 90, 60, 0.7)
				: isRoot(tonality, note)
					? "rgba(255,255,255,0.16)"
					: "rgba(255,255,255,0.05)"
			g.fillRect(toX(tonality.positionOf(note), width) - 0.5, 0, sounding ? 3 : 1, height)
		}
		scaleLabels(frame, height - 10)
	}

	#theme(frame: DrawFrame) {
		if (frame.theme.background !== this.#backgroundCss) {
			this.#backgroundCss = frame.theme.background
			this.background = parseColour(frame.theme.background, BACKGROUND)
		}
		if (frame.theme.accent !== this.#accentCss) {
			this.#accentCss = frame.theme.accent
			this.accent = parseColour(frame.theme.accent, ACCENT)
		}
	}

	#analyse(frame: DrawFrame) {
		const { waveform, time, dt, reducedMotion } = frame
		let target = 0
		if (waveform?.length) {
			let energy = 0
			for (let index = 0; index < SAMPLES; index++) {
				const sample = waveform[Math.min(index, waveform.length - 1)]!
				this.samples[index] = sample
				energy += sample * sample
			}
			target = Math.min(1, Math.sqrt(energy / SAMPLES) * 3)
		} else {
			this.synthesise(time * (reducedMotion ? 0.00015 : 0.001))
		}
		this.level += (target - this.level) * Math.min(1, dt * 8)
	}

	/** A quiet, slowly moving waveform for when nothing is attached or sounding. */
	protected synthesise(t: number) {
		for (let index = 0; index < SAMPLES; index++) {
			this.samples[index] = 0.09 * Math.sin(index * 0.037 + t * 0.9) + 0.05 * Math.sin(index * 0.11 - t * 0.5)
		}
	}

	/** Size the world so the hand plane exactly fills a camera at this distance. */
	protected layout(distance: number) {
		this.spanY = 2 * distance * Math.tan(FOV / 2) * 0.985
		this.spanX = this.spanY * (this.width / Math.max(1, this.height))
	}

	protected setCamera(
		common: Common,
		ex: number, ey: number, ez: number,
		tx: number, ty: number, tz: number
	) {
		perspective(this.projection, FOV, this.width / Math.max(1, this.height), 1, 1000)
		lookAt(this.view, ex, ey, ez, tx, ty, tz)
		multiply(common.lit.viewProjection, this.projection, this.view)
		common.lit.camera.set([ex, ey, ez])
	}

	/** Normalised hand coordinates to world space, written into out at the offset. */
	protected place(out: Float32Array, offset: number, x: number, y: number, z: number) {
		out[offset] = (x - 0.5) * this.spanX
		out[offset + 1] = this.centreY + (0.5 - y) * this.spanY
		out[offset + 2] = (0.5 - z) * this.spanZ
	}

	/** Skinned hands, a loading fallback, or a glowing orb when only a point is tracked. */
	protected drawHands(frame: DrawFrame, common: Common) {
		const { lit, bone, sphere, orb } = common
		const pose = this.#pose
		const model = this.model
		const count = Math.min(frame.hands.length, MAX_HANDS)
		lit.begin()
		for (let index = 0; index < count; index++) {
			const hand = frame.hands[index]!
			const sounding = hand.notes.length > 0
			const hue = sounding ? hueFor(hand.gesture.pitch) : HAND_HUE
			hslToRgb(hue, sounding ? 0.85 : hand.grab, 0.5, this.#tint)
			const glow = sounding ? 0.3 + 0.7 * hand.gesture.expression : 0
			for (let channel = 0; channel < 3; channel++) {
				this.#emissive[channel] = 0.2 + this.#tint[channel]! * glow
			}
			const joints = hand.joints
			if (joints && joints.length >= JOINT_COUNT * 3) {
				for (let joint = 0; joint < JOINT_COUNT; joint++) {
					const at = joint * 3
					this.place(
						pose,
						at,
						hand.x + (joints[at]! - hand.x) * HAND_SCALE,
						hand.y + (joints[at + 1]! - hand.y) * HAND_SCALE,
						hand.z + (joints[at + 2]! - hand.z) * HAND_SCALE
					)
				}
				const mesh = common.rigs.get(hand.side)
				if (mesh) {
					mesh.rig.pose(pose, this.#bones)
					common.skin.draw(mesh, this.#bones, lit, this.#tint, this.#emissive)
					lit.begin()
					continue
				}
				this.#drawPalm(common)
				const boneRadius = this.spanY * 0.007
				for (const [from, to] of HAND_BONES) {
					orient(
						model,
						pose[from * 3]!, pose[from * 3 + 1]!, pose[from * 3 + 2]!,
						pose[to * 3]!, pose[to * 3 + 1]!, pose[to * 3 + 2]!,
						boneRadius
					)
					lit.draw(bone, model, this.#tint, this.#emissive, 0.7)
				}
				for (let joint = 0; joint < JOINT_COUNT; joint++) {
					// The wrist and the knuckles read larger, as on the original rigged hand.
					const radius = this.spanY * (joint === 0 ? 0.017 : joint % 4 === 1 ? 0.0135 : 0.0105)
					fromPositionScale(model, pose[joint * 3]!, pose[joint * 3 + 1]!, pose[joint * 3 + 2]!, radius)
					lit.draw(sphere, model, this.#tint, this.#emissive, 0.7)
				}
			} else {
				this.place(pose, 0, hand.x, hand.y, hand.z)
				const radius = this.spanY * (0.026 + 0.012 * hand.gesture.expression + 0.01 * hand.grab)
				fromPositionScale(model, pose[0]!, pose[1]!, pose[2]!, radius)
				if (!sounding) {
					for (let channel = 0; channel < 3; channel++) {
						this.#tint[channel] = this.accent[channel]!
						this.#emissive[channel] = this.accent[channel]! * 0.5
					}
				}
				lit.draw(orb, model, this.#tint, this.#emissive, 0.85)
			}
		}
	}

	/** A translucent fan across the palm, from the joints in PALM_OUTLINE. */
	#drawPalm(common: Common) {
		const pose = this.#pose
		const outline = PALM_OUTLINE
		const origin = outline[0]! * 3
		let cursor = 0
		for (let corner = 1; corner < outline.length - 1; corner++) {
			const b = outline[corner]! * 3
			const c = outline[corner + 1]! * 3
			const ux = pose[b]! - pose[origin]!
			const uy = pose[b + 1]! - pose[origin + 1]!
			const uz = pose[b + 2]! - pose[origin + 2]!
			const vx = pose[c]! - pose[origin]!
			const vy = pose[c + 1]! - pose[origin + 1]!
			const vz = pose[c + 2]! - pose[origin + 2]!
			let nx = uy * vz - uz * vy
			let ny = uz * vx - ux * vz
			let nz = ux * vy - uy * vx
			const length = Math.hypot(nx, ny, nz) || 1
			nx /= length
			ny /= length
			nz /= length
			for (const at of [origin, b, c]) {
				this.#palm[cursor] = pose[at]!
				this.#palm[cursor + 1] = pose[at + 1]!
				this.#palm[cursor + 2] = pose[at + 2]!
				this.#palmNormals[cursor] = nx
				this.#palmNormals[cursor + 1] = ny
				this.#palmNormals[cursor + 2] = nz
				cursor += 3
			}
		}
		common.palm.update(this.#palm, this.#palmNormals)
		identity(this.model)
		common.lit.draw(common.palm, this.model, this.#tint, this.#emissive, 0.35)
	}

	/** Composite film, focus, bloom and (on a fist) glitch onto the canvas. */
	protected finish(frame: DrawFrame, common: Common, bloom: number, glitch: number) {
		let grab = 0
		for (const hand of frame.hands) {
			grab = Math.max(grab, hand.grab)
		}
		const target = frame.reducedMotion ? 0 : clamp01((grab - 0.5) * 2) * glitch
		this.#glitch += (target - this.#glitch) * Math.min(1, frame.dt * 12)
		const settings = this.#post
		settings.time = frame.reducedMotion ? 0 : (frame.time / 1000) % 64
		settings.scanCount = (1448 * frame.height) / 900
		settings.glitch = this.#glitch < 0.01 ? 0 : this.#glitch
		settings.bloom = bloom
		common.post.end(settings)
	}
}

const HOLOGRAM_DISTANCE = 110

/**
 * The original 2014 scene: a normal-coloured sphere, a translucent box under each hand, and a
 * point cloud shaped by the waveform, in green fog, with hands you can see.
 */
export class Hologram extends World {
	#cloud: PointCloud | undefined
	#points: ShaderProgram | undefined
	#base = new Float32Array(SAMPLES * 2)
	readonly #boxTint = new Float32Array(3)

	protected build(gl: WebGL2RenderingContext) {
		const random = seeded(2014)
		const positions = new Float32Array(SAMPLES * 3)
		const seeds = new Float32Array(SAMPLES)
		for (let index = 0; index < SAMPLES; index++) {
			positions[index * 3] = (random() * 2 - 1) * 80
			this.#base[index * 2] = (random() * 2 - 1) * 80
			this.#base[index * 2 + 1] = (random() * 2 - 1) * 80
			seeds[index] = random()
		}
		this.#cloud = new PointCloud(gl, positions, seeds)
		this.#points = createPointProgram(gl)
	}

	protected release() {
		this.#cloud?.dispose()
		this.#points?.dispose()
		this.#cloud = undefined
		this.#points = undefined
	}

	protected render(frame: DrawFrame, gl: WebGL2RenderingContext, common: Common) {
		const { time, reducedMotion, tonality } = frame
		const { lit } = common
		const model = this.model
		const spin = reducedMotion ? 0 : time
		this.layout(HOLOGRAM_DISTANCE)
		this.spanZ = this.spanY * 0.6
		this.centreY = 0
		const elevation = 0.2
		const sway = reducedMotion ? 0 : Math.sin(time * 0.0002) * 2.5
		this.setCamera(
			common,
			sway, HOLOGRAM_DISTANCE * Math.sin(elevation), HOLOGRAM_DISTANCE * Math.cos(elevation),
			0, 0, 0
		)
		const [br, bg, bb] = this.background
		for (let channel = 0; channel < 3; channel++) {
			lit.fogColour[channel] = this.background[channel]! + (GREEN[channel]! - this.background[channel]!) * 0.22
		}
		lit.fogDensity = 0.0045
		lit.light.set([0, 35, 55])

		common.post.begin()
		gl.clearColor(br, bg, bb, 1)
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
		gl.enable(gl.DEPTH_TEST)
		gl.depthFunc(gl.LEQUAL)
		gl.depthMask(true)
		gl.disable(gl.BLEND)
		gl.enable(gl.CULL_FACE)
		gl.cullFace(gl.BACK)

		// The sphere, coloured by its normals like MeshNormalMaterial.
		lit.begin()
		identity(model)
		rotateY(model, model, spin * 0.0004)
		scale(model, model, 15, 15, 15)
		lit.draw(common.sphere, model, WHITE, BLACK, 1, 1)

		// Translucent things: boxes and hands.
		gl.depthMask(false)
		gl.disable(gl.CULL_FACE)
		gl.enable(gl.BLEND)
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
		const boxes = Math.min(frame.hands.length, MAX_HANDS)
		const floor = -this.spanY * 0.46
		for (let index = 0; index < boxes; index++) {
			const hand = frame.hands[index]!
			const sounding = hand.notes.length > 0
			const height = 40 * (0.3 + 1.1 * clamp01(tonality.positionOf(hand.gesture.pitch)))
			hslToRgb(sounding ? hueFor(hand.gesture.pitch) : HAND_HUE, sounding ? 0.6 : 0.15, 0.78, this.#boxTint)
			const x = (hand.x - 0.5) * this.spanX
			const z = (0.5 - hand.z) * this.spanZ
			identity(model)
			translate(model, model, x, floor + height / 2, z)
			rotateY(model, model, spin * 0.0003 * (index % 2 ? -1 : 1) + index)
			scale(model, model, 20, height, 20)
			lit.draw(common.cube, model, this.#boxTint, BLACK, 0.12 + 0.5 * hand.gesture.expression + (sounding ? 0.15 : 0))
		}

		// The point cloud: vertex i follows sample i and sample i + 1, as in View.prototype.update.
		const cloud = this.#cloud!
		const points = this.#points!
		const positions = cloud.positions
		const reach = 60
		for (let index = 0; index < SAMPLES; index++) {
			positions[index * 3 + 1] = this.#base[index * 2]! * 0.3 + this.samples[index]! * reach
			positions[index * 3 + 2] =
				this.#base[index * 2 + 1]! * 0.3 + this.samples[Math.min(index + 1, SAMPLES - 1)]! * reach
		}
		gl.disable(gl.DEPTH_TEST)
		gl.blendFunc(gl.ONE, gl.ONE)
		points.use()
		points.mat4("uViewProjection", lit.viewProjection)
		identity(model)
		rotateY(model, model, 1.7 - spin * 0.00012)
		rotateX(model, model, 0.6 + spin * 0.00005)
		const pulse = 1 + this.level * 0.5
		scale(model, model, pulse, pulse, pulse)
		points.mat4("uModel", model)
		points.float("uPointSize", 3.2 * frame.pixelRatio)
		points.vec3v("uColour", this.accent)
		setFog(points, lit.camera, lit.fogColour, lit.fogDensity)
		cloud.draw()

		// Draw the translucent hands last, with the scene depth buffer still respected.
		gl.enable(gl.DEPTH_TEST)
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
		this.drawHands(frame, common)

		gl.disable(gl.BLEND)
		gl.depthMask(true)
		this.finish(frame, common, 0.8, 1)
	}
}

const TERRAIN_COLUMNS = 96
const TERRAIN_ROWS = 64
const TERRAIN_SPACING = 3.4
/** How many samples of the waveform one row of the terrain spans. */
const TERRAIN_WINDOW = 512
const TERRAIN_DISTANCE = 80

/** A wireframe landscape of sound rolling away into fog, with a pillar of light for every note. */
export class Terrain extends World {
	#grid: GridMesh | undefined
	#lines: LineBatch | undefined
	#lineProgram: ShaderProgram | undefined
	#terrainProgram: ShaderProgram | undefined
	#scroll = 0
	#glow = new Float32Array(0)
	readonly #colour = new Float32Array(3)

	protected build(gl: WebGL2RenderingContext) {
		this.layout(TERRAIN_DISTANCE)
		this.#grid = new GridMesh(gl, TERRAIN_COLUMNS, TERRAIN_ROWS)
		this.#lines = new LineBatch(gl, 512)
		this.#lineProgram = createLineProgram(gl)
		this.#terrainProgram = createTerrainProgram(gl)
		// Start with a landscape instead of a flat plain.
		for (let row = TERRAIN_ROWS; row > 0; row--) {
			this.synthesise(-row * 0.2)
			this.#pushRow([])
		}
	}

	protected release() {
		this.#grid?.dispose()
		this.#lines?.dispose()
		this.#lineProgram?.dispose()
		this.#terrainProgram?.dispose()
		this.#grid = undefined
		this.#lines = undefined
		this.#lineProgram = undefined
		this.#terrainProgram = undefined
	}

	/** Every row moves one step away and the nearest takes its heights from the waveform. */
	#pushRow(hands: readonly DrawHand[]) {
		const heights = this.#grid!.heights
		const amplitude = this.spanY * 0.3
		heights.copyWithin(TERRAIN_COLUMNS, 0, (TERRAIN_ROWS - 1) * TERRAIN_COLUMNS)
		for (let column = 0; column < TERRAIN_COLUMNS; column++) {
			const taper = Math.pow(Math.sin((Math.PI * (column + 0.5)) / TERRAIN_COLUMNS), 0.7)
			const sample = this.samples[Math.floor((column / TERRAIN_COLUMNS) * TERRAIN_WINDOW)]!
			heights[column] = sample * amplitude * taper
		}
		// A sounding hand raises a swell under itself.
		for (const hand of hands) {
			if (hand.notes.length) {
				const centre = (0.5 + (hand.x - 0.5) / 1.8) * (TERRAIN_COLUMNS - 1)
				for (let column = Math.max(0, Math.floor(centre) - 8); column <= Math.min(TERRAIN_COLUMNS - 1, centre + 8); column++) {
					const distance = (column - centre) / 3
					heights[column] = heights[column]! + amplitude * 0.9 * hand.gesture.expression * Math.exp(-distance * distance)
				}
			}
		}
	}

	protected render(frame: DrawFrame, gl: WebGL2RenderingContext, common: Common) {
		const { time, dt, reducedMotion, tonality, width } = frame
		const { lit } = common
		const grid = this.#grid!
		const lines = this.#lines!
		this.layout(TERRAIN_DISTANCE)
		this.spanZ = 50
		this.centreY = 0
		const floor = -this.spanY * 0.3
		const sway = reducedMotion ? 0 : Math.sin(time * 0.00015) * 3
		this.setCamera(common, sway, 0, TERRAIN_DISTANCE, 0, -4, -120)
		const [br, bg, bb] = this.background
		lit.fogColour.set(this.background)
		lit.fogDensity = 0.0075
		lit.light.set([0, 30, 40])

		this.#scroll += Math.min(dt, 0.1) * (reducedMotion ? 1.2 : 7)
		while (this.#scroll >= 1) {
			this.#scroll -= 1
			this.#pushRow(frame.hands)
		}
		grid.upload()

		common.post.begin()
		gl.clearColor(br, bg, bb, 1)
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
		gl.enable(gl.DEPTH_TEST)
		gl.depthFunc(gl.LEQUAL)
		gl.depthMask(true)
		gl.disable(gl.BLEND)
		gl.disable(gl.CULL_FACE)

		// Solid, background coloured surface first so nearer ridges hide the wires behind them.
		const terrain = this.#terrainProgram!.use()
		terrain.mat4("uViewProjection", lit.viewProjection)
		terrain.float("uWidth", this.spanX * 1.8)
		terrain.float("uSpacing", TERRAIN_SPACING)
		terrain.float("uScroll", -this.#scroll * TERRAIN_SPACING)
		terrain.float("uFloor", floor)
		terrain.vec3v("uColour", this.accent)
		terrain.vec3v("uFill", this.background)
		terrain.float("uPeak", this.spanY * 0.15)
		setFog(terrain, lit.camera, lit.fogColour, lit.fogDensity)
		gl.enable(gl.POLYGON_OFFSET_FILL)
		gl.polygonOffset(1, 1)
		terrain.float("uSolid", 1)
		grid.drawFill()
		gl.disable(gl.POLYGON_OFFSET_FILL)
		terrain.float("uSolid", 0)
		grid.drawLines()

		// Pillars of light at every scale note, brighter while it sounds.
		if (this.#glow.length !== tonality.notes.length) {
			this.#glow = new Float32Array(tonality.notes.length)
		}
		const sounding = soundingNotes(frame)
		lines.clear()
		const top = this.spanY * 0.5
		tonality.notes.forEach((note, index) => {
			const glow = this.#glow[index]! + ((sounding.has(note) ? 1 : 0) - this.#glow[index]!) * Math.min(1, dt * 10)
			this.#glow[index] = glow
			const x = (toX(tonality.positionOf(note), width) / width - 0.5) * this.spanX
			const strength = (isRoot(tonality, note) ? 0.45 : 0.22) + 0.9 * glow
			hslToRgb(hueFor(note), 0.9, 0.6, this.#colour)
			const [r, g, b] = [this.#colour[0]! * strength, this.#colour[1]! * strength, this.#colour[2]! * strength]
			const height = floor + top * (0.55 + 0.45 * glow)
			lines.add(x, floor, -6, r, g, b, x, height, -6, 0, 0, 0)
			if (glow > 0.15) {
				for (const [dx, dz] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]] as const) {
					lines.add(x + dx, floor, -6 + dz, r * 0.6, g * 0.6, b * 0.6, x + dx, height, -6 + dz, 0, 0, 0)
				}
			}
		})
		gl.depthMask(false)
		gl.enable(gl.BLEND)
		gl.blendFunc(gl.ONE, gl.ONE)
		const line = this.#lineProgram!.use()
		line.mat4("uViewProjection", lit.viewProjection)
		setFog(line, lit.camera, lit.fogColour, lit.fogDensity)
		lines.draw()

		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
		this.drawHands(frame, common)

		gl.disable(gl.BLEND)
		gl.depthMask(true)
		this.finish(frame, common, 0.9, 0.5)
	}
}
