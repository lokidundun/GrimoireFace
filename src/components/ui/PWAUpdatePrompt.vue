<script setup lang="ts">
import { ref } from 'vue'

const showUpdate = ref(false)
const showOffline = ref(false)

// vite-plugin-pwa registers the SW and emits events via useRegisterSW
// We listen for the custom event dispatched by the PWA plugin
if (typeof window !== 'undefined') {
  window.addEventListener('sw-update-available' as any, () => {
    showUpdate.value = true
  })
  window.addEventListener('sw-offline-ready' as any, () => {
    showOffline.value = true
    setTimeout(() => { showOffline.value = false }, 4000)
  })
}

function reload() {
  window.location.reload()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="toast">
      <div
        v-if="showUpdate || showOffline"
        class="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl bg-[var(--surface-2)] border border-[var(--border)] shadow-lg p-4"
      >
        <template v-if="showUpdate">
          <p class="font-medium mb-2">新版本可用</p>
          <div class="flex gap-2">
            <button
              class="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-sm font-medium"
              @click="reload"
            >
              更新
            </button>
            <button
              class="px-3 py-1.5 rounded-lg text-sm text-[var(--text-2)]"
              @click="showUpdate = false"
            >
              稍后
            </button>
          </div>
        </template>
        <template v-else>
          <p class="text-sm">已支持离线使用</p>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(1rem);
}
</style>
