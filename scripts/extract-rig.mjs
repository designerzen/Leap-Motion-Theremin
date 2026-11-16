// Extracts the two rigged hand meshes from the original LeapJS Rigged Hand plugin (Apache 2.0,
// Copyright 2014 LeapMotion, Inc) into compact JSON: decoded triangles, skin weights and bones.
import { readFileSync, writeFileSync } from "node:fs"

const source = readFileSync("legacy/src/javascript/vendor/leap.rigged-hand-0.1.5.js", "utf8")
const round = (n, places = 4) => Number(n.toFixed(places))

function grab(name) {
	const start = source.indexOf(`rigs.${name} = {`) + `rigs.${name} = `.length
	const end = source.indexOf("\n};", start) + 2
	return JSON.parse(source.slice(start, end))
}

function decode(rig) {
	const faces = rig.faces
	const indices = []
	const normalIndices = []
	let cursor = 0
	let normalsMatch = true
	while (cursor < faces.length) {
		const type = faces[cursor++]
		const quad = type & 1
		const hasMaterial = type & 2, hasFaceUv = type & 4, hasFaceVertexUv = type & 8
		const hasFaceNormal = type & 16, hasFaceVertexNormal = type & 32
		const hasFaceColor = type & 64, hasFaceVertexColor = type & 128
		const count = quad ? 4 : 3
		const verts = faces.slice(cursor, cursor + count)
		cursor += count
		if (hasMaterial) cursor++
		if (hasFaceUv) cursor += rig.uvs.length
		if (hasFaceVertexUv) cursor += rig.uvs.length * count
		if (hasFaceNormal) cursor++
		let normals = verts
		if (hasFaceVertexNormal) {
			normals = faces.slice(cursor, cursor + count)
			cursor += count
			for (let i = 0; i < count; i++) if (normals[i] !== verts[i]) normalsMatch = false
		}
		if (hasFaceColor) cursor++
		if (hasFaceVertexColor) cursor += count
		const tris = quad ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]]
		for (const [a, b, c] of tris) {
			indices.push(verts[a], verts[b], verts[c])
			normalIndices.push(normals[a], normals[b], normals[c])
		}
	}
	return { indices, normalsMatch }
}

for (const side of ["left", "right"]) {
	const rig = grab(side)
	const { indices, normalsMatch } = decode(rig)
	const vertexCount = rig.vertices.length / 3
	const skinIndices = rig.skinIndices, skinWeights = rig.skinWeights
	const stride = skinIndices.length / vertexCount
	const out = {
		license: "Hand mesh from LeapJS Rigged Hand 0.1.5, Copyright 2014 LeapMotion, Inc, Apache License 2.0",
		side,
		positions: rig.vertices.map((n) => round(n)),
		indices,
		skinIndices: Array.from({ length: vertexCount * 2 }, (_, i) => skinIndices[Math.floor(i / 2) * stride + (i % 2)]),
		skinWeights: Array.from({ length: vertexCount * 2 }, (_, i) => round(skinWeights[Math.floor(i / 2) * stride + (i % 2)], 4)),
		bones: rig.bones.map((b) => ({ name: b.name, parent: b.parent, pos: b.pos.map((n) => round(n, 5)) }))
	}
	console.log(side, { vertexCount, triangles: indices.length / 3, stride, normalsMatch, maxIndex: Math.max(...indices), bones: out.bones.length,
		rotq: rig.bones.every((b) => b.rotq.join() === "0,0,0,1") })
	writeFileSync(`src/hand/rig-${side}.json`, JSON.stringify(out))
}
