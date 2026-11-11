import { clamp } from "../midi.ts"
import type { Hand } from "../types.ts"
import { BaseTracker, blankHand } from "./tracker.ts"

/**
 * Mouse, pen and multi-touch. Each pressed pointer is a hand; a hovering mouse is shown as an
 * inactive hand so players can see where they will land before they press.
 */
export class PointerTracker extends BaseTracker {
	readonly source = "pointer" as const
	#hands = new Map<number, Hand>()
	#hover?: Hand
	#abort?: AbortController

	constructor(private readonly target: HTMLElement) {
		super()
	}

	start() {
		this.stop()
		this.#abort = new AbortController()
		const options = { signal: this.#abort.signal }
		const target = this.target
		const locate = (event: PointerEvent) => {
			const rect = target.getBoundingClientRect()
			return {
				x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
				y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1),
				z: event.pointerType === "mouse" || event.pressure <= 0 ? 0.5 : event.pressure
			}
		}
		target.addEventListener(
			"pointerdown",
			(event) => {
				if (event.button !== 0) {
					return
				}
				event.preventDefault()
				target.setPointerCapture?.(event.pointerId)
				const { x, y, z } = locate(event)
				const hand = blankHand(`pointer:${event.pointerId}`, "pointer", performance.now(), x, y)
				hand.z = z
				hand.active = true
				this.#hands.set(event.pointerId, hand)
				this.#hover = undefined
			},
			options
		)
		target.addEventListener(
			"pointermove",
			(event) => {
				const position = locate(event)
				const hand = this.#hands.get(event.pointerId)
				if (hand) {
					Object.assign(hand, position)
					return
				}
				if (event.pointerType === "mouse") {
					this.#hover ??= blankHand("pointer:hover", "pointer", performance.now())
					Object.assign(this.#hover, position)
				}
			},
			options
		)
		const end = (event: PointerEvent) => {
			this.#hands.delete(event.pointerId)
			if (target.hasPointerCapture?.(event.pointerId)) {
				target.releasePointerCapture(event.pointerId)
			}
		}
		target.addEventListener("pointerup", end, options)
		target.addEventListener("pointercancel", end, options)
		target.addEventListener("lostpointercapture", end, options)
		target.addEventListener("pointerleave", () => (this.#hover = undefined), options)
		target.addEventListener("contextmenu", (event) => event.preventDefault(), options)
		this.setStatus("ready")
	}

	stop() {
		this.#abort?.abort()
		this.#abort = undefined
		this.#hands.clear()
		this.#hover = undefined
		this.setStatus("idle")
	}

	release() {
		this.#hands.clear()
	}

	hands() {
		const hands = [...this.#hands.values()]
		return this.#hover ? [...hands, this.#hover] : hands
	}
}

/**
 * Keyboard play for players who cannot or prefer not to point: arrow keys move a virtual hand,
 * holding Space or Enter sounds it. Shift moves in fine steps.
 */
export class KeyboardTracker extends BaseTracker {
	readonly source = "keyboard" as const
	#hand = blankHand("keyboard", "keyboard", 0, 0.5, 0.4)
	#focused = false
	#held = new Set<string>()
	#abort?: AbortController

	constructor(private readonly target: HTMLElement) {
		super()
		this.#hand.side = "right"
	}

	start() {
		this.stop()
		this.#abort = new AbortController()
		const options = { signal: this.#abort.signal }
		this.target.addEventListener(
			"focus",
			() => {
				this.#focused = true
			},
			options
		)
		this.target.addEventListener(
			"blur",
			() => {
				this.#focused = false
				this.release()
			},
			options
		)
		this.target.addEventListener(
			"keydown",
			(event) => {
				const step = event.shiftKey ? 1 / 96 : 1 / 24
				const moves: Record<string, [number, number]> = {
					ArrowLeft: [-step, 0],
					ArrowRight: [step, 0],
					ArrowUp: [0, -step],
					ArrowDown: [0, step]
				}
				const move = moves[event.key]
				if (move) {
					event.preventDefault()
					event.stopPropagation()
					this.#hand.x = clamp(this.#hand.x + move[0], 0, 1)
					this.#hand.y = clamp(this.#hand.y + move[1], 0, 1)
					return
				}
				if (event.key === " " || event.key === "Enter") {
					event.preventDefault()
					event.stopPropagation()
					if (!this.#held.size) {
						this.#hand.born = performance.now()
					}
					this.#held.add(event.key)
					this.#hand.active = true
				}
			},
			options
		)
		this.target.addEventListener(
			"keyup",
			(event) => {
				if (this.#held.delete(event.key)) {
					event.stopPropagation()
					this.#hand.active = this.#held.size > 0
				}
			},
			options
		)
		this.setStatus("ready")
	}

	stop() {
		this.#abort?.abort()
		this.#abort = undefined
		this.release()
		this.setStatus("idle")
	}

	release() {
		this.#held.clear()
		this.#hand.active = false
	}

	hands() {
		return this.#focused ? [this.#hand] : []
	}
}
