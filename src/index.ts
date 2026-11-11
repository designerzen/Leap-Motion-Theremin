import { defineTheremid } from "./theremid-input.ts"

export { TheremidInput, defineTheremid, TAG } from "./theremid-input.ts"
export { ThereminSynth } from "./synth.ts"
export { MODES, findMode } from "./modes/index.ts"
export { SURFACES, findSurface } from "./surfaces/index.ts"
export { SCALES, CHORD_SHAPES, Tonality, findScale, parseKey } from "./scales.ts"
export { CAMERA_ASSETS } from "./tracking/camera.ts"
export { DEFAULT_LEAP_URL } from "./tracking/leap.ts"
export { Performance } from "./performance.ts"
export * from "./midi.ts"
export type * from "./types.ts"
export { THEREMID_INPUT_ID, HARMONEASY_INPUT_COMPONENT } from "./harmoneasy.ts"

// Importing the package registers <theremid-input>, as HarmonEasy's lazy UI inputs expect.
defineTheremid()
