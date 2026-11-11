import { defineConfig } from "vite"

// `vite build` emits the library; `vite build --mode demo` emits the standalone demo site.
export default defineConfig(({ mode }) =>
	mode === "demo"
		? { base: "./", build: { outDir: "dist-demo" } }
		: {
				build: {
					emptyOutDir: false,
					lib: { entry: "src/index.ts", formats: ["es"], fileName: "theremid" }
				},
				test: { environment: "happy-dom" }
			}
)
