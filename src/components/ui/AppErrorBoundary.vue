<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue'

const error = ref<string | null>(null)
const isChunkError = ref(false)

onErrorCaptured((err) => {
  error.value = err.message
  isChunkError.value =
    err.message.includes('Failed to fetch dynamically imported module') ||
    err.message.includes('ChunkLoadError') ||
    err.message.includes('Loading chunk')
  return false
})

function reload() {
  window.location.reload()
}
</script>

<template>
  <div v-if="error" class="min-h-dvh flex items-center justify-center p-6">
    <div class="text-center max-w-md">
      <div class="text-4xl mb-4">{{ isChunkError ? '🔄' : '⚠️' }}</div>
      <h2 class="text-xl font-bold mb-2">
        {{ isChunkError ? '页面加载失败' : '出现错误' }}
      </h2>
      <p class="text-sm text-[var(--text-2)] mb-4">{{ error }}</p>
      <button
        class="px-4 py-2 rounded-lg bg-[var(--primary)] text-white font-medium"
        @click="reload"
      >
        {{ isChunkError ? '刷新页面' : '重试' }}
      </button>
    </div>
  </div>
  <slot v-else />
</template>
