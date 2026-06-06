<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAlgoProblems } from '@/composables/useAlgoProblems'
import { DIFFICULTY_LABELS, DIFFICULTY_STYLES, type Difficulty, type Module } from '@/types'

const router = useRouter()

const selectedModules = ref<Module[]>([])
const selectedDifficulties = ref<Difficulty[]>([])
const searchQuery = ref('')
const sortKey = ref<'default' | 'difficulty-asc' | 'difficulty-desc' | 'module'>('default')

const { problems, loading, modules, reload } = useAlgoProblems(
  computed(() => ({
    modules: selectedModules.value,
    difficulties: selectedDifficulties.value,
    search: searchQuery.value,
    tags: [],
  })),
  sortKey,
)

const toggleModule = (m: Module) => {
  const idx = selectedModules.value.indexOf(m)
  if (idx >= 0) selectedModules.value.splice(idx, 1)
  else selectedModules.value.push(m)
}

const toggleDifficulty = (d: Difficulty) => {
  const idx = selectedDifficulties.value.indexOf(d)
  if (idx >= 0) selectedDifficulties.value.splice(idx, 1)
  else selectedDifficulties.value.push(d)
}

function clearFilters() {
  selectedModules.value = []
  selectedDifficulties.value = []
  searchQuery.value = ''
  sortKey.value = 'default'
}

function goToDetail(id: string) {
  router.push(`/algo/${id}`)
}

function goToManage() {
  router.push('/algo/manage')
}

function goToPractice() {
  router.push('/algo/practice')
}

const hasFilters = computed(
  () =>
    selectedModules.value.length > 0 ||
    selectedDifficulties.value.length > 0 ||
    searchQuery.value.trim().length > 0,
)
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <div style="display: flex; flex-direction: column; gap: 4px">
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
          <h1 class="page-title">算法刷题</h1>
          <span style="font-size: 13px; color: var(--text-3)">{{ problems.length }} 题</span>
        </div>
        <span style="font-size: 12px; color: var(--text-3)">为了练习 ACM 手撕代码模式</span>
      </div>
      <div style="display: flex; gap: 8px">
        <button class="btn-secondary-sm" @click="goToPractice">开始练习</button>
        <button class="btn-secondary-sm" @click="goToManage">管理题目</button>
      </div>
    </div>

    <!-- Filters -->
    <div class="filters-bar">
      <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索标题、描述、标签..."
          class="search-input"
          style="min-width: 200px"
        />

        <div style="display: flex; gap: 4px; flex-wrap: wrap">
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
                    background: DIFFICULTY_STYLES[d].background,
                    color: DIFFICULTY_STYLES[d].color,
                    borderColor: DIFFICULTY_STYLES[d].borderColor,
                  }
                : {}
            "
          >
            {{ DIFFICULTY_LABELS[d] }}
          </button>
        </div>

        <select v-model="sortKey" class="filter-select">
          <option value="default">默认排序</option>
          <option value="difficulty-asc">难度 ↑</option>
          <option value="difficulty-desc">难度 ↓</option>
          <option value="module">按模块</option>
        </select>

        <button v-if="hasFilters" type="button" class="btn-ghost-sm" @click="clearFilters">清除筛选</button>
      </div>

      <!-- Module chips -->
      <div v-if="modules.length > 0" style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px">
        <button
          v-for="m in modules"
          :key="m"
          type="button"
          class="filter-chip"
          :class="{ active: selectedModules.includes(m) }"
          @click="toggleModule(m)"
        >
          {{ m }}
        </button>
      </div>
    </div>

    <!-- Problem list -->
    <div v-if="loading" style="padding: 40px; text-align: center; color: var(--text-3)">加载中...</div>
    <div
      v-else-if="problems.length === 0"
      style="padding: 40px; text-align: center; color: var(--text-3)"
    >
      <div v-if="hasFilters">没有找到符合条件的题目</div>
      <div v-else>
        <div>暂无算法题</div>
        <button class="btn-primary-sm" style="margin-top: 12px" @click="goToManage">去导入题目</button>
      </div>
    </div>

    <div v-else class="problem-grid">
      <div
        v-for="p in problems"
        :key="p.id"
        class="problem-card"
        @click="goToDetail(p.id)"
      >
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px">
          <span
            class="difficulty-badge"
            :style="{
              background: DIFFICULTY_STYLES[p.difficulty].background,
              color: DIFFICULTY_STYLES[p.difficulty].color,
              borderColor: DIFFICULTY_STYLES[p.difficulty].borderColor,
            }"
          >
            {{ DIFFICULTY_LABELS[p.difficulty] }}
          </span>
          <span style="font-size: 12px; color: var(--text-3)">{{ p.module }}</span>
        </div>
        <h3 style="font-size: 15px; font-weight: 600; color: var(--text); margin: 0 0 6px">{{ p.title }}</h3>
        <p
          style="
            font-size: 13px;
            color: var(--text-2);
            margin: 0;
            line-height: 1.5;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
          "
        >
          {{ p.description.replace(/[#*_`]/g, '').slice(0, 120) }}
        </p>
        <div v-if="(p.tags || []).length > 0" style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px">
          <span v-for="tag in p.tags.slice(0, 3)" :key="tag" class="tag">{{ tag }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-container {
  max-width: 960px;
  margin: 0 auto;
  padding: calc(var(--navbar-h) + 24px) 16px 24px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
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
  padding: 14px 16px;
  margin-bottom: 20px;
}

.search-input {
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  outline: none;
  font-family: inherit;
}

.search-input:focus {
  border-color: var(--primary);
}

.filter-select {
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  outline: none;
}

.filter-chip {
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.filter-chip.active {
  border-color: var(--primary);
  background: var(--primary-light);
  color: var(--primary);
}

.problem-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.problem-card {
  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  transition: all 0.15s;
}

.problem-card:hover {
  border-color: var(--primary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.difficulty-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid;
}

.tag {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--surface-2);
  color: var(--text-3);
  border: 1px solid var(--border-subtle);
}

.btn-primary-sm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: var(--primary);
  color: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}

.btn-secondary-sm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
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
