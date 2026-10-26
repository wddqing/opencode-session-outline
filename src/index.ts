import { Plugin } from "@opencode/plugin"

/**
 * Server entrypoint.
 *
 * The plugin is CLI-only; this no-op definition keeps the package layout
 * compatible with OpenCode plugin packages that expose both entrypoints.
 */
export default Plugin.define({
  id: "opencode.session-outline",
  setup() {},
})
