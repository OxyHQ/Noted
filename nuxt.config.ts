// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  app: {
    head: {
      charset: "utf-8",
      viewport:
        "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no",
      title: "Noted by Kaana",
      meta: [
        {
          name: "description",
          content:
            "We believe in the potential of people when they can come together.",
        },
      ],
      script: [
        /*{ src: "//assets.kaana.io/js/jquery-3.5.1.min.js" },*/
      ],
      noscript: [{ children: "JavaScript is required" }],
      link: [
        /*{ rel: "stylesheet", href: "//assets.kaana.io/css/basic.css" },*/
      ],
    },
  },
  modules: [
    "@nuxtjs/supabase",
    "@nuxtjs/i18n",
    "nuxt-icon",
    "nuxt-headlessui",
    [
      "@pinia/nuxt",
      {
        autoImports: ["defineStore", "acceptHMRUpdate"],
      },
    ],
    "@pinia-plugin-persistedstate/nuxt",
    "@nuxtjs/color-mode",
  ],
  imports: {
    dirs: ["stores"],
  },
  piniaPersistedstate: {
    storage: "localStorage",
  },
  i18n: {
    locales: [
      {
        code: "fr-FR",
        file: "fr-FR.json",
      },
      {
        code: "en-US",
        file: "en-US.json",
      },
      {
        code: "es-ES",
        file: "es-ES.json",
      },
      {
        code: "it-IT",
        file: "it-IT.json",
      },
    ],
    langDir: "locales",
    defaultLocale: "en-US",
    strategy: "no_prefix",
    legacy: false,
    globalInjection: true,
    vueI18n: {
      fallbackLocale: "en-US",
    },
  },
  postcss: {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
  },
  css: ["@/assets/css/main.css", "@/assets/css/main.scss"],
  headlessui: {
    prefix: "Headless",
  },
  colorMode: {
    preference: "system", // default value of $colorMode.preference
    fallback: "light", // fallback value if not system preference found
    classPrefix: "",
    classSuffix: "",
    storageKey: "nuxt-color-mode",
  },
});
