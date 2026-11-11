import { noteName, ThereminSynth, type TheremidInput } from "../index.ts"

const theremid = document.querySelector<TheremidInput>("#theremid")!
const button = document.querySelector<HTMLButtonElement>("#sound")!
const waveform = document.querySelector<HTMLSelectElement>("#waveform")!
const volume = document.querySelector<HTMLInputElement>("#volume")!
const log = document.querySelector<HTMLOListElement>("#log")!

let synth: ThereminSynth | undefined

// Audio can only start from a user gesture, so the synth is created on first interaction.
function ensureSynth() {
	if (!synth) {
		synth = new ThereminSynth()
		synth.waveform = waveform.value as OscillatorType
		synth.output.gain.value = Number(volume.value)
		synth.attach(theremid)
		theremid.analyser = synth.analyser
	}
	return synth
}

async function setSound(on: boolean) {
	const context = ensureSynth().context
	await (on ? context.resume() : context.suspend())
	button.setAttribute("aria-pressed", String(on))
	button.textContent = on ? "Stop sound" : "Start sound"
}

button.addEventListener("click", () => void setSound(button.getAttribute("aria-pressed") !== "true"))
theremid.addEventListener("pointerdown", () => {
	if (!synth) {
		void setSound(true)
	}
})
waveform.addEventListener("change", () => {
	if (synth) {
		synth.waveform = waveform.value as OscillatorType
	}
})
volume.addEventListener("input", () => {
	if (synth) {
		synth.output.gain.value = Number(volume.value)
	}
})

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
