import type { Definition, Surface } from "../types.ts"
import { Aurora, Nebula, Scope } from "./atmospheric.ts"
import { Aether, Ribbon, Strings } from "./classic.ts"
import { Horizon, Lattice, Orbit } from "./spatial.ts"

export const SURFACES: readonly Definition<Surface>[] = [
	{
		id: "aether",
		name: "Aether",
		description: "The classic theremin: a pitch antenna, a volume loop and a field that bends around your hands.",
		create: () => new Aether()
	},
	{
		id: "strings",
		name: "Strings",
		description: "A harp of scale strings that ring when played. Pairs well with Strum.",
		create: () => new Strings()
	},
	{
		id: "ribbon",
		name: "Ribbon",
		description: "An Ondes Martenot ribbon over a keyboard, tracing every glide.",
		create: () => new Ribbon()
	},
	{
		id: "orbit",
		name: "Orbit",
		description: "A dial: the angle around the centre sets pitch and the distance out sets expression.",
		create: () => new Orbit()
	},
	{
		id: "lattice",
		name: "Lattice",
		description: "A harmonic table of hexagons: up a fifth, diagonally a third. Chords become shapes.",
		create: () => new Lattice()
	},
	{
		id: "horizon",
		name: "Horizon",
		description: "A synthwave horizon with scale notes as lanes into the distance.",
		create: () => new Horizon()
	},
	{
		id: "nebula",
		name: "Nebula",
		description: "A particle cloud that swirls around your hands. Pitch rises upwards.",
		create: () => new Nebula()
	},
	{
		id: "scope",
		name: "Oscilloscope",
		description: "A phosphor scope of the waveform, drawing Lissajous figures for two hands.",
		create: () => new Scope()
	},
	{
		id: "aurora",
		name: "Aurora",
		description: "Northern lights: every note raises a curtain of light.",
		create: () => new Aurora()
	}
]

export function findSurface(id: string | null | undefined) {
	return SURFACES.find((surface) => surface.id === id) ?? SURFACES[0]!
}
