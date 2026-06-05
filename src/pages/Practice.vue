<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useQuestions } from '@/composables/useQuestions'
import { type CategoryMap, DEFAULT_CATEGORY_MAP, getCategoryMap } from '@/lib/db'
import { createPracticeSessionPath } from '@/lib/practiceSession'
import { filterVisibleQuestions, getHiddenModules } from '@/lib/questionVisibility'
import { useStudyStore } from '@/stores/useStudyStore'
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_STYLES,
  type Difficulty,
  type Module,
  STATUS_LABELS,
  type StudyStatus,
} from '@/types'

const router = useRouter()
const route = useRoute()
const { allQuestions, initializing } = useQuestions()
const studyStore = useStudyStore()

const selectedModules = ref<Module[]>([])
const selectedDifficulty = ref<Difficulty | 'all'>('all')
const selectedStatus = ref<StudyStatus | 'all'>('all')
const isShuffled = ref(false)

// Handle preset from URL params (e.g. from daily recommendations)
const idsParam = computed(() => route.query.ids as string | undefined)
watch(
  idsParam,
  (ids) => {
    if (ids) {
      const idList = ids.split(',').filter(Boolean)
      if (idList.length > 0) {
        router.replace(`/questions/${idList[0]}?ids=${ids}`)
      }
    }
  },
  { immediate: true },
)

// Category map
const categoryMap = ref<CategoryMap>({ ...DEFAULT_CATEGORY_MAP })

onMounted(() => {
  getCategoryMap().then((m) => {
    categoryMap.value = m
  })
})

const hiddenModules = computed(() =>
  getHiddenModules(categoryMap.value, studyStore.hiddenCategories),
)
const visibleQuestions = computed(() =>
  filterVisibleQuestions(allQuestions.value, hiddenModules.value),
)

const activeModules = computed(() => {
  return [...new Set(visibleQuestions.value.map((q) => q.module))]
})

const moduleStats = computed(() => {
  return activeModules.value.map((mod) => {
    const qs = visibleQuestions.value.filter((q) => q.module === mod)
    const mastered = qs.filter((q) => studyStore.records[q.id]?.status === 'mastered').length
    return { module: mod, total: qs.length, mastered }
  })
})

const categoriesWithModules = computed(() => {
  const activeSet = new Set(activeModules.value)

  const fromMap = Object.values(categoryMap.value)
    .sort((a, b) => {
      if (a.builtin !== b.builtin) return a.builtin ? -1 : 1
      return (a.order ?? 0) - (b.order ?? 0)
    })
    .map((cat) => ({
      name: cat.name,
      builtin: cat.builtin,
      modules: cat.modules.filter((m) => activeSet.has(m)),
    }))
    .filter((cat) => cat.modules.length > 0)

  const assignedModules = new Set(fromMap.flatMap((c) => c.modules))
  const uncategorized = activeModules.value.filter((m) => !assignedModules.has(m))
  if (uncategorized.length > 0) {
    fromMap.push({ name: '其他', builtin: false, modules: uncategorized })
  }

  return fromMap
})

const difficultyStats = computed(() => {
  const base: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
  let filtered = visibleQuestions.value
  if (selectedModules.value.length > 0) {
    const set = new Set(selectedModules.value)
    filtered = filtered.filter((q) => set.has(q.module))
  }
  for (const q of filtered) base[q.difficulty]++
  return base
})

const filteredQuestions = computed(() => {
  let result = visibleQuestions.value

  if (selectedModules.value.length > 0) {
    const set = new Set(selectedModules.value)
    result = result.filter((q) => set.has(q.module))
  }

  if (selectedDifficulty.value !== 'all') {
    result = result.filter((q) => q.difficulty === selectedDifficulty.value)
  }

  if (selectedStatus.value !== 'all') {
    result = result.filter((q) => {
      const status = studyStore.records[q.id]?.status ?? 'unlearned'
      return status === selectedStatus.value
    })
  }

  return result
})

const statusCounts = computed(() => {
  let pool = visibleQuestions.value
  if (selectedModules.value.length > 0) {
    const set = new Set(selectedModules.value)
    pool = pool.filter((q) => set.has(q.module))
  }
  if (selectedDifficulty.value !== 'all') {
    pool = pool.filter((q) => q.difficulty === selectedDifficulty.value)
  }
  const counts: Record<string, number> = { all: pool.length, unlearned: 0, mastered: 0, review: 0 }
  for (const q of pool) {
    const s = studyStore.records[q.id]?.status ?? 'unlearned'
    counts[s]++
  }
  return counts
})

function toggleModule(mod: Module) {
  const prev = selectedModules.value
  selectedModules.value = prev.includes(mod)
    ? prev.filter((m) => m !== mod)
    : [...prev, mod]
}

function toggleCategory(catModules: Module[]) {
  const prev = selectedModules.value
  const allSelected = catModules.every((m) => prev.includes(m))
  if (allSelected) {
    selectedModules.value = prev.filter((m) => !catModules.includes(m))
  } else {
    const toAdd = catModules.filter((m) => !prev.includes(m))
    selectedModules.value = [...prev, ...toAdd]
  }
}

// Clean up selected modules when active modules change
watch(activeModules, (mods) => {
  const activeSet = new Set(mods)
  selectedModules.value = selectedModules.value.filter((m) => activeSet.has(m))
})

function handleStart() {
  if (filteredQuestions.value.length === 0) return

  const ids = filteredQuestions.value.map((q) => q.id)

  if (isShuffled.value) {
    // Fisher-Yates shuffle
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
    }
  }

  router.push(createPracticeSessionPath(ids[0], ids))
}

const noQuestions = computed(() => allQuestions.value.length === 0)
const allHidden = computed(
  () => allQuestions.value.length > 0 && visibleQuestions.value.length === 0,
)
</script>

<template>
  <div class="page-container">
    <!-- Loading skeleton -->
    <template v-if="initializing">
      <div
        class="skeleton"
        style="width:160px;height:26px;border-radius:8px;margin-bottom:24px;"
        :style="{
          background: 'var(--surface-3)',
          animation: 'skeleton-pulse 1.6s var(--ease-in-out) infinite',
        }"
      />
      <div
        style="
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
        "
      >
        <div
          v-for="i in 8"
          :key="i"
          class="card"
          style="padding: 14px; display: flex; flex-direction: column; gap: 10px"
        >
          <div
            class="skeleton"
            style="width:65%;height:13px;border-radius:4px;"
            :style="{
              background: 'var(--surface-3)',
              animation: 'skeleton-pulse 1.6s var(--ease-in-out) infinite',
            }"
          />
          <div
            class="skeleton"
            style="width:45%;height:11px;border-radius:4px;"
            :style="{
              background: 'var(--surface-3)',
              animation: 'skeleton-pulse 1.6s var(--ease-in-out) infinite',
            }"
          />
          <div
            class="skeleton"
            style="width:100%;height:3px;border-radius:99px;"
            :style="{
              background: 'var(--surface-3)',
              animation: 'skeleton-pulse 1.6s var(--ease-in-out) infinite',
            }"
          />
        </div>
      </div>
    </template>

    <!-- Header -->
    <template v-else>
      <div class="animate-fade-in" style="margin-bottom: 28px">
        <h1
          style="
            font-size: 20px;
            font-weight: 700;
            color: var(--text);
            letter-spacing: -0.015em;
            margin-bottom: 4px;
          "
        >
          专项练习
        </h1>
        <p style="font-size: 13px; color: var(--text-3)">
          自由组合模块、难度和状态，开启专注刷题模式
        </p>
      </div>

      <!-- Empty states -->
      <div v-if="noQuestions" class="card" style="padding: 80px 20px">
        <div style="text-align: center">
          <p style="font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 6px">
            题库为空
          </p>
          <p style="font-size: 13px; color: var(--text-3); margin-bottom: 20px">
            请先前往「导入题目」页面加载题库
          </p>
          <button
            type="button"
            class="btn btn-primary"
            @click="router.push('/import')"
          >
            前往导入
          </button>
        </div>
      </div>

      <div v-else-if="allHidden" class="card" style="padding: 80px 20px">
        <div style="text-align: center">
          <p style="font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 6px">
            所有题库已关闭展示
          </p>
          <p style="font-size: 13px; color: var(--text-3)">
            在「设置 → 刷题偏好 → 题库展示」中启用题库后，可重新选择模块练习
          </p>
        </div>
      </div>

      <!-- Main content -->
      <template v-else>
        <div
          style="display: grid; grid-template-columns: 1fr 260px; gap: 20px; min-width: 0"
          class="practice-grid"
        >
          <!-- Left: Config -->
          <div
            style="
              display: flex;
              flex-direction: column;
              gap: 28px;
              min-width: 0;
              overflow: hidden;
            "
          >
            <!-- Difficulty Selection -->
            <div class="animate-fade-in">
              <p
                style="
                  font-size: 11px;
                  font-weight: 600;
                  color: var(--text-3);
                  text-transform: uppercase;
                  letter-spacing: 0.06em;
                  margin-bottom: 10px;
                "
              >
                难度
              </p>
              <div style="display: flex; flex-wrap: wrap; gap: 8px">
                <!-- All difficulty -->
                <button
                  type="button"
                  @click="selectedDifficulty = 'all'"
                  :style="{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    borderRadius: '10px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    border: '1px solid',
                    borderColor: selectedDifficulty === 'all' ? 'var(--primary)' : 'var(--border)',
                    background: selectedDifficulty === 'all' ? 'var(--primary)' : 'var(--surface)',
                    color: selectedDifficulty === 'all' ? 'white' : 'var(--text-2)',
                  }"
                >
                  全部
                  <span
                    :style="{
                      fontSize: '11px',
                      padding: '1px 6px',
                      borderRadius: '6px',
                      background: selectedDifficulty === 'all' ? 'rgba(255,255,255,0.2)' : 'var(--surface-2)',
                      color: selectedDifficulty === 'all' ? 'currentColor' : 'var(--text-3)',
                    }"
                  >
                    {{ selectedModules.length > 0
                      ? visibleQuestions.filter(q => selectedModules.includes(q.module)).length
                      : visibleQuestions.length }}
                  </span>
                </button>
                <!-- Per difficulty -->
                <button
                  v-for="d in ([1, 2, 3] as Difficulty[])"
                  :key="d"
                  type="button"
                  @click="selectedDifficulty = d"
                  :style="{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    borderRadius: '10px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    border: '1px solid',
                    borderColor: selectedDifficulty === d
                      ? DIFFICULTY_STYLES[d].borderColor
                      : 'var(--border)',
                    background: selectedDifficulty === d
                      ? DIFFICULTY_STYLES[d].background
                      : 'var(--surface)',
                    color: selectedDifficulty === d
                      ? DIFFICULTY_STYLES[d].color
                      : 'var(--text-2)',
                  }"
                >
                  {{ DIFFICULTY_LABELS[d] }}
                  <span
                    :style="{
                      fontSize: '11px',
                      padding: '1px 6px',
                      borderRadius: '6px',
                      background: selectedDifficulty === d ? 'rgba(255,255,255,0.2)' : 'var(--surface-2)',
                      color: selectedDifficulty === d ? 'currentColor' : 'var(--text-3)',
                    }"
                  >{{ difficultyStats[d] }}</span>
                </button>
              </div>
            </div>

            <!-- Status Filter -->
            <div class="animate-fade-in stagger-1">
              <p
                style="
                  font-size: 11px;
                  font-weight: 600;
                  color: var(--text-3);
                  text-transform: uppercase;
                  letter-spacing: 0.06em;
                  margin-bottom: 10px;
                "
              >
                学习状态
              </p>
              <div style="display: flex; flex-wrap: wrap; gap: 8px">
                <button
                  v-for="s in (['all', 'unlearned', 'review', 'mastered'] as const)"
                  :key="s"
                  type="button"
                  @click="selectedStatus = s"
                  :style="{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    border: '1px solid',
                    borderColor: selectedStatus === s
                      ? { all: 'var(--primary)', unlearned: '#71717a', mastered: '#10b981', review: '#f59e0b' }[s]
                      : 'var(--border)',
                    background: selectedStatus === s
                      ? { all: 'var(--primary)', unlearned: '#71717a', mastered: '#10b981', review: '#f59e0b' }[s]
                      : 'var(--surface)',
                    color: selectedStatus === s ? 'white' : 'var(--text-2)',
                  }"
                >
                  {{ s === 'all' ? '全部状态' : STATUS_LABELS[s] }}
                  <span
                    :style="{
                      fontSize: '10px',
                      padding: '1px 5px',
                      borderRadius: '5px',
                      background: selectedStatus === s ? 'rgba(255,255,255,0.2)' : 'var(--surface-2)',
                      color: selectedStatus === s ? 'white' : 'var(--text-3)',
                    }"
                  >{{ statusCounts[s] }}</span>
                </button>
              </div>
            </div>

            <!-- Module Selection — grouped by category -->
            <div class="animate-fade-in stagger-2">
              <div
                style="
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  margin-bottom: 16px;
                "
              >
                <p
                  style="
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--text-3);
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                  "
                >
                  选择模块
                </p>
                <button
                  v-if="selectedModules.length > 0"
                  type="button"
                  @click="selectedModules = []"
                  style="
                    font-size: 12px;
                    color: var(--primary);
                    background: none;
                    border: none;
                    cursor: pointer;
                    padding: 0;
                  "
                >
                  清除选择
                </button>
              </div>

              <!-- Render one section per category -->
              <div style="display: flex; flex-direction: column; gap: 20px">
                <div v-for="cat in categoriesWithModules" :key="cat.name">
                  <!-- Category header -->
                  <div
                    style="
                      display: flex;
                      align-items: center;
                      gap: 8px;
                      margin-bottom: 10px;
                    "
                  >
                    <button
                      type="button"
                      @click="toggleCategory(cat.modules)"
                      :title="cat.modules.every(m => selectedModules.includes(m)) ? '取消全选此分类' : '全选此分类'"
                      style="
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        background: none;
                        border: none;
                        cursor: pointer;
                        padding: 0;
                      "
                    >
                      <!-- Mini checkbox -->
                      <span
                        :style="{
                          width: '14px',
                          height: '14px',
                          borderRadius: '4px',
                          border: cat.modules.every(m => selectedModules.includes(m))
                            ? '1.5px solid var(--primary)'
                            : cat.modules.some(m => selectedModules.includes(m))
                              ? '1.5px solid var(--primary)'
                              : '1.5px solid var(--border)',
                          background: cat.modules.every(m => selectedModules.includes(m))
                            ? 'var(--primary)'
                            : cat.modules.some(m => selectedModules.includes(m))
                              ? 'var(--primary-light)'
                              : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'all 0.15s',
                        }"
                      >
                        <svg
                          v-if="cat.modules.every(m => selectedModules.includes(m))"
                          width="8" height="8" viewBox="0 0 24 24"
                          fill="none" stroke="white" stroke-width="3.5"
                          stroke-linecap="round" stroke-linejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <svg
                          v-else-if="cat.modules.some(m => selectedModules.includes(m))"
                          width="8" height="8" viewBox="0 0 24 24"
                          fill="none" stroke="var(--primary)" stroke-width="3.5"
                          stroke-linecap="round" stroke-linejoin="round"
                        >
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </span>
                      <span
                        :style="{
                          fontSize: '12px',
                          fontWeight: 700,
                          color: cat.modules.some(m => selectedModules.includes(m))
                            ? 'var(--primary)'
                            : 'var(--text-2)',
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          transition: 'color 0.15s',
                        }"
                      >
                        {{ cat.name }}
                      </span>
                    </button>
                    <span
                      v-if="!cat.builtin"
                      style="
                        font-size: 10px;
                        font-weight: 500;
                        color: var(--text-3);
                        background: var(--surface-3);
                        border: 1px solid var(--border-subtle);
                        border-radius: 4px;
                        padding: 1px 5px;
                      "
                    >自定义</span>
                    <span style="font-size: 11px; color: var(--text-3)">
                      {{ cat.modules.length }} 个模块 ·
                      {{ cat.modules.reduce((sum, m) => sum + (moduleStats.find(s => s.module === m)?.total ?? 0), 0) }} 道题
                    </span>
                  </div>

                  <!-- Module cards -->
                  <div
                    style="
                      display: grid;
                      grid-template-columns: repeat(4, 1fr);
                      gap: 8px;
                    "
                    class="modules-grid"
                  >
                    <button
                      v-for="mod in cat.modules"
                      :key="mod"
                      type="button"
                      @click="toggleModule(mod)"
                      :style="{
                        position: 'relative',
                        padding: '14px',
                        borderRadius: '14px',
                        border: selectedModules.includes(mod)
                          ? '1px solid rgba(var(--primary-rgb), 0.5)'
                          : '1px solid var(--border-subtle)',
                        background: selectedModules.includes(mod) ? 'var(--primary-light)' : 'var(--surface)',
                        textAlign: 'left',
                        transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
                        cursor: 'pointer',
                        boxShadow: selectedModules.includes(mod) ? 'none' : 'var(--shadow-xs)',
                      }"
                    >
                      <!-- Check indicator -->
                      <div
                        v-if="selectedModules.includes(mod)"
                        style="
                          position: absolute;
                          top: 10px;
                          right: 10px;
                          width: 18px;
                          height: 18px;
                          border-radius: 50%;
                          background: var(--primary);
                          display: flex;
                          align-items: center;
                          justify-content: center;
                        "
                      >
                        <svg
                          width="9" height="9" viewBox="0 0 24 24"
                          fill="none" stroke="white" stroke-width="3"
                          stroke-linecap="round" stroke-linejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>

                      <p
                        :style="{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: selectedModules.includes(mod) ? 'var(--primary)' : 'var(--text)',
                          marginBottom: '4px',
                          marginTop: '2px',
                        }"
                      >{{ mod }}</p>

                      <p style="font-size: 11px; color: var(--text-3); margin-bottom: 10px">
                        {{ (moduleStats.find(s => s.module === mod)?.total ?? 0) }} 道题
                      </p>

                      <!-- Progress bar -->
                      <div
                        style="
                          height: 3px;
                          background: var(--surface-3);
                          border-radius: 99px;
                          overflow: hidden;
                        "
                      >
                        <div
                          :style="{
                            height: '100%',
                            background: 'var(--success)',
                            borderRadius: '99px',
                            width: `${(moduleStats.find(s => s.module === mod)?.total ?? 0) > 0
                              ? Math.round(((moduleStats.find(s => s.module === mod)?.mastered ?? 0) / (moduleStats.find(s => s.module === mod)?.total ?? 1)) * 100)
                              : 0}%`,
                            transition: 'width 0.5s var(--ease-out)',
                          }"
                        />
                      </div>
                      <p
                        style="
                          font-size: 10px;
                          color: var(--text-3);
                          margin-top: 5px;
                          font-variant-numeric: tabular-nums;
                        "
                      >
                        {{ moduleStats.find(s => s.module === mod)?.mastered ?? 0 }}/{{
                          moduleStats.find(s => s.module === mod)?.total ?? 0
                        }} 已掌握
                      </p>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Right: Session Preview -->
          <div
            class="animate-fade-in stagger-2 practice-session-preview"
            style="
              position: sticky;
              top: calc(var(--navbar-h) + 20px);
              align-self: flex-start;
              min-width: 0;
            "
          >
            <!-- Session Preview Card -->
            <div
              class="card animate-scale-in"
              style="padding: 20px; display: flex; flex-direction: column; gap: 16px"
            >
              <!-- Title -->
              <div
                style="
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                "
              >
                <h3 style="font-size: 14px; font-weight: 600; color: var(--text)">练习配置</h3>
                <span
                  :style="{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: filteredQuestions.length > 0 ? 'var(--primary)' : 'var(--text-3)',
                    fontVariantNumeric: 'tabular-nums',
                  }"
                >{{ filteredQuestions.length }} 道题</span>
              </div>

              <!-- Config summary -->
              <div style="display: flex; flex-direction: column">
                <div
                  v-for="(row, i, arr) in [
                    {
                      label: '难度',
                      value: selectedDifficulty === 'all' ? '全部难度' : DIFFICULTY_LABELS[selectedDifficulty],
                    },
                    {
                      label: '状态',
                      value: selectedStatus === 'all' ? '全部状态' : STATUS_LABELS[selectedStatus],
                    },
                    {
                      label: '模块',
                      value: selectedModules.length === 0
                        ? '全部模块'
                        : selectedModules.length === 1
                          ? selectedModules[0]
                          : `${selectedModules.length} 个模块`,
                    },
                  ]"
                  :key="row.label"
                  :style="{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 0',
                    borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  }"
                >
                  <span style="font-size: 13px; color: var(--text-3)">{{ row.label }}</span>
                  <span
                    style="
                      font-size: 13px;
                      font-weight: 500;
                      color: var(--text);
                      max-width: 180px;
                      overflow: hidden;
                      text-overflow: ellipsis;
                      white-space: nowrap;
                    "
                  >{{ row.value }}</span>
                </div>
              </div>

              <!-- Shuffle toggle -->
              <button
                type="button"
                @click="isShuffled = !isShuffled"
                :style="{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: '1px solid',
                  borderColor: isShuffled ? 'rgba(var(--primary-rgb), 0.3)' : 'var(--border-subtle)',
                  background: isShuffled ? 'var(--primary-light)' : 'transparent',
                  color: isShuffled ? 'var(--primary)' : 'var(--text-2)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  transition: 'all 0.15s',
                }"
              >
                <div style="display: flex; align-items: center; gap: 8px">
                  <svg
                    width="13" height="13" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round"
                  >
                    <polyline points="16 3 21 3 21 8" />
                    <line x1="4" y1="20" x2="21" y2="3" />
                    <polyline points="21 16 21 21 16 21" />
                    <line x1="15" y1="15" x2="21" y2="21" />
                  </svg>
                  随机顺序
                </div>
                <!-- Toggle track -->
                <div
                  :style="{
                    width: '30px',
                    height: '18px',
                    borderRadius: '99px',
                    background: isShuffled ? 'var(--primary)' : 'var(--border)',
                    position: 'relative',
                    transition: 'background 0.2s',
                    flexShrink: 0,
                  }"
                >
                  <div
                    :style="{
                      position: 'absolute',
                      top: '2px',
                      left: isShuffled ? 'calc(100% - 16px)' : '2px',
                      width: '14px',
                      height: '14px',
                      borderRadius: '50%',
                      background: 'white',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      transition: 'left 0.2s var(--ease-out)',
                    }"
                  />
                </div>
              </button>

              <!-- Start button or empty message -->
              <p
                v-if="filteredQuestions.length === 0"
                style="
                  text-align: center;
                  font-size: 13px;
                  color: var(--text-3);
                  padding: 6px 0;
                "
              >
                没有符合条件的题目
              </p>
              <button
                v-else
                type="button"
                @click="handleStart"
                :style="{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '10px 20px',
                  height: '44px',
                  borderRadius: '12px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  background: 'var(--primary)',
                  color: 'white',
                  boxShadow: 'var(--shadow-md)',
                  transition: 'background 0.15s',
                }"
              >
                <svg
                  width="15" height="15" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round"
                >
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                开始练习 {{ filteredQuestions.length }} 道题
              </button>
            </div>

            <!-- Question preview list -->
            <div v-if="filteredQuestions.length > 0" style="margin-top: 16px">
              <p
                style="
                  font-size: 11px;
                  color: var(--text-3);
                  margin-bottom: 8px;
                  padding-left: 2px;
                "
              >
                前 5 题预览
              </p>
              <div style="display: flex; flex-direction: column; gap: 4px">
                <div
                  v-for="(q, i) in filteredQuestions.slice(0, 5)"
                  :key="q.id"
                  class="animate-fade-in"
                  :style="{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '7px 10px',
                    borderRadius: '8px',
                    background: 'var(--surface-2)',
                    animationDelay: `${i * 0.05}s`,
                  }"
                >
                  <span
                    :style="{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      flexShrink: 0,
                      background:
                        (studyStore.records[q.id]?.status ?? 'unlearned') === 'mastered'
                          ? 'var(--success)'
                          : (studyStore.records[q.id]?.status ?? 'unlearned') === 'review'
                            ? 'var(--warning)'
                            : 'var(--border)',
                    }"
                  />
                  <span
                    style="
                      font-size: 12px;
                      color: var(--text-2);
                      flex: 1;
                      min-width: 0;
                      overflow: hidden;
                      text-overflow: ellipsis;
                      white-space: nowrap;
                    "
                  >{{ q.question }}</span>
                </div>
                <p
                  v-if="filteredQuestions.length > 5"
                  style="
                    text-align: center;
                    font-size: 11px;
                    color: var(--text-3);
                    padding-top: 4px;
                  "
                >
                  还有 {{ filteredQuestions.length - 5 }} 道
                </p>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- Mobile FAB (hidden above 1023px, shown below) -->
    <button
      v-if="filteredQuestions.length > 0"
      type="button"
      @click="handleStart"
      class="practice-start-fab"
      :aria-label="`开始练习 ${filteredQuestions.length} 道题`"
      :title="`开始练习 ${filteredQuestions.length} 道题`"
      style="
        position: fixed;
        bottom: 24px;
        right: 20px;
        z-index: 140;
        width: 52px;
        height: 52px;
        border-radius: 50%;
        border: none;
        background: var(--surface-3);
        color: var(--text-3);
        box-shadow: var(--shadow-md);
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
      "
    >
      <svg
        width="22" height="22" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round"
      >
        <polygon points="6 3 20 12 6 21 6 3" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/* Button inline styles */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, box-shadow 0.15s;
  border: none;
}
.btn-primary {
  background: var(--primary);
  color: white;
  box-shadow: var(--shadow-md);
  font-size: 14px;
  height: 44px;
  padding: 10px 20px;
}

/* Responsive */
.practice-start-fab {
  display: none !important;
}
@media (max-width: 1023px) {
  .practice-start-fab {
    display: flex !important;
  }
}
@media (max-width: 900px) {
  .practice-grid {
    grid-template-columns: 1fr !important;
  }
  .modules-grid {
    grid-template-columns: repeat(3, 1fr) !important;
  }
  .practice-session-preview {
    position: static !important;
    align-self: auto !important;
  }
}
@media (max-width: 640px) {
  .modules-grid {
    grid-template-columns: repeat(2, 1fr) !important;
  }
  .practice-session-preview {
    position: static !important;
  }
}
@media (max-width: 480px) {
  .modules-grid {
    grid-template-columns: repeat(2, 1fr) !important;
  }
}
</style>
