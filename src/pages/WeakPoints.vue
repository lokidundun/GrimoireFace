<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useStudyStore } from '@/stores/useStudyStore'
import { useQuestions } from '@/composables/useQuestions'
import { createPracticeSessionPath, getInlinePracticeSearch } from '@/lib/practiceSession'
import { DIFFICULTY_LABELS, DIFFICULTY_COLORS, type Module } from '@/types'

const router = useRouter()
const { allQuestions, initializing } = useQuestions()
const studyStore = useStudyStore()

const selectedModule = ref<Module | null>(null)
type SortMode = 'oldest' | 'newest' | 'most-reviewed' | 'difficulty'
const sortMode = ref<SortMode>('oldest')
const clearing = ref(false)

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'oldest', label: '最久未复习' },
  { value: 'newest', label: '最近标记' },
  { value: 'most-reviewed', label: '复习次数最多' },
  { value: 'difficulty', label: '难度从高到低' },
]

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days < 30) return `${days} 天前`
  return `${Math.floor(days / 30)} 个月前`
}

const weakRecords = computed(() =>
  Object.values(studyStore.records).filter((r) => r.status === 'review'),
)

const weakItems = computed(() => {
  const questionMap = new Map(allQuestions.value.map((q) => [q.id, q]))
  return weakRecords.value
    .map((r) => {
      const q = questionMap.get(r.questionId)
      if (!q) return null
      return { record: r, question: q }
    })
    .filter(Boolean) as { record: (typeof weakRecords.value)[0]; question: (typeof allQuestions.value)[0] }[]
})

const weakByModule = computed(() => {
  const counts = {} as Record<string, number>
  for (const { question } of weakItems.value) {
    counts[question.module] = (counts[question.module] ?? 0) + 1
  }
  return counts
})

const stats = computed(() => {
  if (weakItems.value.length === 0) return { total: 0, avgReviewCount: 0, oldest: null as number | null }
  const total = weakItems.value.length
  const avgReviewCount = weakItems.value.reduce((s, { record: r }) => s + r.reviewCount, 0) / total
  const oldest = Math.min(...weakItems.value.map(({ record: r }) => r.lastUpdated))
  return { total, avgReviewCount, oldest }
})

const displayItems = computed(() => {
  let items = weakItems.value
  if (selectedModule.value) {
    items = items.filter(({ question: q }) => q.module === selectedModule.value)
  }
  const sorted = [...items]
  switch (sortMode.value) {
    case 'oldest':
      sorted.sort((a, b) => a.record.lastUpdated - b.record.lastUpdated)
      break
    case 'newest':
      sorted.sort((a, b) => b.record.lastUpdated - a.record.lastUpdated)
      break
    case 'most-reviewed':
      sorted.sort((a, b) => b.record.reviewCount - a.record.reviewCount)
      break
    case 'difficulty':
      sorted.sort((a, b) => b.question.difficulty - a.question.difficulty)
      break
  }
  return sorted
})

const sessionIds = computed(() => displayItems.value.map(({ question: q }) => q.id))

const moduleList = computed(() => {
  const allModules = [...new Set(allQuestions.value.map((q) => q.module))]
  return allModules.filter((m) => (weakByModule.value[m] ?? 0) > 0)
})

watch(selectedModule, () => {})

function handleStartSession() {
  const ids = sessionIds.value
  if (ids.length === 0) return
  router.push(createPracticeSessionPath(ids[0], ids))
}

async function handleMarkAllMastered() {
  if (displayItems.value.length === 0) return
  clearing.value = true
  for (const { question: q } of displayItems.value) {
    await studyStore.setStatus(q.id, 'mastered')
  }
  clearing.value = false
}
</script>

<template>
  <div
    class="page-container"
    :style="{ maxWidth: '760px', display: 'flex', flexDirection: 'column', gap: '24px' }"
  >
    <!-- Skeleton -->
    <template v-if="initializing">
      <div style="display: flex; flex-direction: column; gap: 20px">
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px">
          <div
            v-for="key in 3"
            :key="'ws-' + key"
            class="card"
            style="padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 8px"
          >
            <div class="skeleton" style="width: 40px; height: 24px; border-radius: 6px" />
            <div class="skeleton" style="width: 60px; height: 11px" />
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px">
          <div
            v-for="key in 6"
            :key="'wl-' + key"
            class="card"
            style="padding: 14px 16px; display: flex; align-items: flex-start; gap: 14px"
          >
            <div class="skeleton" style="width: 26px; height: 26px; border-radius: 8px" />
            <div class="skeleton" style="width: 3px; height: 52px; border-radius: 2px" />
            <div style="flex: 1; display: flex; flex-direction: column; gap: 8px">
              <div class="skeleton" style="width: 75%; height: 14px" />
              <div class="skeleton" style="width: 45%; height: 12px" />
            </div>
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 5px">
              <div class="skeleton" style="width: 52px; height: 20px; border-radius: 6px" />
              <div class="skeleton" style="width: 48px; height: 11px" />
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <!-- Header -->
      <div class="animate-fade-in" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px">
        <div>
          <h1 style="font-size: 20px; font-weight: 700; color: var(--text); letter-spacing: -0.015em; margin-bottom: 4px">
            我的薄弱点
          </h1>
          <p style="font-size: 13px; color: var(--text-3)">
            标记为「待复习」的题目，优先复习最久未练的
          </p>
        </div>

        <button
          v-if="weakItems.length > 0 && sessionIds.length > 0"
          type="button"
          class="btn btn-primary btn-sm"
          style="flex-shrink: 0"
          @click="handleStartSession"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          集中攻克
        </button>
      </div>

      <!-- Empty state -->
      <div v-if="weakItems.length === 0" class="card animate-fade-in" style="padding: 80px 20px; text-align: center">
        <p style="font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 6px">暂无待复习题目</p>
        <p style="font-size: 13px; color: var(--text-3); margin-bottom: 20px">
          做得很好！所有题目都已掌握，或者还没有开始刷题
        </p>
        <RouterLink to="/questions" class="no-underline">
          <button class="btn btn-primary btn-sm">去刷题</button>
        </RouterLink>
      </div>

      <template v-else>
        <!-- Stats -->
        <div class="animate-fade-in stagger-1" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px">
          <div class="card" style="padding: 16px; text-align: center">
            <p style="font-size: 22px; font-weight: 700; color: var(--warning); font-variant-numeric: tabular-nums; line-height: 1.2; margin-bottom: 4px">
              {{ stats.total }}
            </p>
            <p style="font-size: 11px; color: var(--text-3)">待复习题目</p>
          </div>
          <div class="card" style="padding: 16px; text-align: center">
            <p style="font-size: 22px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; line-height: 1.2; margin-bottom: 4px">
              {{ stats.avgReviewCount.toFixed(1) }}
            </p>
            <p style="font-size: 11px; color: var(--text-3)">平均复习次数</p>
          </div>
          <div class="card" style="padding: 16px; text-align: center">
            <p style="font-size: 15px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; line-height: 1.2; margin-bottom: 4px">
              {{ stats.oldest ? timeAgo(stats.oldest) : '—' }}
            </p>
            <p style="font-size: 11px; color: var(--text-3)">最久未复习</p>
          </div>
        </div>

        <!-- Module breakdown -->
        <div v-if="moduleList.length > 0" class="animate-fade-in stagger-2" style="display: flex; flex-wrap: wrap; gap: 6px">
          <!-- All button -->
          <button
            type="button"
            @click="selectedModule = null"
            :style="{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 12px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 500,
              border: '1px solid',
              borderColor: selectedModule === null ? 'var(--primary)' : 'var(--border)',
              background: selectedModule === null ? 'var(--primary)' : 'var(--surface)',
              color: selectedModule === null ? 'white' : 'var(--text-2)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }"
          >
            全部
            <span style="font-size: 10px; padding: '1px 5px'; borderRadius: '4px'; background: selectedModule === null ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0)'">
              {{ stats.total }}
            </span>
          </button>

          <button
            v-for="mod in moduleList"
            :key="mod"
            type="button"
            @click="selectedModule = selectedModule === mod ? null : mod"
            :style="{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 12px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 500,
              border: '1px solid',
              borderColor: selectedModule === mod ? 'var(--warning)' : 'var(--border)',
              background: selectedModule === mod ? 'var(--warning)' : 'var(--surface)',
              color: selectedModule === mod ? 'white' : 'var(--text-2)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }"
          >
            {{ mod }}
            <span
              :style="{
                fontSize: '10px',
                padding: '1px 5px',
                borderRadius: '4px',
                background: selectedModule === mod ? 'rgba(255,255,255,0.25)' : 'var(--surface-2)',
                color: selectedModule === mod ? 'white' : 'var(--text-3)',
              }"
            >{{ weakByModule[mod] }}</span>
          </button>
        </div>

        <!-- Controls -->
        <div class="animate-fade-in stagger-3" style="display: flex; align-items: center; justify-content: space-between; gap: 12px">
          <div style="display: flex; align-items: center; gap: 10px">
            <select
              v-model="sortMode"
              style="font-size: var(--control-font-size); padding: 6px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); color: var(--text); cursor: pointer; outline: none"
            >
              <option v-for="o in SORT_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <span style="font-size: 12px; color: var(--text-3)">{{ displayItems.length }} 道题</span>
          </div>

          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="clearing"
            @click="handleMarkAllMastered"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {{ clearing ? '处理中...' : '全部标为已掌握' }}
          </button>
        </div>

        <!-- Question list -->
        <div style="display: flex; flex-direction: column; gap: 6px">
          <RouterLink
            v-for="({ question: q, record: r }, i) in displayItems"
            :key="q.id"
            :to="`/questions/${q.id}${getInlinePracticeSearch(sessionIds)}`"
            class="card card-interactive animate-fade-in"
            :style="{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '14px',
              padding: '14px 16px',
              textDecoration: 'none',
              animationDelay: `${Math.min(i * 0.03, 0.4)}s`,
            }"
          >
            <!-- Rank badge -->
            <div
              :style="{
                width: '26px',
                height: '26px',
                borderRadius: '8px',
                background: i < 3 ? 'rgba(239,68,68,0.1)' : i < 10 ? 'rgba(245,158,11,0.1)' : 'var(--surface-3)',
                color: i < 3 ? 'var(--danger)' : i < 10 ? 'var(--warning)' : 'var(--text-3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px',
                fontWeight: 700,
                flexShrink: 0,
                marginTop: '1px',
              }"
            >
              {{ i + 1 }}
            </div>

            <!-- Status strip -->
            <div style="width: 3px; align-self: stretch; border-radius: 99px; background: var(--warning); flex-shrink: 0" />

            <!-- Content -->
            <div style="flex: 1; min-width: 0">
              <p
                :style="{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: 'var(--text)',
                  lineHeight: 1.55,
                  marginBottom: '8px',
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }"
              >
                {{ q.question }}
              </p>

              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap">
                <span style="font-size: 12px; color: var(--text-3)">{{ q.module }}</span>
                <span style="font-size: 12px; color: var(--border)">·</span>
                <span :class="['text-xs', 'font-medium', 'px-1.5', 'py-0.5', 'rounded', 'border', DIFFICULTY_COLORS[q.difficulty]]">
                  {{ DIFFICULTY_LABELS[q.difficulty] }}
                </span>
                <span
                  v-for="tag in q.tags.slice(0, 2)"
                  :key="tag"
                  style="font-size: 11px; padding: 1px 7px; border-radius: 5px; border: 1px solid var(--border-subtle); color: var(--text-3)"
                >
                  {{ tag }}
                </span>
              </div>
            </div>

            <!-- Right meta -->
            <div style="flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; text-align: right">
              <span style="font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 5px; background: var(--warning-light); color: var(--warning); border: 1px solid rgba(245,158,11,0.2)">
                待复习
              </span>
              <span style="font-size: 11px; color: var(--text-3); white-space: nowrap">
                {{ timeAgo(r.lastUpdated) }}
              </span>
              <span v-if="r.reviewCount > 0" style="font-size: 11px; color: var(--text-3)">
                已复习 {{ r.reviewCount }} 次
              </span>
            </div>

            <!-- Arrow -->
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: 4px; color: var(--text-3)">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </RouterLink>
        </div>

        <!-- Tip card -->
        <div v-if="displayItems.length >= 10" class="animate-fade-in">
          <div class="card" style="padding: 14px 16px; display: flex; align-items: flex-start; gap: 12px; border-color: rgba(245,158,11,0.2); background: rgba(245,158,11,0.04)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: 1px">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <p style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px">建议每天专项复习</p>
              <p style="font-size: 12px; color: var(--text-2); line-height: 1.6">
                你有 {{ displayItems.length }} 道薄弱题，点击「集中攻克」进入连续刷题模式，每天坚持
                {{ Math.min(10, displayItems.length) }} 道，
                {{ Math.ceil(displayItems.length / 10) }} 天内可全部突破。
              </p>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-weight: 500;
  border-radius: 12px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  font-family: var(--font-sans);
}
.btn:active { transform: scale(0.97); }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn-sm { font-size: 12px; height: 28px; padding: 6px 12px; }
.btn-primary {
  background: var(--primary);
  border-color: var(--primary);
  color: white;
  box-shadow: var(--shadow-md);
}
.btn-primary:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
.btn-ghost {
  background: transparent;
  border-color: transparent;
  color: var(--text-2);
}
.btn-ghost:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
</style>
