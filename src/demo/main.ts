import { noteName, ThereminSynth, type TheremidInput } from "../index.ts"

const theremid = document.querySelector<TheremidInput>("#theremid")!
const button = document.querySelector<HTMLButtonElement>("#sound")!
const waveform = document.querySelector<HTMLSelectElement>("#waveform")!
const volume = document.querySelector<HTMLInputElement>("#volume")!
const log = document.querySelector<HTMLOListElement>("#log")!

// The synth listens from the start, so every event drives it whatever the hand source: pointer,
// keyboard, Leap Motion or camera. Browsers keep audio suspended until a user gesture, so the
// first click or key press anywhere unlocks it.
const synth = new ThereminSynth()
synth.waveform = waveform.value as OscillatorType
synth.output.gain.value = Number(volume.value)
synth.attach(theremid)
theremid.analyser = synth.analyser

const { context } = synth
let wanted = true

function showState() {
	const on = context.state === "running"
	button.setAttribute("aria-pressed", String(on))
	button.textContent = on ? "Stop sound" : "Start sound"
	button.classList.toggle("waiting", wanted && !on)
}

async function setSound(on: boolean) {
	wanted = on
	await (on ? context.resume() : context.suspend())
	showState()
}

context.addEventListener("statechange", showState)
showState()

button.addEventListener("click", () => void setSound(context.state !== "running"))

// Capture at the window, before the surface stops its own key events from reaching the page.
const unlock = (event: Event) => {
	if (wanted && context.state !== "running" && event.target !== button) {
		void setSound(true)
	}
}
for (const type of ["pointerdown", "keydown"]) {
	window.addEventListener(type, unlock, { capture: true })
}

waveform.addEventListener("change", () => (synth.waveform = waveform.value as OscillatorType))
volume.addEventListener("input", () => (synth.output.gain.value = Number(volume.value)))

const hex = (word: number) => word.toString(16).padStart(8, "0")
for (const type of ["noteOn", "noteOff", "pitchBend", "controlChange"]) {
	theremid.addEventListener(type, (event) => {
		if (!log.closest("details")?.open) {
			return
		}
		const detail = (event as CustomEvent).detail
		const what = detail.note
			? `${noteName(detail.note.noteNumber)} vel ${detail.velocity.toFixed(2)}`
			: detail.controller !== undefined
				? `CC${detail.controller} ${detail.value.toFixed(3)}`
				: `${detail.value.toFixed(4)}`
		const item = document.createElement("li")
		item.textContent = `${type} ch${detail.channel + 1} ${what}  [${hex(detail.ump[0])} ${hex(detail.ump[1])}]`
		log.prepend(item)
		while (log.childElementCount > 200) {
			log.lastElementChild!.remove()
		}
	})
}
