import {
	CC_BRIGHTNESS,
	CC_EXPRESSION,
	CC_MODULATION,
	CC_VOLUME,
	CONTROL_CHANGE,
	frequency,
	NOTE_OFF,
	NOTE_ON,
	PITCH_BEND,
	type ControlChangeDetail,
	type NoteDetail,
	type PitchBendDetail
} from "./midi.ts"

interface Voice {
	oscillators: OscillatorNode[]
	envelope: GainNode
	channel: number
}

interface Channel {
	bend: number
	volume: number
	expression: number
	input: GainNode
	filter: BiquadFilterNode
	level: GainNode
	vibrato: GainNode
}

const RELEASE = 0.12

/**
 * A small polyphonic synth that voices Theremid events on its own, for use outside HarmonEasy.
 * Channels keep their own bend, vibrato (CC1), volume (CC7), expression (CC11) and brightness
 * (CC74), so MPE playing works too. The original 2014 dub delay lives on as a send effect.
 */
export class ThereminSynth {
	readonly context: AudioContext
	readonly analyser: AnalyserNode
	readonly output: GainNode
	waveform: OscillatorType = "sawtooth"
	/** Must match the controller's bend range. */
	bendRange = 2
	#voices = new Map<string, Voice>()
	#channels = new Map<number, Channel>()
	#lfo: OscillatorNode
	#bus: GainNode

	constructor(context = new AudioContext({ latencyHint: "interactive" })) {
		this.context = context
		this.#bus = context.createGain()
		const compressor = context.createDynamicsCompressor()
		compressor.threshold.value = -18
		compressor.ratio.value = 4
		this.output = context.createGain()
		this.output.gain.value = 0.8
		this.analyser = context.createAnalyser()
		this.analyser.fftSize = 2048
		const delay = context.createDelay(2)
		delay.delayTime.value = 0.36
		const feedback = context.createGain()
		feedback.gain.value = 0.38
		const tone = context.createBiquadFilter()
		tone.frequency.value = 1800
		const send = context.createGain()
		send.gain.value = 0.28
		this.#bus.connect(compressor)
		this.#bus.connect(send).connect(delay)
		delay.connect(feedback).connect(tone).connect(delay)
		delay.connect(compressor)
		compressor.connect(this.output).connect(this.analyser).connect(context.destination)
		this.#lfo = context.createOscillator()
		this.#lfo.frequency.value = 5.5
		this.#lfo.start()
	}

	/** Listen to a controller's events; returns a function that stops listening. */
	attach(target: EventTarget & { bendRange?: number }) {
		const abort = new AbortController()
		const options = { signal: abort.signal }
		target.addEventListener(
			NOTE_ON,
			(event) => {
				this.bendRange = target.bendRange ?? this.bendRange
				this.noteOn((event as CustomEvent<NoteDetail>).detail)
			},
			options
		)
		target.addEventListener(NOTE_OFF, (event) => this.noteOff((event as CustomEvent<NoteDetail>).detail), options)
		target.addEventListener(
			PITCH_BEND,
			(event) => {
				this.bendRange = target.bendRange ?? this.bendRange
				this.pitchBend((event as CustomEvent<PitchBendDetail>).detail)
			},
			options
		)
		target.addEventListener(
			CONTROL_CHANGE,
			(event) => this.controlChange((event as CustomEvent<ControlChangeDetail>).detail),
			options
		)
		return () => abort.abort()
	}

	#channel(number: number) {
		let channel = this.#channels.get(number)
		if (!channel) {
			const context = this.context
			const input = context.createGain()
			const filter = context.createBiquadFilter()
			filter.type = "lowpass"
			filter.Q.value = 2
			filter.frequency.value = 2400
			const level = context.createGain()
			const vibrato = context.createGain()
			vibrato.gain.value = 0
			this.#lfo.connect(vibrato)
			input.connect(filter).connect(level).connect(this.#bus)
			channel = { bend: 0, volume: 1, expression: 1, input, filter, level, vibrato }
			this.#channels.set(number, channel)
		}
		return channel
	}

	#level(channel: Channel) {
		channel.level.gain.setTargetAtTime(channel.volume * channel.expression, this.context.currentTime, 0.02)
	}

	noteOn(detail: NoteDetail) {
		const key = `${detail.channel}:${detail.id}`
		this.#release(key)
		const context = this.context
		const now = context.currentTime
		const channel = this.#channel(detail.channel)
		const envelope = context.createGain()
		envelope.gain.setValueAtTime(0, now)
		envelope.gain.linearRampToValueAtTime(0.12 + 0.28 * detail.velocity, now + 0.015)
		envelope.connect(channel.input)
		const oscillators = [
			{ type: this.waveform, ratio: 1, level: 1 },
			{ type: "sine" as OscillatorType, ratio: 0.5, level: 0.35 }
		].map(({ type, ratio, level }) => {
			const oscillator = context.createOscillator()
			oscillator.type = type
			oscillator.frequency.value = frequency(detail.note.noteNumber) * ratio
			oscillator.detune.value = channel.bend * this.bendRange * 100
			channel.vibrato.connect(oscillator.detune)
			const gain = context.createGain()
			gain.gain.value = level
			oscillator.connect(gain).connect(envelope)
			oscillator.start(now)
			return oscillator
		})
		this.#voices.set(key, { oscillators, envelope, channel: detail.channel })
	}

	noteOff(detail: NoteDetail) {
		this.#release(`${detail.channel}:${detail.id}`)
	}

	#release(key: string) {
		const voice = this.#voices.get(key)
		if (!voice) {
			return
		}
		this.#voices.delete(key)
		const now = this.context.currentTime
		voice.envelope.gain.cancelScheduledValues(now)
		voice.envelope.gain.setTargetAtTime(0, now, RELEASE)
		for (const oscillator of voice.oscillators) {
			oscillator.stop(now + RELEASE * 6)
			oscillator.onended = () => voice.envelope.disconnect()
		}
	}

	pitchBend(detail: PitchBendDetail) {
		const channel = this.#channel(detail.channel)
		channel.bend = detail.value
		const now = this.context.currentTime
		for (const voice of this.#voices.values()) {
			if (voice.channel === detail.channel) {
				for (const oscillator of voice.oscillators) {
					oscillator.detune.setTargetAtTime(detail.value * this.bendRange * 100, now, 0.012)
				}
			}
		}
	}

	controlChange(detail: ControlChangeDetail) {
		const channel = this.#channel(detail.channel)
		const now = this.context.currentTime
		switch (detail.controller) {
			case CC_VOLUME:
				channel.volume = detail.value
				this.#level(channel)
				break
			case CC_EXPRESSION:
				channel.expression = 0.15 + 0.85 * detail.value
				this.#level(channel)
				break
			case CC_MODULATION:
				channel.vibrato.gain.setTargetAtTime(detail.value * 60, now, 0.05)
				break
			case CC_BRIGHTNESS:
				channel.filter.frequency.setTargetAtTime(250 * 2 ** (detail.value * 6), now, 0.03)
				break
		}
	}

	panic() {
		for (const key of [...this.#voices.keys()]) {
			this.#release(key)
		}
	}
}
