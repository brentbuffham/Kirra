import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";

export default defineConfig({
	base: "/dist/", // Adjust this to the path where your assets are hosted
	plugins: [vue(), tsconfigPaths()],
	resolve: {
		alias: {
			"@": "/src"
		}
	},
	build: {
		rollupOptions: {
			input: "./index.html"
		}
	}
});
