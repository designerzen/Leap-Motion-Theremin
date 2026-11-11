import type { Hand, HandSource } from "../types.ts"

export type TrackerStatus = "idle" | "connecting" | "ready" | "unavailable"

export interface HandTracker {
	readonly source: HandSource
	readonly status: TrackerStatus
	/** Human readable detail for the status, e.g. why tracking is unavailable. */
	readonly message: string
	start(): void | Promise<void>
	stop(): void
	/** The hands currently visible to this tracker. */
	hands(time: number): Hand[]
	/** Called whenever status or message changes. */
	onstatus?: () => void
}

export const blankHand = (
	id: string,
	source: HandSource,
	born: number,
	x = 0.5,
	y = 0.5
): Hand => ({
	id,
	source,
	side: x < 0.5 ? "left" : "right",
	x,
	y,
	z: 0.5,
	grab: 0,
	pinch: 0,
	roll: 0,
	active: false,
	born
})

/** Shared status plumbing for trackers. */
export abstract class BaseTracker implements HandTracker {
	abstract readonly source: HandSource
	status: TrackerStatus = "idle"
	message = ""
	onstatus?: () => void

	protected setStatus(status: TrackerStatus, message = "") {
		if (status === this.status && message === this.message) {
			return
		}
		this.status = status
		this.message = message
		this.onstatus?.()
	}

	abstract start(): void | Promise<void>
	abstract stop(): void
	abstract hands(time: number): Hand[]
}
