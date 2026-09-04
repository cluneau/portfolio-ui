import { defineConfig } from 'vite'

// Project page is served from https://cluneau.github.io/portfolio-ui/, so the
// build needs that subpath as its base. Dev/preview stay at the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/portfolio-ui/' : '/',
}))
