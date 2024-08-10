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
	dev: {
		watch: {
			usePolling: true
		}
	},
	build: {
		rollupOptions: {
			input: "./index.html",
			output: {
				entryFileNames: "assets/kirra3d.js",
				chunkFileNames: "assets/[name].js",
				assetFileNames: ({ name }) => {
					if (name && name.endsWith(".css")) {
						return "assets/kirra3d.css";
					}
					return "assets/[name].[ext]";
				}
			}
		}
	}
});
