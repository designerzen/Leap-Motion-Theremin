import {
	clamp,
	controlChangeDetail,
	CONTROL_CHANGE,
	EVENT_INSTRUMENT_CHANGE,
	EVENT_INSTRUMENT_DISCONNECT,
	NOTE_KEYS,
	NOTE_OFF,
	NOTE_ON,
	noteDetail,
	noteName,
	PITCH_BEND,
	pitchBendDetail,
	type MIDIAddress,
	type NoteDetail
} from "./midi.ts"
import { findMode, MODES } from "./modes/index.ts"
import { Performance } from "./performance.ts"
import { CHORD_SHAPES, findScale, parseKey, SCALES, Tonality, type ChordShape } from "./scales.ts"
import { hsl, hueFor } from "./surfaces/common.ts"
import { findSurface, SURFACES } from "./surfaces/index.ts"
import { CameraTracker } from "./tracking/camera.ts"
import { DEFAULT_LEAP_URL, LeapTracker } from "./tracking/leap.ts"
import { KeyboardTracker, PointerTracker } from "./tracking/pointer.ts"
import type { HandTracker } from "./tracking/tracker.ts"
import type {
	DrawHand,
	Hand,
	Mode,
	NoteEvent,
	PerformanceSettings,
	PlayingHand,
	Surface,
	Theme
} from "./types.ts"
import styles from "./theremid-input.css?inline"

export const TAG = "theremid-input"

const GATES = {
	presence: "Hand present",
	pinch: "Pinch to play",
	open: "Open hand plays, fist mutes"
} as const
type Gate = keyof typeof GATES

const SETTINGS = [
	"mode",
	"surface",
	"scale",
	"key",
	"low",
	"high",
	"chord",
	"bpm",
	"autotune",
	"sustain",
	"bend-range",
	"mpe",
	"channel",
	"group",
	"sources",
	"gate",
	"smoothing",
	"leap-url",
	"mirror",
	"camera-backdrop",
	"disabled",
	"muted"
] as const

const number = (value: string | null, fallback: number, min: number, max: number) => {
	const parsed = value === null || value.trim() === "" ? NaN : Number(value)
	return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback
}

const options = (items: readonly { id: string; name: string }[]) =>
	items.map((item) => `<option value="${item.id}">${item.name}</option>`).join("")

interface Motion {
	x: number
	y: number
	z: number
	speed: number
}

/**
 * Theremid: a hands-in-the-air instrument controller. It makes no sound itself; it emits
 * HarmonEasy instrument events (noteOn, noteOff, pitchBend, controlChange) carrying MIDI 2.0
 * UMP words, so any host or the bundled ThereminSynth can voice it.
 */
export class TheremidInput extends HTMLElement {
	static observedAttributes = [...SETTINGS]

	/** Attach an analyser (e.g. from ThereminSynth) to let surfaces draw the real waveform. */
	analyser?: AnalyserNode

	readonly root: ShadowRoot
	#canvas: HTMLCanvasElement
	#context: CanvasRenderingContext2D | null
	#performance: Performance
	#mode: Mode
	#modeId = ""
	#surface: Surface
	#surfaceId = ""
	#tonality: Tonality
	#pointer: PointerTracker
	#keyboard: KeyboardTracker
	#leap = new LeapTracker()
	#camera?: CameraTracker
	#trackers: HandTracker[] = []
	#frame = 0
	#last = 0
	#size = { width: 0, height: 0, ratio: 1 }
	#motion = new Map<string, Motion>()
	#hands: PlayingHand[] = []
	#events: NoteEvent[] = []
	#held = new Map<number, NoteDetail>()
	#theme: Theme = {
		background: "#07080d",
		foreground: "#eef1f8",
		muted: "#7c8496",
		accent: "#7df9ff",
		font: "system-ui, sans-serif"
	}
	#waveform?: Float32Array<ArrayBuffer>
	#announced = ""
	#announceAt = 0
	#status = ""
	#abort?: AbortController
	#reducedMotion = false

	constructor() {
		super()
		this.root = this.attachShadow({ mode: "open" })
		this.root.innerHTML = this.#template()
		this.#canvas = this.root.querySelector("canvas")!
		this.#context = this.#canvas.getContext("2d")
		this.#pointer = new PointerTracker(this.#canvas)
		this.#keyboard = new KeyboardTracker(this.#canvas)
		this.#performance = new Performance({
			noteOn: (note, velocity, id, channel, key) => this.#noteOn(note, velocity, id, channel, key),
			noteOff: (note, id) => this.#noteOff(note, id),
			bend: (channel, value) =>
				this.#dispatch(PITCH_BEND, pitchBendDetail(value, this.#address(channel))),
			control: (channel, controller, value) =>
				this.#dispatch(CONTROL_CHANGE, controlChangeDetail(controller, value, this.#address(channel)))
		})
		const mode = findMode(this.getAttribute("mode"))
		this.#mode = mode.create()
		this.#modeId = mode.id
		const surface = findSurface(this.getAttribute("surface"))
		this.#surface = surface.create()
		this.#surfaceId = surface.id
		this.#tonality = this.#makeTonality()
	}

	// Settings, all reflected as attributes so hosts can persist and restore them.

	get mode() {
		return this.#modeId
	}
	set mode(value: string) {
		this.setAttribute("mode", value)
	}
	get surface() {
		return this.#surfaceId
	}
	set surface(value: string) {
		this.setAttribute("surface", value)
	}
	get scale() {
		return findScale(this.getAttribute("scale")).id
	}
	set scale(value: string) {
		this.setAttribute("scale", value)
	}
	get key() {
		return NOTE_KEYS[parseKey(this.getAttribute("key"))]!
	}
	set key(value: string) {
		this.setAttribute("key", value)
	}
	get low() {
		return Math.round(number(this.getAttribute("low"), 48, 0, 126))
	}
	set low(value: number) {
		this.setAttribute("low", String(value))
	}
	get high() {
		return Math.max(this.low + 1, Math.round(number(this.getAttribute("high"), 84, 1, 127)))
	}
	set high(value: number) {
		this.setAttribute("high", String(value))
	}
	get chord(): ChordShape {
		const value = this.getAttribute("chord") as ChordShape
		return CHORD_SHAPES.includes(value) ? value : "triad"
	}
	set chord(value: ChordShape) {
		this.setAttribute("chord", value)
	}
	get bpm() {
		return number(this.getAttribute("bpm"), 110, 20, 300)
	}
	set bpm(value: number) {
		this.setAttribute("bpm", String(value))
	}
	get autotune() {
		return number(this.getAttribute("autotune"), 0.8, 0, 1)
	}
	set autotune(value: number) {
		this.setAttribute("autotune", String(value))
	}
	get sustain() {
		return number(this.getAttribute("sustain"), 0.5, 0, 1)
	}
	set sustain(value: number) {
		this.setAttribute("sustain", String(value))
	}
	/** Semitones a full pitch bend covers on the receiving instrument. */
	get bendRange() {
		return number(this.getAttribute("bend-range"), 2, 1, 96)
	}
	set bendRange(value: number) {
		this.setAttribute("bend-range", String(value))
	}
	/** Give every hand its own channel (MPE lower zone) so each can bend independently. */
	get mpe() {
		return this.hasAttribute("mpe") && this.getAttribute("mpe") !== "false"
	}
	set mpe(value: boolean) {
		this.toggleAttribute("mpe", value)
	}
	get channel() {
		return Math.round(number(this.getAttribute("channel"), 0, 0, 15))
	}
	set channel(value: number) {
		this.setAttribute("channel", String(value))
	}
	get group() {
		return Math.round(number(this.getAttribute("group"), 0, 0, 15))
	}
	set group(value: number) {
		this.setAttribute("group", String(value))
	}
	/** Space separated hand sources besides pointer and keyboard: "leap", "camera". */
	get sources(): Set<string> {
		const value = this.getAttribute("sources")
		return new Set((value ?? "leap").split(/[\s,]+/).filter(Boolean))
	}
	set sources(value: Iterable<string>) {
		this.setAttribute("sources", [...value].join(" ") || "none")
	}
	get gate(): Gate {
		const value = this.getAttribute("gate") as Gate
		return value in GATES ? value : "presence"
	}
	set gate(value: Gate) {
		this.setAttribute("gate", value)
	}
	get smoothing() {
		return number(this.getAttribute("smoothing"), 0.5, 0, 0.95)
	}
	set smoothing(value: number) {
		this.setAttribute("smoothing", String(value))
	}
	get disabled() {
		return this.hasAttribute("disabled")
	}
	set disabled(value: boolean) {
		this.toggleAttribute("disabled", value)
	}
	get muted() {
		return this.hasAttribute("muted")
	}
	set muted(value: boolean) {
		this.toggleAttribute("muted", value)
	}

	/** Notes currently sounding, lowest first. */
	get notes() {
		return this.#performance.sounding
	}

	/** Status of each hand tracking source. */
	get trackers() {
		return this.#trackers.map(({ source, status, message }) => ({ source, status, message }))
	}

	connectedCallback() {
		this.#abort?.abort()
		this.#abort = new AbortController()
		const signal = this.#abort.signal
		const form = this.root.querySelector("form")!
		form.addEventListener("submit", (event) => event.preventDefault(), { signal })
		form.addEventListener("change", (event) => this.#onControl(event.target as HTMLInputElement), {
			signal
		})
		form.addEventListener(
			"input",
			(event) => {
				const target = event.target as HTMLInputElement
				if (target.type === "range") {
					this.#onControl(target)
				}
			},
			{ signal }
		)
		// Stop page level shortcuts (such as a host's QWERTY keyboard input) while playing here.
		for (const type of ["keydown", "keyup"]) {
			this.#canvas.addEventListener(type, (event) => event.stopPropagation(), { signal })
		}
		const motion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")
		this.#reducedMotion = !!motion?.matches
		motion?.addEventListener("change", () => (this.#reducedMotion = motion.matches), { signal })
		window.addEventListener("blur", () => this.#releaseLocal(), { signal })
		document.addEventListener(
			"visibilitychange",
			() => {
				if (document.hidden) {
					this.stop()
				}
			},
			{ signal }
		)
		this.#pointer.start()
		this.#keyboard.start()
		this.#syncTrackers()
		this.#readTheme()
		this.#syncControls()
		this.#last = performance.now()
		this.#frame = requestAnimationFrame((time) => this.#tick(time))
	}

	disconnectedCallback() {
		this.#dispatch(EVENT_INSTRUMENT_DISCONNECT, {})
		cancelAnimationFrame(this.#frame)
		this.stop()
		this.#abort?.abort()
		this.#abort = undefined
		for (const tracker of [this.#pointer, this.#keyboard, this.#leap, this.#camera]) {
			tracker?.stop()
		}
		this.#trackers = []
	}

	attributeChangedCallback(name: string, previous: string | null, value: string | null) {
		if (previous === value) {
			return
		}
		switch (name) {
			case "mode": {
				const mode = findMode(value)
				if (mode.id !== this.#modeId) {
					this.#performance.releaseAll()
					this.#mode = mode.create()
					this.#modeId = mode.id
				}
				break
			}
			case "surface": {
				const surface = findSurface(value)
				if (surface.id !== this.#surfaceId) {
					this.#surface = surface.create()
					this.#surfaceId = surface.id
					this.#surface.resize?.(this.#size.width, this.#size.height)
					this.#clearCanvas()
				}
				break
			}
			case "scale":
			case "key":
			case "low":
			case "high":
				this.#tonality = this.#makeTonality()
				break
			case "mpe":
			case "channel":
			case "group":
				this.#performance.releaseAll()
				break
			case "sources":
			case "leap-url":
			case "mirror":
				if (this.isConnected) {
					this.#syncTrackers()
				}
				break
			case "disabled":
			case "muted":
				if (value !== null) {
					this.stop()
				}
				break
		}
		if (this.isConnected) {
			this.#syncControls()
			this.#dispatch(EVENT_INSTRUMENT_CHANGE, { control: name, value: value ?? "" })
		}
	}

	/** Release every sounding note and forget pressed pointers and keys. */
	stop() {
		this.#releaseLocal()
		this.#performance.releaseAll()
		this.#mode.reset()
		this.#motion.clear()
	}

	#releaseLocal() {
		this.#pointer.release()
		this.#keyboard.release()
	}

	#makeTonality() {
		return new Tonality(parseKey(this.getAttribute("key")), findScale(this.getAttribute("scale")), this.low, this.high)
	}

	#address(channel: number): MIDIAddress {
		return { group: this.group, channel: clamp(channel, 0, 15) }
	}

	#dispatch(type: string, detail: unknown) {
		this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }))
	}

	#noteOn(note: number, velocity: number, id: number, channel: number, key: string) {
		const detail = noteDetail(NOTE_ON, note, velocity, id, this.#address(channel))
		this.#held.set(id, detail)
		this.#dispatch(NOTE_ON, detail)
		const hand = this.#hands.find((candidate) => candidate.id === key)
		this.#events.push({
			note,
			velocity,
			time: this.#last,
			x: hand?.x ?? this.#tonality.positionOf(note),
			y: hand?.y ?? 0.5,
			handId: key
		})
		if (this.#events.length > 96) {
			this.#events.splice(0, this.#events.length - 96)
		}
	}

	#noteOff(note: number, id: number) {
		const held = this.#held.get(id)
		this.#held.delete(id)
		this.#dispatch(NOTE_OFF, noteDetail(NOTE_OFF, note, 0, id, held ?? this.#address(this.channel)))
	}

	#syncTrackers() {
		const sources = this.sources
		this.#leap.setUrl(this.getAttribute("leap-url") || DEFAULT_LEAP_URL)
		const wantLeap = sources.has("leap")
		if (wantLeap && this.#leap.status === "idle") {
			void this.#leap.start()
		} else if (!wantLeap && this.#leap.status !== "idle") {
			this.#leap.stop()
		}
		const wantCamera = sources.has("camera")
		if (wantCamera && !this.#camera) {
			this.#camera = new CameraTracker()
			this.#camera.onstatus = () => this.#renderStatus()
			void this.#camera.start()
		} else if (!wantCamera && this.#camera) {
			this.#camera.stop()
			this.#camera = undefined
		}
		if (this.#camera) {
			this.#camera.mirror = this.getAttribute("mirror") !== "false"
		}
		this.#leap.onstatus = () => this.#renderStatus()
		const trackers: (HandTracker | undefined)[] = [
			this.#pointer,
			this.#keyboard,
			wantLeap ? this.#leap : undefined,
			this.#camera
		]
		this.#trackers = trackers.filter((tracker): tracker is HandTracker => !!tracker)
		this.#renderStatus()
	}

	#readTheme() {
		const style = getComputedStyle(this)
		const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
		this.#theme = {
			background: read("--theremid-background", "#07080d"),
			foreground: read("--theremid-foreground", "#eef1f8"),
			muted: read("--theremid-muted", "#7c8496"),
			accent: read("--theremid-accent", "#7df9ff"),
			font: read("--theremid-font", "system-ui, sans-serif")
		}
	}

	#resize() {
		const rect = this.#canvas.getBoundingClientRect()
		const ratio = Math.min(2, globalThis.devicePixelRatio || 1)
		const width = Math.max(1, Math.round(rect.width))
		const height = Math.max(1, Math.round(rect.height))
		if (width === this.#size.width && height === this.#size.height && ratio === this.#size.ratio) {
			return
		}
		this.#size = { width, height, ratio }
		this.#canvas.width = Math.round(width * ratio)
		this.#canvas.height = Math.round(height * ratio)
		this.#context?.setTransform(ratio, 0, 0, ratio, 0, 0)
		this.#surface.resize?.(width, height)
		this.#readTheme()
		this.#clearCanvas()
	}

	#clearCanvas() {
		const g = this.#context
		if (!g) {
			return
		}
		g.fillStyle = this.#theme.background
		g.fillRect(0, 0, this.#size.width, this.#size.height)
	}

	#collect(time: number, dt: number): Hand[] {
		const smoothing = this.smoothing
		const gate = this.gate
		const silent = this.disabled || this.muted
		const hands: Hand[] = []
		for (const tracker of this.#trackers) {
			for (const source of tracker.hands(time)) {
				const hand = { ...source }
				const tracked = hand.source === "leap" || hand.source === "camera"
				if (tracked) {
					hand.active = gate === "pinch" ? hand.pinch > 0.55 : gate === "open" ? hand.grab < 0.7 : true
				}
				if (silent) {
					hand.active = false
				}
				const previous = this.#motion.get(hand.id)
				if (previous && tracked) {
					// Frame rate independent exponential smoothing of jittery tracked hands.
					const keep = smoothing ** (dt * 60)
					hand.x = previous.x * keep + hand.x * (1 - keep)
					hand.y = previous.y * keep + hand.y * (1 - keep)
					hand.z = previous.z * keep + hand.z * (1 - keep)
				}
				hands.push(hand)
			}
		}
		return hands
	}

	#tick(time: number) {
		this.#frame = requestAnimationFrame((next) => this.#tick(next))
		const dt = clamp((time - this.#last) / 1000, 0.001, 0.1)
		this.#last = time
		this.#resize()
		const tonality = this.#tonality
		const surface = this.#surface
		const hands = this.#collect(time, dt)
		const seen = new Set<string>()
		const settings: PerformanceSettings = {
			bendRange: this.bendRange,
			mpe: this.mpe,
			channel: this.channel,
			chord: this.chord,
			bpm: this.bpm,
			autotune: this.autotune,
			sustain: this.sustain
		}
		const all: PlayingHand[] = hands.map((hand) => {
			seen.add(hand.id)
			const previous = this.#motion.get(hand.id)
			const distance = previous ? Math.hypot(hand.x - previous.x, hand.y - previous.y) : 0
			const speed = previous ? previous.speed + (distance / dt - previous.speed) * Math.min(1, dt * 12) : 0
			this.#motion.set(hand.id, { x: hand.x, y: hand.y, z: hand.z, speed })
			return { ...hand, gesture: surface.map(hand, tonality), speed, lead: false, channel: settings.channel }
		})
		for (const id of this.#motion.keys()) {
			if (!seen.has(id)) {
				this.#motion.delete(id)
			}
		}
		const playing = all.filter((hand) => hand.active).sort((a, b) => a.born - b.born)
		const lead = playing.find((hand) => hand.side === "right") ?? playing[0]
		playing.forEach((hand, index) => {
			hand.lead = hand === lead
			hand.channel = settings.mpe ? (settings.channel + 1 + index) % 16 : settings.channel
		})
		this.#hands = playing
		this.#performance.begin(time)
		this.#mode.update({ hands: playing, tonality, settings, time, dt }, this.#performance)
		this.#performance.commit()
		this.#draw(all, time, dt)
		this.#announce(time)
	}

	#draw(hands: PlayingHand[], time: number, dt: number) {
		const g = this.#context
		if (!g) {
			return
		}
		const { width, height } = this.#size
		const drawHands: DrawHand[] = hands.map((hand) => ({
			...hand,
			notes: hand.active ? this.#performance.notesFor(hand.id) : [],
			px: hand.x * width,
			py: hand.y * height
		}))
		if (this.analyser) {
			if (this.#waveform?.length !== this.analyser.fftSize) {
				this.#waveform = new Float32Array(this.analyser.fftSize)
			}
			this.analyser.getFloatTimeDomainData(this.#waveform)
		}
		g.save()
		this.#surface.draw({
			g,
			width,
			height,
			time,
			dt,
			tonality: this.#tonality,
			hands: drawHands,
			events: this.#events,
			theme: this.#theme,
			reducedMotion: this.#reducedMotion,
			waveform: this.analyser ? this.#waveform : undefined
		})
		g.restore()
		const video = this.#camera?.status === "ready" ? this.#camera.video : undefined
		const backdrop = number(this.getAttribute("camera-backdrop"), 0.18, 0, 1)
		if (video && backdrop > 0 && video.videoWidth) {
			g.save()
			g.globalAlpha = backdrop
			g.globalCompositeOperation = "screen"
			if (this.#camera!.mirror) {
				g.translate(width, 0)
				g.scale(-1, 1)
			}
			g.drawImage(video, 0, 0, width, height)
			g.restore()
		}
		for (const hand of drawHands) {
			this.#drawHand(g, hand)
		}
	}

	#drawHand(g: CanvasRenderingContext2D, hand: DrawHand) {
		const sounding = hand.notes.length > 0
		const hue = hueFor(hand.gesture.pitch)
		const radius = 9 + hand.gesture.expression * 14
		g.save()
		if (sounding) {
			const glow = g.createRadialGradient(hand.px, hand.py, 0, hand.px, hand.py, radius * 2.4)
			glow.addColorStop(0, hsl(hue, 95, 70, 0.9))
			glow.addColorStop(1, hsl(hue, 95, 50, 0))
			g.fillStyle = glow
			g.beginPath()
			g.arc(hand.px, hand.py, radius * 2.4, 0, Math.PI * 2)
			g.fill()
		}
		g.strokeStyle = sounding ? "#ffffff" : hsl(hue, 40, 75, 0.7)
		g.lineWidth = sounding ? 2 : 1.25
		g.setLineDash(hand.active ? [] : [4, 4])
		g.beginPath()
		g.arc(hand.px, hand.py, radius, 0, Math.PI * 2)
		g.stroke()
		if (hand.grab > 0.05) {
			g.fillStyle = hsl(hue, 80, 60, hand.grab * 0.6)
			g.beginPath()
			g.arc(hand.px, hand.py, radius * hand.grab, 0, Math.PI * 2)
			g.fill()
		}
		const pitch = hand.gesture.pitch
		const nearest = Math.round(pitch)
		const cents = Math.round((pitch - nearest) * 100)
		const continuous = this.#modeId === "glide" || this.#modeId === "autotune"
		const text = continuous
			? `${noteName(nearest)} ${cents >= 0 ? "+" : ""}${cents}¢`
			: noteName(hand.notes.at(-1) ?? this.#tonality.nearest(pitch))
		g.font = `600 12px ${this.#theme.font}`
		g.textAlign = "center"
		g.fillStyle = this.#theme.foreground
		g.globalAlpha = sounding ? 1 : 0.6
		g.fillText(text, hand.px, hand.py - radius - 8)
		if (hand.source === "leap" || hand.source === "camera") {
			g.font = `10px ${this.#theme.font}`
			g.fillStyle = this.#theme.muted
			g.fillText(hand.side === "left" ? "L" : "R", hand.px, hand.py + 4)
		}
		g.restore()
	}

	#announce(time: number) {
		const status = this.#mode.status?.() ?? ""
		if (status !== this.#status) {
			this.#status = status
			this.#renderStatus()
		}
		if (time - this.#announceAt < 400) {
			return
		}
		const text = this.notes.map(noteName).join(", ")
		if (text !== this.#announced) {
			this.#announced = text
			this.#announceAt = time
			this.root.querySelector("output")!.textContent = text ? `Playing ${text}` : "Silent"
		}
	}

	#renderStatus() {
		const mode = MODES.find((item) => item.id === this.#modeId)!
		const surface = SURFACES.find((item) => item.id === this.#surfaceId)!
		const hud = this.root.querySelector(".hud")
		if (!hud) {
			return
		}
		hud.querySelector(".title")!.textContent = `${mode.name} · ${surface.name}`
		hud.querySelector(".detail")!.textContent =
			this.#status || `${this.key} ${findScale(this.getAttribute("scale")).name.toLowerCase()}, ${noteName(this.low)}–${noteName(this.high)}`
		const sources = hud.querySelector(".sources")!
		sources.replaceChildren(
			...[this.#leap, this.#camera]
				.filter((tracker) => tracker && this.sources.has(tracker.source))
				.map((tracker) => {
					const pill = document.createElement("span")
					pill.className = `pill ${tracker!.status}`
					pill.textContent = tracker!.source === "leap" ? "Leap" : "Camera"
					pill.title = tracker!.message
					return pill
				})
		)
		const describe = this.root.querySelector("#source-status")
		if (describe) {
			describe.textContent = [this.#leap, this.#camera]
				.filter((tracker) => tracker && this.sources.has(tracker.source))
				.map((tracker) => tracker!.message)
				.filter(Boolean)
				.join(". ")
		}
	}

	#onControl(target: HTMLInputElement | HTMLSelectElement) {
		const name = target.name
		if (!name) {
			return
		}
		if (name === "source-leap" || name === "source-camera") {
			const sources = this.sources
			const source = name.slice(7)
			;(target as HTMLInputElement).checked ? sources.add(source) : sources.delete(source)
			sources.delete("none")
			this.sources = sources
			return
		}
		if (name === "mpe") {
			this.mpe = (target as HTMLInputElement).checked
			return
		}
		if (target.value !== this.getAttribute(name)) {
			this.setAttribute(name, target.value)
		}
	}

	#syncControls() {
		const form = this.root.querySelector("form")
		if (!form) {
			return
		}
		const values: Record<string, string | number> = {
			mode: this.#modeId,
			surface: this.#surfaceId,
			scale: this.scale,
			key: this.key,
			low: this.low,
			high: this.high,
			chord: this.chord,
			bpm: this.bpm,
			autotune: this.autotune,
			sustain: this.sustain,
			"bend-range": this.bendRange,
			gate: this.gate,
			smoothing: this.smoothing
		}
		for (const [name, value] of Object.entries(values)) {
			const control = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null
			if (control && control.value !== String(value)) {
				control.value = String(value)
			}
		}
		const sources = this.sources
		;(form.elements.namedItem("source-leap") as HTMLInputElement).checked = sources.has("leap")
		;(form.elements.namedItem("source-camera") as HTMLInputElement).checked = sources.has("camera")
		;(form.elements.namedItem("mpe") as HTMLInputElement).checked = this.mpe
		for (const element of form.elements) {
			;(element as HTMLInputElement).disabled = this.disabled
		}
		this.#canvas.setAttribute("aria-disabled", String(this.disabled))
		this.#renderStatus()
	}

	#template() {
		const keys = NOTE_KEYS.map((key) => `<option value="${key}">${key}</option>`).join("")
		const chords = CHORD_SHAPES.map((shape) => `<option value="${shape}">${shape}</option>`).join("")
		const gates = Object.entries(GATES)
			.map(([id, name]) => `<option value="${id}">${name}</option>`)
			.join("")
		return `<style>${styles}</style>
			<div class="frame" part="frame">
				<canvas part="surface" tabindex="0" role="application" aria-roledescription="theremin"
					aria-label="Theremid playing surface" aria-describedby="help source-status"></canvas>
				<div class="hud" part="hud" aria-hidden="true">
					<div><strong class="title"></strong><span class="detail"></span></div>
					<div class="sources"></div>
				</div>
				<output part="status" class="visually-hidden" aria-live="polite"></output>
				<p id="help" class="visually-hidden">Press and drag, or wave your hands over a Leap Motion or camera.
					With the surface focused, arrow keys move and holding Space or Enter plays; hold Shift for fine moves.
					Sound is supplied by the host.</p>
				<p id="source-status" class="visually-hidden"></p>
			</div>
			<form class="controls" part="controls" aria-label="Theremid settings">
				<label>Mode <select name="mode">${options(MODES)}</select></label>
				<label>Surface <select name="surface">${options(SURFACES)}</select></label>
				<label>Key <select name="key">${keys}</select></label>
				<label>Scale <select name="scale">${options(SCALES)}</select></label>
				<label>Lowest note <input name="low" type="number" min="0" max="126" step="1"></label>
				<label>Highest note <input name="high" type="number" min="1" max="127" step="1"></label>
				<label>Chord <select name="chord">${chords}</select></label>
				<label>Tempo <input name="bpm" type="number" min="20" max="300" step="1"></label>
				<label>Autotune <input name="autotune" type="range" min="0" max="1" step="0.05"></label>
				<label>Note length <input name="sustain" type="range" min="0" max="1" step="0.05"></label>
				<label>Bend range <input name="bend-range" type="number" min="1" max="96" step="1"></label>
				<label><input name="mpe" type="checkbox"> MPE</label>
				<label><input name="source-leap" type="checkbox"> Leap Motion</label>
				<label><input name="source-camera" type="checkbox"> Camera</label>
				<label>Hand gate <select name="gate">${gates}</select></label>
				<label>Smoothing <input name="smoothing" type="range" min="0" max="0.95" step="0.05"></label>
			</form>`
	}
}

export function defineTheremid(tag = TAG) {
	if (!customElements.get(tag)) {
		// A custom element constructor can only be registered once, so other tags get a subclass.
		customElements.define(tag, tag === TAG ? TheremidInput : class extends TheremidInput {})
	}
	return customElements.get(tag) as typeof TheremidInput
}

declare global {
	interface HTMLElementTagNameMap {
		"theremid-input": TheremidInput
	}
}
