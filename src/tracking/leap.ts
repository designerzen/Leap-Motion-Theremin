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
	grabStrength?: number
	pinchStrength?: number
}

interface LeapFrame {
	hands?: LeapHand[]
	interactionBox?: { center: Vector; size: Vector }
}

const STALE_AFTER = 500

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
		const box = frame.interactionBox ?? { center: [0, 200, 0], size: [235, 235, 147] }
		const seen = new Set<number>()
		for (const leap of frame.hands ?? []) {
			seen.add(leap.id)
			const [px, py, pz] = leap.palmPosition
			const [nx, ny] = leap.palmNormal ?? [0, -1, 0]
			const hand: Hand = this.#hands.get(leap.id) ?? {
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
			hand.x = clamp((px - box.center[0]) / box.size[0] + 0.5, 0, 1)
			hand.y = clamp(1 - ((py - box.center[1]) / box.size[1] + 0.5), 0, 1)
			// Leap z grows towards the player; push grows towards the screen.
			hand.z = clamp(0.5 - (pz - box.center[2]) / box.size[2], 0, 1)
			hand.grab = clamp(leap.grabStrength ?? 0, 0, 1)
			hand.pinch = clamp(leap.pinchStrength ?? 0, 0, 1)
			hand.roll = clamp(Math.atan2(nx, -ny) / Math.PI, -1, 1)
			this.#hands.set(leap.id, hand)
		}
		for (const id of this.#hands.keys()) {
			if (!seen.has(id)) {
				this.#hands.delete(id)
			}
		}
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
