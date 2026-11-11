/**
 * Registration for HarmonEasy's UI input components (packages/audiobus/ui/input-components.ts).
 * HarmonEasy wraps the element in InputWebComponent, which forwards its MIDI 2.0 events into the
 * active chain and persists its attributes with the workspace.
 */
export const THEREMID_INPUT_ID = "theremid" as const

export const HARMONEASY_INPUT_COMPONENT = {
	tag: "theremid-input",
	name: "Theremid",
	description:
		"Play in the air with Leap Motion, a camera or a pointer: theremin glides, scales, chords, arpeggios and strums over nine visual surfaces",
	subtype: "pointer",
	load: () => import("./index.ts")
} as const
