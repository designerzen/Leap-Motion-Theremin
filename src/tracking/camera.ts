import { clamp } from "../midi.ts"
import type { Hand, HandSide } from "../types.ts"
import { BaseTracker } from "./tracker.ts"

const MEDIAPIPE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0"

/** Override these before starting a camera tracker to self host the model and runtime. */
export const CAMERA_ASSETS = {
	module: `${MEDIAPIPE}/vision_bundle.mjs`,
	wasm: `${MEDIAPIPE}/wasm`,
	model:
		"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
}

interface Landmark {
	x: number
	y: number
	z: number
}

interface Category {
	categoryName: string
	score: number
}

interface LandmarkerResult {
	landmarks: Landmark[][]
	handedness?: Category[][]
	handednesses?: Category[][]
}

interface Landmarker {
	detectForVideo(video: HTMLVideoElement, time: number): LandmarkerResult
	close(): void
}

interface VisionModule {
	FilesetResolver: { forVisionTasks(path: string): Promise<unknown> }
	HandLandmarker: {
		createFromOptions(fileset: unknown, options: Record<string, unknown>): Promise<Landmarker>
	}
}

const distance = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y)

/** Derive a hand from MediaPipe's 21 landmarks, in image space (mirrored for a selfie view). */
export function handFromLandmarks(
	points: Landmark[],
	side: HandSide,
	mirror: boolean,
	previous: Hand | undefined,
	time: number
): Hand {
	const palm = [0, 5, 9, 13, 17].map((index) => points[index]!)
	const centre = {
		x: palm.reduce((sum, point) => sum + point.x, 0) / palm.length,
		y: palm.reduce((sum, point) => sum + point.y, 0) / palm.length,
		z: 0
	}
	const size = Math.max(0.01, distance(points[0]!, points[9]!))
	const reach =
		[8, 12, 16, 20].reduce((sum, index) => sum + distance(points[index]!, centre), 0) / 4 / size
	const across = { x: points[17]!.x - points[5]!.x, y: points[17]!.y - points[5]!.y }
	return {
		id: `camera:${side}`,
		source: "camera",
		side,
		x: clamp(mirror ? 1 - centre.x : centre.x, 0, 1),
		y: clamp(centre.y, 0, 1),
		// A larger hand in frame is closer to the camera, i.e. pushed further.
		z: clamp((size - 0.08) / 0.3, 0, 1),
		grab: clamp(1 - (reach - 0.7) / 0.9, 0, 1),
		pinch: clamp(1 - (distance(points[4]!, points[8]!) / size - 0.25) / 0.6, 0, 1),
		roll: clamp(Math.atan2(across.y, mirror ? -across.x : across.x) / Math.PI, -1, 1),
		active: true,
		born: previous?.born ?? time
	}
}

/** Camera hand tracking with MediaPipe Hand Landmarker, loaded on demand from a CDN. */
export class CameraTracker extends BaseTracker {
	readonly source = "camera" as const
	readonly video: HTMLVideoElement
	#stream?: MediaStream
	#landmarker?: Landmarker
	#hands = new Map<string, Hand>()
	#lastVideoTime = -1
	#generation = 0

	constructor(public mirror = true) {
		super()
		this.video = document.createElement("video")
		this.video.muted = true
		this.video.playsInline = true
		this.video.setAttribute("aria-hidden", "true")
	}

	async start() {
		const generation = ++this.#generation
		if (!navigator.mediaDevices?.getUserMedia) {
			this.setStatus("unavailable", "Camera capture is not available in this context")
			return
		}
		this.setStatus("connecting", "Starting the camera")
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
				audio: false
			})
			if (generation !== this.#generation) {
				stream.getTracks().forEach((track) => track.stop())
				return
			}
			this.#stream = stream
			this.video.srcObject = stream
			await this.video.play()
			this.setStatus("connecting", "Loading the hand tracking model")
			const vision = (await import(/* @vite-ignore */ CAMERA_ASSETS.module)) as VisionModule
			const fileset = await vision.FilesetResolver.forVisionTasks(CAMERA_ASSETS.wasm)
			const landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
				baseOptions: { modelAssetPath: CAMERA_ASSETS.model, delegate: "GPU" },
				runningMode: "VIDEO",
				numHands: 2
			})
			if (generation !== this.#generation) {
				landmarker.close()
				return
			}
			this.#landmarker = landmarker
			this.setStatus("ready", "Camera hand tracking running")
		} catch (error) {
			if (generation !== this.#generation) {
				return
			}
			this.#release()
			const denied = error instanceof DOMException && error.name === "NotAllowedError"
			this.setStatus(
				"unavailable",
				denied ? "Camera permission was denied" : "Could not start camera hand tracking"
			)
		}
	}

	#release() {
		this.#stream?.getTracks().forEach((track) => track.stop())
		this.#stream = undefined
		this.video.srcObject = null
		this.#landmarker?.close()
		this.#landmarker = undefined
		this.#hands.clear()
		this.#lastVideoTime = -1
	}

	stop() {
		this.#generation++
		this.#release()
		this.setStatus("idle")
	}

	hands(time: number) {
		const landmarker = this.#landmarker
		if (!landmarker || this.video.readyState < 2) {
			return []
		}
		if (this.video.currentTime !== this.#lastVideoTime) {
			this.#lastVideoTime = this.video.currentTime
			const result = landmarker.detectForVideo(this.video, time)
			const labels = result.handedness ?? result.handednesses ?? []
			const next = new Map<string, Hand>()
			result.landmarks.forEach((points, index) => {
				// MediaPipe labels handedness as if the image were mirrored; raw webcam frames are not.
				const label = labels[index]?.[0]?.categoryName
				let side: HandSide = label === "Left" ? "right" : "left"
				if (next.has(side)) {
					side = side === "left" ? "right" : "left"
				}
				next.set(side, handFromLandmarks(points, side, this.mirror, this.#hands.get(side), time))
			})
			this.#hands = next
		}
		return [...this.#hands.values()]
	}
}
