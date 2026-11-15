/**
 * Registration for HarmonEasy's UI input components (packages/audiobus/ui/input-components.ts).
 * It replaces HarmonEasy's old `leap-motion` input, which needed the abandoned Leap SDK as a global,
 * and keeps that input's id so saved workspaces and hardware presets still resolve. HarmonEasy wraps
 * the element in InputWebComponent, which forwards its MIDI 2.0 events into the active chain and
 * persists its attributes with the workspace.
 */
export const THEREMID_INPUT_ID = "leap-motion" as const

export const HARMONEASY_INPUT_COMPONENT = {
	tag: "theremid-input",
	name: "Leap Motion",
	description:
		"Play in the air with a Leap Motion, the camera or a pointer: theremin glides, scales, chords, arpeggios and strums over 2D and 3D surfaces",
	subtype: "gesture",
	load: () => import("./index.ts")
} as const
