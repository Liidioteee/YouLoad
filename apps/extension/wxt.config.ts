import { defineConfig } from "wxt";

import extensionKey from "./extension-key.json";

// The extension only hands work to the YouLoad app; it never downloads by itself.
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  zip: {
    artifactTemplate: "youload-extension-{{version}}-{{browser}}.zip",
    sourcesTemplate: "youload-extension-{{version}}-sources.zip",
  },
  srcDir: "src",
  manifest: ({ browser }) => ({
    name: "YouLoad",
    description: "Download YouTube videos, audio and playlists with the YouLoad app",
    permissions: ["nativeMessaging", "contextMenus", "storage"],
    host_permissions: ["*://*.youtube.com/*"],
    // Pins the Chrome extension id so the YouLoad app accepts it (see native_host.rs).
    ...(browser === "firefox"
      ? { browser_specific_settings: { gecko: { id: extensionKey.firefoxId, strict_min_version: "128.0" } } }
      : { key: extensionKey.key }),
  }),
});
