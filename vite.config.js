import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port 5174, so the console and the Terminal (5173) can run side by side.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
});
