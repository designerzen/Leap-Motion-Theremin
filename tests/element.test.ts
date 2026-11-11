import { afterEach, describe, expect, it } from "vitest"
import "../src/index.ts"
import type { TheremidInput } from "../src/theremid-input.ts"

const frames = (count: number) =>
	new Promise<void>((resolve) => {
		const step = (remaining: number) =>
			remaining ? requestAnimationFrame(() => step(remaining - 1)) : resolve()
		step(count)
	})

function mount(attributes: Record<string, string> = {}) {
	const element = document.createElement("theremid-input") as TheremidInput
	element.setAttribute("sources", "none")
	for (const [name, value] of Object.entries(attributes)) {
		element.setAttribute(name, value)
	}
	document.body.append(element)
	return element
}

afterEach(() => {
	document.body.innerHTML = ""
})

describe("<theremid-input>", () => {
	it("registers and reflects settings", () => {
		const element = mount({ mode: "chords", surface: "lattice" })
		expect(element.mode).toBe("chords")
		expect(element.surface).toBe("lattice")
		expect(element.root.querySelector<HTMLSelectElement>("select[name=mode]")!.value).toBe("chords")
	})

	it("emits instrumentChange when a control changes", () => {
		const element = mount()
		const changes: unknown[] = []
		element.addEventListener("instrumentChange", (event) => changes.push((event as CustomEvent).detail))
		const select = element.root.querySelector<HTMLSelectElement>("select[name=scale]")!
		select.value = "blues"
		select.dispatchEvent(new Event("change", { bubbles: true }))
		expect(element.getAttribute("scale")).toBe("blues")
		expect(changes).toContainEqual({ control: "scale", value: "blues" })
	})

	it("plays from the pointer and releases on stop", async () => {
		const element = mount({ mode: "snap" })
		const events: { type: string; composed: boolean; target: EventTarget | undefined }[] = []
		for (const type of ["noteOn", "noteOff"]) {
			element.addEventListener(type, (event) => {
				events.push({ type, composed: event.composed, target: event.composedPath()[0] })
			})
		}
		const canvas = element.root.querySelector("canvas")!
		canvas.dispatchEvent(
			new PointerEvent("pointerdown", { pointerId: 1, button: 0, clientX: 0, clientY: 0, bubbles: true })
		)
		await frames(3)
		expect(events[0]).toEqual({ type: "noteOn", composed: true, target: element })
		expect(element.notes.length).toBe(1)
		element.stop()
		expect(events.at(-1)?.type).toBe("noteOff")
		expect(element.notes).toEqual([])
	})

	it("announces disconnection so hosts can detach", () => {
		const element = mount()
		let disconnected = false
		element.addEventListener("instrumentDisconnect", () => (disconnected = true))
		element.remove()
		expect(disconnected).toBe(true)
	})
})
