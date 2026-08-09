const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require('nativewind/metro');

// Web shim for react-native-track-player (avoids bundling shaka-player)
const trackPlayerWebShim = path.resolve(
  __dirname,
  "lib/shims/react-native-track-player.web.js"
);

// Reached by path rather than by `require.resolve`, which honours the package's
// `exports` map and so can only ever hand back the minified build this exists to
// avoid. Asserted here rather than at bundle time: a missing file would
// otherwise surface as a resolution error deep inside transformers.js, pointing
// at the wrong thing entirely.
const onnxWebGpuBuild = path.resolve(
  __dirname,
  "../../node_modules/onnxruntime-web/dist/ort.webgpu.mjs"
);
if (!require("fs").existsSync(onnxWebGpuBuild)) {
  throw new Error(
    `onnxruntime-web's unminified WebGPU build is missing at ${onnxWebGpuBuild}. ` +
      "Web transcription cannot be bundled without it — see the resolver below."
  );
}

module.exports = (() => {
  const config = getDefaultConfig(__dirname);

  // Enable package exports for zod v4 compatibility
  config.resolver.unstable_enablePackageExports = true;

  // Add web-specific resolver settings to handle ESM modules
  config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs', 'cjs'];

  // SVG support for react-native-svg-transformer (Expo transformer)
  const { transformer, resolver } = config;
  config.transformer = {
    ...transformer,
    babelTransformerPath: require.resolve("react-native-svg-transformer/expo"),
  };
  config.resolver = {
    ...resolver,
    assetExts: [...resolver.assetExts.filter((ext) => ext !== "svg"), "wasm", "woff2", "woff"],
    sourceExts: [...resolver.sourceExts, "svg"],
    // On web, replace react-native-track-player with a no-op shim so the
    // bundler never pulls in shaka-player (TTS uses expo-speech on web).
    resolveRequest: (context, moduleName, platform) => {
      if (platform === "web" && moduleName === "react-native-track-player") {
        return { filePath: trackPlayerWebShim, type: "sourceFile" };
      }
      // transformers.js reaches ONNX through `onnxruntime-web/webgpu`, whose
      // exports map points at a MINIFIED bundle. Every minified build contains
      // `import(/*webpackIgnore:true*/ a)` — a dynamic import of a variable,
      // which Metro's parser rejects outright, so the web bundle fails to
      // build at all.
      //
      // The unminified build of the same backend does not contain it, so this
      // points there. It is the same code and the same WebGPU support, just not
      // pre-minified — and it is behind a dynamic import that only loads when
      // somebody actually transcribes, so the size is paid by that person
      // rather than by every page load.
      if (platform === "web" && moduleName === "onnxruntime-web/webgpu") {
        return { filePath: onnxWebGpuBuild, type: "sourceFile" };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  };

  // `input` is a NativeWind v4 option and does not exist in v5 / react-native-css
  // v3 (`WithReactNativeCSSOptions extends CompilerOptions`, which has no such
  // key) — the stylesheet is pulled in by `import '../global.css'` in
  // `app/_layout.tsx` and compiled by the CSS-aware Metro transformer.
  return withNativeWind(config, {
    inlineRem: 16,
    inlineVariables: false
  });
})();
