module.exports = {
  packagerConfig: {
    asar: true,
    overwrite: true,
    executableName: "Even Terminal Launcher",
    icon:
      process.platform === "darwin"
        ? "assets/icon.icns"
        : process.platform === "win32"
          ? "assets/icon.ico"
          : "assets/app-icon.png",
    appBundleId: "com.mintimer.eventerminallauncher",
    appCategoryType: "public.app-category.developer-tools",
    ignore: [
      /^\/\.git(?:\/|$)/,
      /^\/\.github(?:\/|$)/,
      /^\/out(?:\/|$)/,
      /^\/src(?:\/|$)/,
      /^\/tests(?:\/|$)/,
      /^\/docs(?:\/|$)/,
      /^\/scripts(?:\/|$)/,
      /^\/README(?:\.ja)?\.md$/,
      /^\/(?:eslint\.config\.mjs|tsconfig\.json|mise\.toml)$/
    ],
    extendInfo: {
      LSUIElement: true
    },
    extraResource: [
      "LICENSE",
      "NOTICE.md",
      "THIRD_PARTY_NOTICES.md",
      "BRAND_ASSETS.md"
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"]
    },
    {
      name: "@electron-forge/maker-dmg",
      config: {
        format: "ULFO"
      }
    }
  ]
};
