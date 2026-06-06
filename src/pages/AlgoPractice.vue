<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAlgoProblems } from '@/composables/useAlgoProblems'
import { DIFFICULTY_LABELS, type Difficulty } from '@/types'

const router = useRouter()
const { problems, modules, reload } = useAlgoProblems()

const selectedModules = ref<string[]>([])
const selectedDifficulties = ref<Difficulty[]>([])

const filteredIds = computed(() => {
  return problems.value
    .filter((p) => {
      if (selectedModules.value.length > 0 && !selectedModules.value.includes(p.module)) return false
      if (selectedDifficulties.value.length > 0 && !selectedDifficulties.value.includes(p.difficulty)) return false
      return true
    })
    .map((p) => p.id)
})

const stats = computed(() => {
  const byModule = new Map<string, { total: number; selected: number }>()
  for (const p of problems.value) {
    const m = byModule.get(p.module) || { total: 0, selected: 0 }
    m.total++
    if (
      (selectedModules.value.length === 0 || selectedModules.value.includes(p.module)) &&
      (selectedDifficulties.value.length === 0 || selectedDifficulties.value.includes(p.difficulty))
    ) {
      m.selected++
    }
    byModule.set(p.module, m)
  }
  return byModule
})

function toggleModule(m: string) {
  const idx = selectedModules.value.indexOf(m)
  if (idx >= 0) selectedModules.value.splice(idx, 1)
  else selectedModules.value.push(m)
}

function toggleDifficulty(d: Difficulty) {
  const idx = selectedDifficulties.value.indexOf(d)
  if (idx >= 0) selectedDifficulties.value.splice(idx, 1)
  else selectedDifficulties.value.push(d)
}

function startPractice() {
  if (filteredIds.value.length === 0) return
  const ids = filteredIds.value.join(',')
  router.push(`/algo/${filteredIds.value[0]}?session=${encodeURIComponent(ids)}`)
}

function clearFilters() {
  selectedModules.value = []
  selectedDifficulties.value = []
}

reload()
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">算法练习</h1>
      <button class="btn-ghost-sm" @click="$router.push('/algo')">返回列表</button>
    </div>

    <div class="filters-bar">
      <div style="font-size: 13px; font-weight: 600; margin-bottom: 8px">选择模块</div>
      <div style="display: flex; gap: 6px; flex-wrap: wrap">
        <button
          v-for="[m, s] in stats"
          :key="m"
          type="button"
          class="filter-chip"
          :class="{ active: selectedModules.includes(m) }"
          @click="toggleModule(m)"
        >
          {{ m }} ({{ s.selected }}/{{ s.total }})
        </button>
      </div>

      <div style="font-size: 13px; font-weight: 600; margin: 14px 0 8px">选择难度</div>
      <div style="display: flex; gap: 6px">
        <button
          v-for="d in [1, 2, 3] as Difficulty[]"
          :key="d"
          type="button"
          class="filter-chip"
          :class="{ active: selectedDifficulties.includes(d) }"
          @click="toggleDifficulty(d)"
          :style="
            selectedDifficulties.includes(d)
              ? {
                  background: ['rgba(16,185,129,0.1)', 'rgba(245,158,11,0.1)', 'rgba(239,68,68,0.1)'][d - 1],
                  color: ['#10b981', '#f59e0b', '#ef4444'][d - 1],
                  borderColor: ['rgba(16,185,129,0.2)', 'rgba(245,158,11,0.2)', 'rgba(239,68,68,0.2)'][d - 1],
                }
              : {}
          "
        >
          {{ DIFFICULTY_LABELS[d] }}
        </button>
      </div>

      <div v-if="selectedModules.length > 0 || selectedDifficulties.length > 0" style="margin-top: 10px">
        <button class="btn-ghost-sm" @click="clearFilters">清除筛选</button>
      </div>
    </div>

    <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 20px">
      <div style="font-size: 15px; font-weight: 600; color: var(--text)">
        共 {{ filteredIds.length }} 题
      </div>
      <button
        class="btn-primary-sm"
        :disabled="filteredIds.length === 0"
        @click="startPractice"
      >
        开始练习
      </button>
    </div>
  </div>
</template>

<style scoped>
.page-container {
  max-width: 720px;
  margin: 0 auto;
  padding: calc(var(--navbar-h) + 24px) 16px 24px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}

.filters-bar {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
}

.filter-chip {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.filter-chip.active {
  border-color: var(--primary);
  background: var(--primary-light);
  color: var(--primary);
}

.btn-primary-sm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border-radius: 8px;
  border: none;
  background: var(--primary);
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}

.btn-primary-sm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-ghost-sm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
</style>
