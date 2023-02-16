<template>
  <div class="flex w-full justify-center gap-0 lg:gap-4">
    <HomeSidebar />
    <div
      class="hover-animation flex w-full flex-col border-x-0 border-light-border pb-10 dark:border-dark-border xs:border-x">
      <NuxtPage class="min-h-screen flex-col" />
      <Footer />
    </div>
</div>
</template>