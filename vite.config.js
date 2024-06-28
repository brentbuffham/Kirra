import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	base: "./",
	plugins: [vue(), tsconfigPaths()],
	resolve: {
		alias: {
			"@": "/src"
		}
	}
});
