import { clamp } from "../midi.ts"
import type { Hand } from "../types.ts"
import { BaseTracker } from "./tracker.ts"

export const DEFAULT_LEAP_URL = "ws://127.0.0.1:6437/v6.json"

type Vector = [number, number, number]

interface LeapHand {
	id: number
	type: "left" | "right"
	palmPosition: Vector
	palmNormal?: Vector
	wrist?: Vector
	direction?: Vector
	palmWidth?: number
	grabStrength?: number
	pinchStrength?: number
}

interface LeapPointable {
	handId: number
	type: 0 | 1 | 2 | 3 | 4
	tool: boolean
	carpPosition: Vector
	mcpPosition: Vector
	pipPosition: Vector
	dipPosition: Vector
	tipPosition: Vector
}

export interface LeapFrame {
	hands?: LeapHand[]
	pointables?: LeapPointable[]
	interactionBox?: { center: Vector; size: Vector }
}

const STALE_AFTER = 500
const jointBuffers = new WeakMap<Hand, Float32Array>()
const fingerPositions = ["mcpPosition", "pipPosition", "dipPosition", "tipPosition"] as const

const normalise = (value: number, centre: number, size: number, reverse = false) =>
	clamp(0.5 + (reverse ? -1 : 1) * (value - centre) / size, 0, 1)

/** Update tracked hands in place, retaining their joint buffers between frames. */
export function handsFromFrame(frame: LeapFrame, previous: Map<number, Hand>, now: number): Map<number, Hand> {
	const box = frame.interactionBox ?? { center: [0, 200, 0], size: [235, 235, 147] }
	const fingers = new Map<number, LeapPointable[]>()
	for (const pointable of frame.pointables ?? []) {
		if (pointable.tool) {
			continue
		}
		const group = fingers.get(pointable.handId)
		if (group) {
			group.push(pointable)
		} else {
			fingers.set(pointable.handId, [pointable])
		}
	}
	const seen = new Set<number>()
	for (const leap of frame.hands ?? []) {
		seen.add(leap.id)
		const [px, py, pz] = leap.palmPosition
		const [nx, ny] = leap.palmNormal ?? [0, -1, 0]
		const hand: Hand = previous.get(leap.id) ?? {
			id: `leap:${leap.id}`,
			source: "leap",
			side: leap.type === "left" ? "left" : "right",
			x: 0.5,
			y: 0.5,
			z: 0.5,
			grab: 0,
			pinch: 0,
			roll: 0,
			active: true,
			born: now
		}
		hand.x = normalise(px, box.center[0]!, box.size[0]!)
		hand.y = normalise(py, box.center[1]!, box.size[1]!, true)
		// Leap z grows towards the player; push grows towards the screen.
		hand.z = normalise(pz, box.center[2]!, box.size[2]!, true)
		hand.grab = clamp(leap.grabStrength ?? 0, 0, 1)
		hand.pinch = clamp(leap.pinchStrength ?? 0, 0, 1)
		hand.roll = clamp(Math.atan2(nx, -ny) / Math.PI, -1, 1)
		const pointables = fingers.get(leap.id)
		if (pointables?.length) {
			const joints = hand.joints instanceof Float32Array && hand.joints.length === 63
				? hand.joints : jointBuffers.get(hand) ?? new Float32Array(63)
			jointBuffers.set(hand, joints)
			// Missing fingers collapse to the wrist instead of retaining old positions.
			for (let axis = 0; axis < 3; axis++) {
				const wrist = leap.wrist?.[axis] ?? (leap.direction
					? leap.palmPosition[axis]! - leap.direction[axis]! * (leap.palmWidth ?? 80) * 0.6
					: leap.palmPosition[axis]! - (axis === 1 ? 40 : 0))
				const value = normalise(wrist, box.center[axis]!, box.size[axis]!, axis !== 0)
				for (let joint = 0; joint < 21; joint++) {
					joints[joint * 3 + axis] = value
				}
			}
			for (const finger of pointables) {
				for (let joint = 0; joint < 4; joint++) {
					const position = finger[fingerPositions[joint]!]
					for (let axis = 0; axis < 3; axis++) {
						joints[(1 + finger.type * 4 + joint) * 3 + axis] = normalise(
							position[axis]!, box.center[axis]!, box.size[axis]!, axis !== 0
						)
					}
				}
			}
			hand.joints = joints
		} else {
			hand.joints = undefined
		}
		previous.set(leap.id, hand)
	}
	for (const id of previous.keys()) {
		if (!seen.has(id)) {
			previous.delete(id)
		}
	}
	return previous
}

/**
 * Leap Motion / Ultraleap hands over the tracking service's WebSocket JSON protocol (v6), so no
 * vendor SDK has to be loaded. Works with the classic Leap service and Ultraleap's open source
 * WebSocket bridge for Gemini. Reconnects quietly until the service appears.
 */
export class LeapTracker extends BaseTracker {
	readonly source = "leap" as const
	#socket?: WebSocket
	#timer?: ReturnType<typeof setTimeout>
	#hands = new Map<number, Hand>()
	#lastFrame = 0
	#running = false
	#retry = 0

	constructor(private url = DEFAULT_LEAP_URL) {
		super()
	}

	start() {
		this.#running = true
		this.#retry = 0
		this.#connect()
	}

	setUrl(url: string) {
		if (url === this.url) {
			return
		}
		this.url = url
		if (this.#running) {
			this.#socket?.close()
		}
	}

	#connect() {
		clearTimeout(this.#timer)
		if (!this.#running) {
			return
		}
		if (typeof WebSocket === "undefined") {
			this.setStatus("unavailable", "WebSockets are not available here")
			return
		}
		this.setStatus("connecting", "Looking for the Leap Motion service")
		let socket: WebSocket
		try {
			socket = new WebSocket(this.url)
		} catch {
			this.setStatus("unavailable", `Cannot open ${this.url}`)
			return
		}
		this.#socket = socket
		socket.addEventListener("open", () => {
			for (const message of [{ enableGestures: false }, { background: true }, { focused: true }]) {
				socket.send(JSON.stringify(message))
			}
		})
		socket.addEventListener("message", (event) => {
			if (typeof event.data !== "string") {
				return
			}
			let data: LeapFrame & { version?: number; event?: unknown }
			try {
				data = JSON.parse(event.data)
			} catch {
				return
			}
			if (data.version !== undefined) {
				this.#retry = 0
				this.setStatus("ready", "Leap Motion connected")
			}
			if (Array.isArray(data.hands)) {
				this.#frame(data)
			}
		})
		socket.addEventListener("close", () => {
			this.#socket = undefined
			this.#hands.clear()
			if (!this.#running) {
				return
			}
			this.setStatus(
				"unavailable",
				"No Leap Motion service on " + this.url + ". Start the Ultraleap tracking service and WebSocket bridge."
			)
			// Back off so a missing service does not fill the console with failed connections.
			this.#timer = setTimeout(() => this.#connect(), Math.min(30000, 2000 * 2 ** this.#retry++))
		})
	}

	#frame(frame: LeapFrame) {
		const now = performance.now()
		this.#lastFrame = now
		handsFromFrame(frame, this.#hands, now)
	}

	stop() {
		this.#running = false
		clearTimeout(this.#timer)
		this.#socket?.close()
		this.#socket = undefined
		this.#hands.clear()
		this.setStatus("idle")
	}

	hands(time: number) {
		if (time - this.#lastFrame > STALE_AFTER) {
			this.#hands.clear()
		}
		return [...this.#hands.values()]
	}
}
