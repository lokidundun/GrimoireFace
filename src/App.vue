<script setup lang="ts">
import { onMounted } from 'vue'
import Navbar from '@/components/layout/Navbar.vue'
import OnboardingGuide from '@/components/layout/OnboardingGuide.vue'
import PWAUpdatePrompt from '@/components/ui/PWAUpdatePrompt.vue'
import AppErrorBoundary from '@/components/ui/AppErrorBoundary.vue'
import { useStudyStore } from '@/stores/useStudyStore'
import { useAuthStore } from '@/stores/useAuthStore'

const studyStore = useStudyStore()
const authStore = useAuthStore()

onMounted(() => {
  studyStore.init()
  authStore.init()
})
</script>

<template>
  <AppErrorBoundary>
    <div class="min-h-dvh bg-[var(--surface)]">
      <Navbar />
      <main>
        <RouterView />
      </main>
      <OnboardingGuide />
      <PWAUpdatePrompt />
    </div>
  </AppErrorBoundary>
</template>
