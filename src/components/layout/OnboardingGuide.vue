<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { getBuiltinCategories, type BuiltinCategory } from '@/lib/db'

const router = useRouter()

const visible = ref(false)
const step = ref(0)
const builtinCategories = ref<BuiltinCategory[]>([])

onMounted(async () => {
  builtinCategories.value = await getBuiltinCategories()
})

const steps = [
  { id: 'welcome', label: '欢迎' },
  { id: 'banks', label: '题库' },
  { id: 'workflow', label: '开始' },
]

function next() {
  if (step.value < steps.length - 1) {
    step.value++
  } else {
    done()
  }
}

function done() {
  visible.value = false
  try {
    localStorage.setItem(ONBOARDING_DONE_KEY, '1')
  } catch {}
}

function goToQuestions() {
  done()
  router.push('/questions')
}

function goToPractice() {
  done()
  router.push('/practice')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div class="bg-[var(--surface)] rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
          <!-- Header -->
          <div class="flex items-center justify-between p-4 border-b border-[var(--border)]">
            <div class="flex gap-2">
              <div
                v-for="(s, i) in steps"
                :key="s.id"
                class="h-1 rounded-full transition-all duration-300"
                :class="i <= step ? 'bg-[var(--primary)] w-8' : 'bg-[var(--surface-2)] w-4'"
              />
            </div>
            <button class="text-[var(--text-3)] hover:text-[var(--text)]" @click="done">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <!-- Content -->
          <div class="p-6">
            <!-- Step 0: Welcome -->
            <div v-if="step === 0" class="text-center">
              <div class="text-5xl mb-4">📝</div>
              <h2 class="text-2xl font-bold mb-2">欢迎使用 GrimoireFace</h2>
              <p class="text-[var(--text-2)] mb-6">面试刷题助手，帮你高效备战技术面试</p>
              <div class="grid gap-3 text-left text-sm">
                <div class="flex items-start gap-3 p-3 rounded-lg bg-[var(--surface-2)]">
                  <span>📚</span>
                  <div><span class="font-medium">覆盖全面</span> — JS、Golang、Java、AI Agent 等核心模块</div>
                </div>
                <div class="flex items-start gap-3 p-3 rounded-lg bg-[var(--surface-2)]">
                  <span>🤖</span>
                  <div><span class="font-medium">AI 教练</span> — 智能分析考点、优化答案、模拟面试</div>
                </div>
                <div class="flex items-start gap-3 p-3 rounded-lg bg-[var(--surface-2)]">
                  <span>📊</span>
                  <div><span class="font-medium">学习追踪</span> — 掌握进度、薄弱点分析、每日推荐</div>
                </div>
              </div>
            </div>

            <!-- Step 1: Banks -->
            <div v-else-if="step === 1">
              <h2 class="text-xl font-bold mb-2">内置题库</h2>
              <p class="text-sm text-[var(--text-2)] mb-4">选择你感兴趣的题库分类</p>
              <div class="grid grid-cols-2 gap-3">
                <div
                  v-for="cat in builtinCategories"
                  :key="cat.category"
                  class="p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]"
                >
                  <div class="font-medium text-sm">{{ cat.category }}</div>
                  <div class="text-xs text-[var(--text-3)] mt-1">{{ cat.files.length }} 个模块</div>
                </div>
              </div>
            </div>

            <!-- Step 2: Workflow -->
            <div v-else class="text-center">
              <div class="text-4xl mb-4">🚀</div>
              <h2 class="text-xl font-bold mb-2">准备就绪</h2>
              <p class="text-sm text-[var(--text-2)] mb-6">选择一种方式开始你的学习之旅</p>
              <div class="grid gap-3">
                <button
                  class="w-full p-4 rounded-xl bg-[var(--primary)] text-white font-medium text-left flex items-center gap-3"
                  @click="goToQuestions"
                >
                  <span class="text-2xl">📚</span>
                  <div>
                    <div>浏览题库</div>
                    <div class="text-sm opacity-80">按分类查看所有题目</div>
                  </div>
                </button>
                <button
                  class="w-full p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] font-medium text-left flex items-center gap-3"
                  @click="goToPractice"
                >
                  <span class="text-2xl">✏️</span>
                  <div>
                    <div>开始练习</div>
                    <div class="text-sm text-[var(--text-2)]">系统推荐的每日练习</div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div v-if="step < 2" class="p-4 border-t border-[var(--border)] flex justify-between">
            <button
              v-if="step > 0"
              class="px-4 py-2 text-sm text-[var(--text-2)] hover:text-[var(--text)]"
              @click="step--"
            >
              上一步
            </button>
            <div v-else />
            <button
              class="px-6 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-medium"
              @click="next"
            >
              {{ step === steps.length - 2 ? '开始使用' : '下一步' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
