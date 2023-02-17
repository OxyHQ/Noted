<template>
  <button type="button" @click="setIsOpen(true)"
    class="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75">
    <Icon name="material-symbols:settings-suggest-outline-sharp" size="25" class="hidden h-6 w-6 xl:block" />
  </button>
  <div class="z-10 fixed" v-if="isOpen" @close="setIsOpen">
    <div class="fixed inset-0 flex items-center justify-center p-4">
      <div class="hover-animation fixed inset-0 bg-black/40 dark:bg-[#5B7083]/40" aria-hidden="true"
        data-projection-id="2" style="opacity: 1"></div>
      <div class="overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
        <div class="hover-animation fixed inset-0 bg-black/40 dark:bg-[#5B7083]/40"></div>
        <div class="fixed inset-0 flex items-center justify-center p-4">
          <div
            class="max-w-xl max-h-[calc(100vh-4rem)] overflow-auto bg-main-background w-full p-8 rounded-2xl hover-animation"
            id="headlessui-dialog-panel-:r9h:" data-headlessui-state="open" data-projection-id="6"
            style="opacity: 1; transform: none">
            <div class="flex flex-col items-center gap-6">
              <div class="flex flex-col gap-3 text-center">
                <h2 class="text-2xl font-bold">{{ $t('customizeViewTitle') }}</h2>
                <p class="text-light-secondary dark:text-dark-secondary">{{ $t('customizeViewDescription') }}</p>
              </div>
              <article
                class="hover-animation mx-8 rounded-2xl border border-light-border px-4 py-3 dark:border-dark-border">
                <div class="grid grid-cols-[auto,1fr] gap-3">
                  <NuxtLink class="blur-picture flex self-start pointer-events-none" tabindex="-1" to="/home">
                    <figure style="width: 48px">
                      <span style="
                                                            box-sizing: border-box;
                                                            display: block;
                                                            overflow: hidden;
                                                            width: initial;
                                                            height: initial;
                                                            background: none;
                                                            opacity: 1;
                                                            border: 0px;
                                                            margin: 0px;
                                                            padding: 0px;
                                                            position: relative;
                                                            "><span style="
                                                            box-sizing: border-box;
                                                            display: block;
                                                            width: initial;
                                                            height: initial;
                                                            background: none;
                                                            opacity: 1;
                                                            border: 0px;
                                                            margin: 0px;
                                                            padding: 100% 0px 0px;
                                                            "></span><img alt="Mention"
                          src="~/assets/images/Logo/Logo.png" decoding="async" data-nimg="responsive"
                          class="rounded-full object-cover" style="
                                                            position: absolute;
                                                            inset: 0px;
                                                            box-sizing: border-box;
                                                            padding: 0px;
                                                            border: none;
                                                            margin: auto;
                                                            display: block;
                                                            width: 0px;
                                                            height: 0px;
                                                            min-width: 100%;
                                                            max-width: 100%;
                                                            min-height: 100%;
                                                            max-height: 100%;
                                                            " /></span>
                    </figure>
                  </NuxtLink>
                  <div>
                    <div class="flex gap-1">
                      <a class="flex items-center gap-1 truncate font-bold pointer-events-none" tabindex="-1"
                        href="/home#">
                        <p class="truncate">Mention</p>
                        <i>
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
                            aria-hidden="true" class="fill-accent-blue h-5 w-5">
                            <path fill-rule="evenodd"
                              d="M8.603 3.799A4.49 4.49 0 0112 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 013.498 1.307 4.491 4.491 0 011.307 3.497A4.49 4.49 0 0121.75 12a4.49 4.49 0 01-1.549 3.397 4.491 4.491 0 01-1.307 3.497 4.491 4.491 0 01-3.497 1.307A4.49 4.49 0 0112 21.75a4.49 4.49 0 01-3.397-1.549 4.49 4.49 0 01-3.498-1.306 4.491 4.491 0 01-1.307-3.498A4.49 4.49 0 012.25 12c0-1.357.6-2.573 1.549-3.397a4.49 4.49 0 011.307-3.497 4.49 4.49 0 013.497-1.307zm7.007 6.387a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
                              clip-rule="evenodd"></path>
                          </svg>
                        </i>
                      </a>
                      <p class="text-light-secondary dark:text-dark-secondary">
                        @mention
                      </p>
                      <div class="flex gap-1 text-light-secondary dark:text-dark-secondary">
                        <i>·</i>
                        <p>16m</p>
                      </div>
                    </div>
                    <p class="whitespace-pre-line break-words">
                      At the heart of Mention are short messages called Mentions
                      — just like this one — which can include photos, videos,
                      links, text, hashtags, and mentions like
                      <span class="text-main-accent">@mention</span>.
                    </p>
                  </div>
                </div>
              </article>
              <div class="flex w-full flex-col gap-1">
                <p class="text-sm font-bold text-light-secondary dark:text-dark-secondary">{{ $t('customizeViewColor') }}
                </p>
                <div
                  class="hover-animation grid grid-cols-3 grid-rows-2 justify-items-center gap-3 rounded-2xl bg-main-sidebar-background py-3 xs:grid-cols-6 xs:grid-rows-none">
                  <label v-for="color in ['blue', 'orange', 'green', 'yellow', 'purple', 'pink']"
                    :class="`bg-accent-${color} hover:ring-accent-${color}/10 active:ring-accent-${color}/20`"
                    class="hover-animation flex h-10 w-10 cursor-pointer items-center justify-center rounded-full hover:ring"
                    :for="color">
                    <input class="peer absolute h-0 w-0 opacity-0" :id="color" type="radio" name="accent" value="blue"
                      :checked="color === 'blue'" tabindex="0" />
                    <i class="text-white peer-checked:inner:opacity-100">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                        stroke="currentColor" aria-hidden="true"
                        class="h-6 w-6 opacity-0 transition-opacity duration-200">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"></path>
                      </svg>
                    </i>
                  </label>
                </div>
              </div>
              <div class="flex w-full flex-col gap-1">
                <p class="text-sm font-bold text-light-secondary dark:text-dark-secondary">{{ $t('customizeViewTheme') }}
                </p>
                <div
                  class="hover-animation grid grid-rows-3 gap-3 rounded-2xl bg-main-sidebar-background px-4 py-3 xs:grid-cols-3 xs:grid-rows-none">
                  <label v-for="color of ['system', 'light', 'dark', 'sepia']" :key="color" :class="{
                    preferred: !$colorMode.unknown && color === $colorMode.preference,
                    selected: !$colorMode.unknown && color === $colorMode.value
                  }"
                    class="capitalize flex cursor-pointer items-center gap-2 rounded p-3 font-bold ring-main-accent transition duration-200 [&amp;:has(div>input:checked)]:ring-2 text-black bg-white [&amp;:hover>div]:bg-light-secondary/10 [&amp;:active>div]:bg-light-secondary/20"
                    :for="`themeSelector-${color}`" @click="$colorMode.preference = color">
                    <div class="hover-animation flex h-10 w-10 items-center justify-center rounded-full">
                      <input class="peer absolute h-0 w-0 opacity-0" :id="`themeSelector-${color}`" type="radio"
                        name="theme" :value="color" :checked="color === $colorMode.value" />
                      <i
                        class="flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#B9CAD3] text-white transition duration-200 peer-checked:border-transparent peer-checked:bg-main-accent peer-checked:inner:opacity-100 border-[#B9CAD3]">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                          stroke="currentColor" aria-hidden="true"
                          class="h-full w-full p-0.5 opacity-0 transition-opacity duration-200">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"></path>
                        </svg>
                      </i>
                    </div>
                    {{ color }}
                  </label>
                </div>
              </div>
              <ChangeLanguage />
              <button
                class="custom-button main-tab bg-main-accent px-4 py-1.5 font-bold text-white hover:bg-main-accent/90 active:bg-main-accent/75"
                type="button" @click="setIsOpen(false)">{{ $t('done') }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
</div>
</template>

<script setup>
const isOpen = ref(false);

function setIsOpen(value) {
  isOpen.value = value;
}
</script>
