import { describe, expect, it } from "vitest"
import { Performance } from "../src/performance.ts"

function recorder() {
	const log: string[] = []
	const performance = new Performance({
		noteOn: (note, _velocity, id, channel) => log.push(`on ${note} #${id} ch${channel}`),
		noteOff: (note, id) => log.push(`off ${note} #${id}`),
		bend: (channel, value) => log.push(`bend ch${channel} ${value}`),
		control: (channel, controller, value) => log.push(`cc${controller} ch${channel} ${value}`)
	})
	return { log, performance }
}

describe("Performance", () => {
	it("starts new notes before releasing old ones (legato)", () => {
		const { log, performance } = recorder()
		performance.begin(0)
		performance.hold("a", [60], 1, 0)
		performance.commit()
		performance.begin(16)
		performance.hold("a", [62], 1, 0)
		performance.commit()
		expect(log).toEqual(["on 60 #1 ch0", "on 62 #2 ch0", "off 60 #1"])
	})

	it("keeps common tones sounding when a chord changes", () => {
		const { log, performance } = recorder()
		performance.begin(0)
		performance.hold("a", [60, 64, 67], 1, 0)
		performance.commit()
		log.length = 0
		performance.begin(16)
		performance.hold("a", [60, 65, 69], 1, 0)
		performance.commit()
		expect(log).toEqual(["on 65 #4 ch0", "on 69 #5 ch0", "off 64 #2", "off 67 #3"])
	})

	it("releases voices that disappear and resets bends", () => {
		const { log, performance } = recorder()
		performance.begin(0)
		performance.hold("a", [60], 1, 0)
		performance.bend(0, 0.5)
		performance.commit()
		performance.begin(16)
		performance.commit()
		expect(log).toEqual(["bend ch0 0.5", "on 60 #1 ch0", "bend ch0 0", "off 60 #1"])
	})

	it("ends triggered notes after their duration", () => {
		const { log, performance } = recorder()
		performance.begin(0)
		performance.trigger("a", 60, 1, 100, 0)
		performance.commit()
		performance.begin(50)
		performance.commit()
		expect(log).toEqual(["on 60 #1 ch0"])
		performance.begin(120)
		performance.commit()
		expect(log).toEqual(["on 60 #1 ch0", "off 60 #1"])
	})

	it("only sends controller changes", () => {
		const { log, performance } = recorder()
		for (const time of [0, 16, 32]) {
			performance.begin(time)
			performance.control(0, 11, 0.5)
			performance.commit()
		}
		expect(log).toEqual(["cc11 ch0 0.5"])
	})

	it("releases everything on demand", () => {
		const { log, performance } = recorder()
		performance.begin(0)
		performance.hold("a", [60, 64], 1, 0)
		performance.commit()
		performance.releaseAll()
		expect(log.slice(2)).toEqual(["off 60 #1", "off 64 #2"])
		expect(performance.sounding).toEqual([])
	})
})
