<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStudyStore } from '@/stores/useStudyStore'
import { useQuestions } from '@/composables/useQuestions'
import { getCategoryMap, getAllQuestionNotes, getAllQuestionFlags } from '@/lib/db'
import { getDailyRecommendations } from '@/lib/questionLoader'
import { filterVisibleQuestions, getHiddenModules } from '@/lib/questionVisibility'
import type {
  Module,
  Question,
  QuestionNote,
  QuestionFlag,
  StudyStatus,
  CategoryMap,
} from '@/types'
import { DEFAULT_CATEGORY_MAP } from '@/lib/db'
import { DIFFICULTY_LABELS, STATUS_LABELS } from '@/types'

const route = useRoute()
const router = useRouter()
const study = useStudyStore()
const { allQuestions, loading, initializing, getDailyIds } = useQuestions()

// ─── State ─────────────────────────────────────────────────────
const STREAK_DISMISS_KEY = 'grimoireface_streak_banner_dismissed_date'
const streakVisible = ref(false)
const streakDismissed = ref(false)

try {
  const stored = localStorage.getItem(STREAK_DISMISS_KEY)
  streakDismissed.value = stored === new Date().toISOString().slice(0, 10)
} catch {}

function dismissStreak() {
  streakDismissed.value = true
  try {
    localStorage.setItem(STREAK_DISMISS_KEY, new Date().toISOString().slice(0, 10))
  } catch {}
}

const categoryMap = ref<CategoryMap>({ ...DEFAULT_CATEGORY_MAP })
const questionNotes = ref<QuestionNote[]>([])
const questionFlags = ref<QuestionFlag[]>([])
const dailyIds = ref<string[]>([])
const dailyLoading = ref(true)
const greeting = ref('')

// ─── Computed ──────────────────────────────────────────────────
const hiddenModules = computed(() =>
  getHiddenModules(categoryMap.value, study.hiddenCategories),
)

const visibleQuestions = computed(() =>
  filterVisibleQuestions(allQuestions.value, hiddenModules.value),
)

const visibleQuestionIds = computed(() =>
  visibleQuestions.value.map((q) => q.id),
)

const counts = computed(() => {
  const visibleIds = new Set(visibleQuestions.value.map((q) => q.id))
  let mastered = 0
  let review = 0
  for (const [id, r] of Object.entries(study.records)) {
    if (!visibleIds.has(id)) continue
    if (r.status === 'mastered') mastered++
    else if (r.status === 'review') review++
  }
  const tracked = mastered + review
  const unlearned = Math.max(0, visibleQuestions.value.length - tracked)
  return { mastered, review, unlearned }
})

const totalQuestions = computed(() => visibleQuestions.value.length)
const masteredPercent = computed(() =>
  totalQuestions.value > 0
    ? Math.round((counts.value.mastered / totalQuestions.value) * 100)
    : 0,
)
const remainingQuestions = computed(() =>
  Math.max(0, totalQuestions.value - counts.value.mastered),
)
const estimatedDays = computed(() =>
  remainingQuestions.value === 0
    ? 0
    : Math.ceil(remainingQuestions.value / Math.max(1, study.dailyGoal)),
)

const hasNoQuestions = computed(
  () => allQuestions.value.length === 0 && !loading.value,
)
const allHidden = computed(
  () => allQuestions.value.length > 0 && totalQuestions.value === 0,
)

// Streak milestone
const streakMilestone = computed(() => {
  const s = study.streak.currentStreak
  if (s >= 50) return { emoji: '🏆', msg: '史诗级连击！你已经达到传说级别！', color: '#f59e0b', bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.18)' }
  if (s >= 20) return { emoji: '👑', msg: '王者连击！专注力惊人！', color: '#ea580c', bg: 'rgba(234,88,12,0.06)', border: 'rgba(234,88,12,0.18)' }
  if (s >= 10) return { emoji: '🚀', msg: '10 连击！你已进入深度专注状态！', color: '#059669', bg: 'rgba(5,150,105,0.06)', border: 'rgba(5,150,105,0.18)' }
  if (s >= 5) return { emoji: '⚡', msg: '5 连击！手感火热，继续冲！', color: '#ea580c', bg: 'rgba(234,88,12,0.06)', border: 'rgba(234,88,12,0.18)' }
  if (s >= 3) return { emoji: '🔥', msg: '连击开启！越刷越顺！', color: '#f59e0b', bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.18)' }
  if (s >= 1) return { emoji: '✅', msg: '今日已作答，坚持就是胜利！', color: '#10b981', bg: 'rgba(16,185,129,0.06)', border: 'rgba(16,185,129,0.18)' }
  return null
})

// Module stats
const moduleStats = computed(() => {
  const orderedModules: string[] = []
  const seen = new Set<string>()
  const sortedCategories = Object.entries(categoryMap.value).sort(([, a], [, b]) => {
    return (a.order ?? 99) - (b.order ?? 99)
  })
  for (const [catName, category] of sortedCategories) {
    if (study.hiddenCategories.has(catName)) continue
    for (const m of category.modules) {
      if (!seen.has(m)) {
        orderedModules.push(m)
        seen.add(m)
      }
    }
  }
  for (const q of visibleQuestions.value) {
    if (!seen.has(q.module)) {
      orderedModules.push(q.module)
      seen.add(q.module)
    }
  }

  return orderedModules
    .map((mod) => ({
      module: mod as Module,
      questions: visibleQuestions.value.filter((q) => q.module === mod),
    }))
    .filter((s) => s.questions.length > 0)
})

// Recent notes
const recentNoteItems = computed(() => {
  const questionMap = new Map(visibleQuestions.value.map((q) => [q.id, q]))
  return questionNotes.value
    .filter((note) => note.content.trim().length > 0 && questionMap.has(note.questionId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((note) => ({
      note,
      question: questionMap.get(note.questionId)!,
    }))
})

// Study plan computed values
const dailyQuestions = computed(() => {
  const questionMap = new Map(visibleQuestions.value.map((q) => [q.id, q]))
  return dailyIds.value
    .map((id) => questionMap.get(id))
    .filter((q): q is Question => q != null)
})

const nextDailyQuestion = computed(() =>
  dailyQuestions.value.find(
    (q) => study.records[q.id]?.status !== 'mastered',
  ),
)

const oldestReview = computed(() => {
  let oldest: Question | undefined
  let oldestUpdated = Number.POSITIVE_INFINITY
  for (const q of visibleQuestions.value) {
    const record = study.records[q.id]
    if (record?.status !== 'review') continue
    const updated = record.lastUpdated ?? 0
    if (updated < oldestUpdated) {
      oldest = q
      oldestUpdated = updated
    }
  }
  return oldest
})

const moduleFocus = computed(() => {
  let best:
    | {
        module: Module
        total: number
        mastered: number
        review: number
        unlearned: number
        percent: number
        score: number
      }
    | undefined

  for (const { module, questions: qs } of moduleStats.value) {
    const total = qs.length
    let mastered = 0
    let review = 0
    for (const q of qs) {
      const status = study.records[q.id]?.status
      if (status === 'mastered') mastered++
      if (status === 'review') review++
    }
    const unlearned = total - mastered - review
    const percent = total > 0 ? Math.round((mastered / total) * 100) : 0
    const score = review * 4 + unlearned + (100 - percent) / 20
    const item = { module, total, mastered, review, unlearned, percent, score }
    if (item.total > 0 && item.percent < 100 && (!best || item.score > best.score)) {
      best = item
    }
  }
  return best
})

const todayDone = computed(() => study.streak.todayCount)
const remainingToday = computed(() => Math.max(0, study.dailyGoal - todayDone.value))
const todayPercent = computed(() =>
  Math.min(100, Math.round((todayDone.value / study.dailyGoal) * 100)),
)
const dailyPracticePath = computed(() =>
  dailyIds.value.length > 0
    ? `/practice?ids=${dailyIds.value.join(',')}`
    : '/practice',
)
const studyHeadline = computed(() =>
  remainingToday.value === 0
    ? '今日目标已完成，可以继续挑战'
    : counts.value.review > 0
      ? '先处理待复习题目'
      : '补齐今日练习目标',
)
const studySubline = computed(() =>
  counts.value.review > 0
    ? `${counts.value.review} 道题正在等待复习，优先清理能更快稳住记忆。`
    : remainingToday.value > 0
      ? `还差 ${remainingToday.value} 题完成今日目标，推荐从今日题单继续。`
      : '今天已经完成目标，可以按薄弱模块继续加练。',
)

// ─── Init ──────────────────────────────────────────────────────
onMounted(async () => {
  // Set greeting
  const h = new Date().getHours()
  if (h < 6) greeting.value = '夜深了，注意休息'
  else if (h < 10) greeting.value = '早上好，开始今天的备战'
  else if (h < 13) greeting.value = '上午好，专注备战'
  else if (h < 17) greeting.value = '下午好，继续加油'
  else if (h < 20) greeting.value = '晚上好，刷题时间到'
  else greeting.value = '晚上好，坚持就是胜利'

  // Show streak banner after mount
  setTimeout(() => { streakVisible.value = true }, 80)

  // Load category map
  getCategoryMap().then((map) => {
    categoryMap.value = map
  })
  const onCategoryUpdate = () => {
    getCategoryMap().then((map) => {
      categoryMap.value = map
    })
  }
  window.addEventListener('grimoireface_category_map_updated', onCategoryUpdate)
  onUnmounted(() => window.removeEventListener('grimoireface_category_map_updated', onCategoryUpdate))

  // Load notes and flags
  const loadMeta = async () => {
    const [notes, flags] = await Promise.allSettled([
      getAllQuestionNotes(),
      getAllQuestionFlags(),
    ])
    questionNotes.value =
      notes.status === 'fulfilled' ? notes.value : []
    questionFlags.value =
      flags.status === 'fulfilled' ? flags.value : []
  }
  loadMeta()
  window.addEventListener('focus', loadMeta)
  onUnmounted(() => window.removeEventListener('focus', loadMeta))
})

// Load daily ids when visible questions or records change
watch(
  [visibleQuestionIds, () => study.records, () => study.dailyGoal],
  async () => {
    if (visibleQuestionIds.value.length === 0) {
      dailyIds.value = []
      dailyLoading.value = false
      return
    }
    dailyLoading.value = true
    try {
      const ids = await getDailyIds(
        Object.fromEntries(
          Object.entries(study.records).map(([k, v]) => [
            k,
            { status: v.status, lastUpdated: v.lastUpdated },
          ]),
        ),
        study.dailyGoal,
        visibleQuestionIds.value,
      )
      dailyIds.value = ids
    } finally {
      dailyLoading.value = false
    }
  },
  { immediate: true },
)

// ─── Helpers ───────────────────────────────────────────────────
function formatRecentNoteTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  })
}

function getNotePreview(content: string): string {
  const text = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_[\]`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return '暂无笔记内容'
  return text.length > 110 ? `${text.slice(0, 110)}...` : text
}
</script>

<template>
  <div class="page-container">
    <!-- Skeleton -->
    <template v-if="initializing">
      <div class="grid grid-cols-4 gap-3 mb-5 stats-grid">
        <div v-for="i in 4" :key="'ss-' + i" class="card flex items-center gap-3" style="padding:16px">
          <div class="skeleton" style="width:38px;height:38px;border-radius:10px" />
          <div class="flex-1 flex flex-col gap-1.5">
            <div class="skeleton" style="width:60%;height:11px" />
            <div class="skeleton" style="width:40%;height:18px" />
          </div>
        </div>
      </div>
      <div class="grid gap-3.5 mb-5 main-grid" style="grid-template-columns:2fr 3fr">
        <div class="card flex flex-col gap-4" style="padding:20px">
          <div class="skeleton" style="width:80px;height:14px" />
          <div class="flex justify-center">
            <div class="skeleton" style="width:140px;height:140px;border-radius:50%" />
          </div>
        </div>
        <div class="card flex flex-col gap-3" style="padding:20px">
          <div class="skeleton" style="width:80px;height:14px" />
          <div v-for="i in 6" :key="'ms-' + i" class="flex items-center gap-3">
            <div class="flex-1 flex flex-col gap-1">
              <div class="skeleton" style="width:65%;height:12px" />
              <div class="skeleton" style="width:100%;height:4px;border-radius:99px" />
            </div>
            <div class="skeleton" style="width:28px;height:12px" />
          </div>
        </div>
      </div>
      <div
        class="grid gap-3"
        style="grid-template-columns:repeat(2,1fr)"
      >
        <div v-for="i in 6" :key="'ds-' + i" class="card flex items-start gap-2.5" style="padding:12px 14px">
          <div class="skeleton" style="width:22px;height:22px;border-radius:6px" />
          <div class="flex-1 flex flex-col gap-1.5">
            <div class="skeleton" style="width:80%;height:12px" />
            <div class="skeleton" style="width:45%;height:11px" />
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <!-- Streak Banner -->
      <div
        v-if="streakMilestone && study.streak.todayCount > 0 && !streakDismissed"
        class="flex items-center gap-3 p-3 rounded-xl mb-5"
        :style="{
          opacity: streakVisible ? 1 : 0,
          transform: streakVisible ? 'translateY(0)' : 'translateY(-6px)',
          transition: 'opacity 0.3s var(--ease-out), transform 0.3s var(--ease-out)',
          background: streakMilestone.bg,
          border: `1px solid ${streakMilestone.border}`,
        }"
      >
        <span style="font-size:22px;flex-shrink:0;line-height:1">{{ streakMilestone.emoji }}</span>
        <div class="flex-1 min-w-0">
          <p :style="{fontSize:'13px',fontWeight:600,color:streakMilestone.color,marginBottom:'1px'}">
            {{ streakMilestone.msg }}
          </p>
          <div class="flex items-center gap-3 flex-wrap">
            <span style="font-size:12px;color:var(--text-3)">
              今日作答
              <strong style="font-weight:600;color:var(--text-2);font-variant-numeric:tabular-nums">
                {{ study.streak.todayCount }}
              </strong>
              题
            </span>
            <span v-if="study.streak.currentStreak >= 2" style="font-size:12px;color:var(--text-3)">
              🔥 当前连击
              <strong :style="{fontWeight:600,color:streakMilestone.color,fontVariantNumeric:'tabular-nums'}">
                {{ study.streak.currentStreak }}
              </strong>
            </span>
            <span v-if="study.streak.bestStreak > 0" style="font-size:12px;color:var(--text-3)">
              最高记录
              <strong style="font-weight:600;color:var(--text-2);font-variant-numeric:tabular-nums">
                {{ study.streak.bestStreak }}
              </strong>
            </span>
          </div>
        </div>
        <div v-if="study.streak.todayCount > 0" class="flex flex-col items-end gap-1 flex-shrink-0">
          <span style="font-size:11px;color:var(--text-3);font-variant-numeric:tabular-nums">
            目标 {{ study.dailyGoal }} 题
          </span>
          <div
            style="width:80px;height:4px;background:var(--border);border-radius:99px;overflow:hidden"
          >
            <div
              :style="{
                height:'100%',
                background: streakMilestone.color,
                borderRadius:'99px',
                width: `${Math.min(100, (study.streak.todayCount / study.dailyGoal) * 100)}%`,
                transition: 'width 0.6s var(--ease-out)',
              }"
            />
          </div>
          <span v-if="study.streak.todayCount >= study.dailyGoal" :style="{fontSize:'10px',color:streakMilestone.color,fontWeight:600}">
            今日目标达成 🎉
          </span>
        </div>
        <button
          type="button"
          class="text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer bg-transparent border-none p-0.5 rounded text-base leading-none flex-shrink-0"
          @click="dismissStreak"
          aria-label="关闭"
        >×</button>
      </div>

      <!-- Greeting -->
      <div class="animate-fade-in" style="margin-bottom:28px">
        <h1 style="font-size:22px;font-weight:700;color:var(--text);letter-spacing:-0.02em;margin-bottom:4px">
          {{ greeting }}
        </h1>
        <p style="font-size:13px;color:var(--text-3)">
          <template v-if="hasNoQuestions">暂无题目，请先导入题库</template>
          <template v-else-if="allHidden">所有题库已关闭展示，可在设置 → 刷题偏好中调整</template>
          <template v-else>共 {{ totalQuestions }} 道题，已掌握 {{ counts.mastered }} 道</template>
        </p>
      </div>

      <!-- Empty / All hidden states -->
      <template v-if="hasNoQuestions">
        <div class="card flex flex-col items-center justify-center text-center" style="padding:80px 20px">
          <div style="width:56px;height:56px;border-radius:16px;background:var(--surface-3);display:flex;align-items:center;justify-content:center;margin-bottom:16px">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px">题库为空</p>
          <p style="font-size:13px;color:var(--text-3);max-width:280px;line-height:1.6">
            前往「导入题目」页面，导入内置题库或自定义 JSON 文件
          </p>
          <RouterLink to="/import" style="margin-top:20px;text-decoration:none">
            <button class="btn btn-primary btn-md">前往导入</button>
          </RouterLink>
        </div>
      </template>
      <template v-else-if="allHidden">
        <div class="card flex flex-col items-center justify-center text-center" style="padding:80px 20px">
          <div style="width:56px;height:56px;border-radius:16px;background:var(--surface-3);display:flex;align-items:center;justify-content:center;margin-bottom:16px">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px">所有题库已关闭展示</p>
          <p style="font-size:13px;color:var(--text-3);max-width:280px;line-height:1.6">
            在「设置 → 刷题偏好 → 题库展示」中启用至少一个题库
          </p>
        </div>
      </template>

      <template v-else>
        <!-- Stats Row -->
        <div class="grid gap-3 mb-5 stats-grid" style="grid-template-columns:repeat(4,1fr)">
          <div class="card animate-fade-in flex items-center gap-3.5" style="padding:16px 18px">
            <div style="width:38px;height:38px;border-radius:10px;background:var(--surface-3);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--text-2)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <div class="min-w-0">
              <p style="font-size:11px;color:var(--text-3);margin-bottom:2px">题目总数</p>
              <p style="font-size:20px;font-weight:700;color:var(--text);line-height:1;font-variant-numeric:tabular-nums">{{ totalQuestions }}</p>
            </div>
          </div>
          <div class="card animate-fade-in stagger-1 flex items-center gap-3.5" style="padding:16px 18px">
            <div style="width:38px;height:38px;border-radius:10px;background:var(--success-light);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--text-2)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div class="min-w-0">
              <p style="font-size:11px;color:var(--text-3);margin-bottom:2px">已掌握</p>
              <p style="font-size:20px;font-weight:700;color:var(--text);line-height:1;font-variant-numeric:tabular-nums">{{ counts.mastered }}</p>
              <p style="font-size:11px;color:var(--text-3);margin-top:2px">占比 {{ masteredPercent }}%</p>
            </div>
          </div>
          <div class="card animate-fade-in stagger-2 flex items-center gap-3.5" style="padding:16px 18px">
            <div style="width:38px;height:38px;border-radius:10px;background:var(--warning-light);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--text-2)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </div>
            <div class="min-w-0">
              <p style="font-size:11px;color:var(--text-3);margin-bottom:2px">待复习</p>
              <p style="font-size:20px;font-weight:700;color:var(--text);line-height:1;font-variant-numeric:tabular-nums">{{ counts.review }}</p>
            </div>
          </div>
          <div class="card animate-fade-in stagger-3 flex items-center gap-3.5" style="padding:16px 18px">
            <div style="width:38px;height:38px;border-radius:10px;background:var(--surface-3);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--text-2)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div class="min-w-0">
              <p style="font-size:11px;color:var(--text-3);margin-bottom:2px">预计完成</p>
              <p style="font-size:20px;font-weight:700;color:var(--text);line-height:1;font-variant-numeric:tabular-nums">
                {{ estimatedDays === 0 ? '已完成' : `${estimatedDays} 天` }}
              </p>
              <p v-if="estimatedDays > 0" style="font-size:11px;color:var(--text-3);margin-top:2px">每天 {{ study.dailyGoal }} 题</p>
            </div>
          </div>
        </div>

        <!-- Main Grid: Overall Progress + Module Progress -->
        <div class="grid gap-3.5 mb-5 main-grid" style="grid-template-columns:2fr 3fr;align-items:start">
          <!-- Overall Progress -->
          <div class="card animate-fade-in stagger-2" style="padding:20px">
            <h2 style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:20px">总体进度</h2>
            <div class="flex items-center justify-center gap-7 mb-5">
              <!-- SegmentedRing -->
              <div style="position:relative;width:130px;height:130px" class="flex items-center justify-center">
                <svg width="130" height="130" style="transform:rotate(-90deg)">
                  <circle cx="65" cy="65" r="60" fill="none" stroke="var(--border)" stroke-width="10" />
                  <circle
                    v-if="counts.mastered > 0"
                    cx="65" cy="65" r="60" fill="none" stroke="#10b981" stroke-width="10"
                    stroke-linecap="round"
                    :stroke-dasharray="`${Math.max(0, (counts.mastered / totalQuestions) * 377 - 5)} 377`"
                    stroke-dashoffset="0"
                    class="progress-ring-circle"
                  />
                  <circle
                    v-if="counts.review > 0"
                    cx="65" cy="65" r="60" fill="none" stroke="#f59e0b" stroke-width="10"
                    stroke-linecap="round"
                    :stroke-dasharray="`${Math.max(0, (counts.review / totalQuestions) * 377 - 5)} 377`"
                    :stroke-dashoffset="`${-(counts.mastered / totalQuestions) * 377}`"
                    class="progress-ring-circle"
                  />
                </svg>
                <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
                  <div style="text-align:center">
                    <p style="font-size:22px;font-weight:700;color:var(--text);line-height:1;font-variant-numeric:tabular-nums">
                      {{ masteredPercent }}%
                    </p>
                    <p style="font-size:11px;color:var(--text-3);margin-top:4px">已掌握</p>
                  </div>
                </div>
              </div>
              <!-- Legend -->
              <div class="flex flex-col gap-2.5">
                <div class="flex items-center gap-2">
                  <span style="width:8px;height:8px;border-radius:50%;background:var(--success);flex-shrink:0" />
                  <span style="font-size:12px;color:var(--text-2)">{{ STATUS_LABELS.mastered }}</span>
                  <span style="font-size:12px;font-weight:600;color:var(--text);margin-left:4px;font-variant-numeric:tabular-nums">{{ counts.mastered }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span style="width:8px;height:8px;border-radius:50%;background:var(--warning);flex-shrink:0" />
                  <span style="font-size:12px;color:var(--text-2)">{{ STATUS_LABELS.review }}</span>
                  <span style="font-size:12px;font-weight:600;color:var(--text);margin-left:4px;font-variant-numeric:tabular-nums">{{ counts.review }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span style="width:8px;height:8px;border-radius:50%;background:var(--border);flex-shrink:0" />
                  <span style="font-size:12px;color:var(--text-2)">{{ STATUS_LABELS.unlearned }}</span>
                  <span style="font-size:12px;font-weight:600;color:var(--text);margin-left:4px;font-variant-numeric:tabular-nums">{{ counts.unlearned }}</span>
                </div>
              </div>
            </div>
            <div class="flex gap-2 pt-4" style="border-top:1px solid var(--border-subtle)">
              <RouterLink to="/questions" class="flex-1 no-underline">
                <button class="btn btn-secondary btn-sm w-full">浏览题库</button>
              </RouterLink>
              <RouterLink to="/practice" class="flex-1 no-underline">
                <button class="btn btn-primary btn-sm w-full">开始练习</button>
              </RouterLink>
            </div>
          </div>

          <!-- Algorithm Module -->
          <div class="card animate-fade-in stagger-3" style="padding:20px">
            <div class="flex items-center justify-between mb-2.5">
              <h2 style="font-size:13px;font-weight:600;color:var(--text)">算法刷题</h2>
              <RouterLink
                to="/algo"
                class="text-xs no-underline"
                style="color:var(--primary)"
              >进入</RouterLink>
            </div>
            <p style="font-size:12px;color:var(--text-3);margin-bottom:12px;line-height:1.5">
              ACM 模式在线判题，支持 JavaScript、Python、Java
            </p>
            <div class="flex gap-2" style="border-top:1px solid var(--border-subtle);padding-top:12px">
              <RouterLink to="/algo" class="flex-1 no-underline">
                <button class="btn btn-secondary btn-sm w-full">浏览题目</button>
              </RouterLink>
              <RouterLink to="/algo/practice" class="flex-1 no-underline">
                <button class="btn btn-primary btn-sm w-full">开始刷题</button>
              </RouterLink>
            </div>
          </div>

          <!-- Module Progress -->
          <div class="card animate-fade-in stagger-3" style="padding:20px">
            <div class="flex items-center justify-between mb-2.5">
              <h2 style="font-size:13px;font-weight:600;color:var(--text)">模块进度</h2>
              <RouterLink
                to="/questions"
                class="text-xs no-underline"
                style="color:var(--primary)"
              >查看全部</RouterLink>
            </div>
            <div class="no-scrollbar" style="max-height:205px;overflow-y:auto">
              <RouterLink
                v-for="{ module, questions: qs } in moduleStats"
                :key="module"
                :to="`/questions?module=${encodeURIComponent(module)}`"
                class="flex items-center gap-3 py-2 px-2.5 rounded-lg no-underline hover:bg-[var(--surface-2)] transition-colors"
              >
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-[13px] font-medium text-[var(--text)] overflow-hidden text-ellipsis whitespace-nowrap">
                      {{ module }}
                    </span>
                    <span class="text-[11px] text-[var(--text-3)] flex-shrink-0 ml-2">
                      {{ qs.filter(q => study.records[q.id]?.status === 'mastered').length }}/{{ qs.length }}
                    </span>
                  </div>
                  <div style="height:4px;background:var(--surface-3);border-radius:99px;overflow:hidden">
                    <div style="height:100%;display:flex;border-radius:99px;overflow:hidden">
                      <div
                        v-if="qs.filter(q => study.records[q.id]?.status === 'mastered').length > 0"
                        :style="{
                          height:'100%',
                          background:'var(--success)',
                          width:`${(qs.filter(q => study.records[q.id]?.status === 'mastered').length / qs.length) * 100}%`,
                          transition:'width 0.6s cubic-bezier(0.22,1,0.36,1)',
                        }"
                      />
                      <div
                        v-if="qs.filter(q => study.records[q.id]?.status === 'review').length > 0"
                        :style="{
                          height:'100%',
                          background:'var(--warning)',
                          width:`${(qs.filter(q => study.records[q.id]?.status === 'review').length / qs.length) * 100}%`,
                          transition:'width 0.6s cubic-bezier(0.22,1,0.36,1)',
                        }"
                      />
                    </div>
                  </div>
                </div>
                <span
                  class="text-xs font-semibold flex-shrink-0 text-right"
                  style="min-width:30px;font-variant-numeric:tabular-nums"
                  :style="{
                    color:
                      qs.filter(q => study.records[q.id]?.status === 'mastered').length === qs.length
                        ? 'var(--success)'
                        : qs.filter(q => study.records[q.id]?.status === 'mastered').length > 0
                          ? 'var(--primary)'
                          : 'var(--text-3)',
                  }"
                >
                  {{ qs.length > 0 ? Math.round((qs.filter(q => study.records[q.id]?.status === 'mastered').length / qs.length) * 100) : 0 }}%
                </span>
              </RouterLink>
            </div>
          </div>
        </div>

        <!-- Study Plan + Recent Notes -->
        <div class="grid gap-3.5 mb-5 learning-focus-grid" style="grid-template-columns:minmax(0,1.08fr) minmax(0,0.92fr);align-items:stretch">
          <!-- Study Plan Card -->
          <div class="card animate-fade-in stagger-1" style="padding:20px">
            <div class="study-plan-grid" style="display:grid;grid-template-columns:1.2fr 1fr;gap:18px;align-items:stretch">
              <div class="flex flex-col gap-3.5 min-w-0">
                <div>
                  <p style="font-size:11px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">下一步建议</p>
                  <h2 style="font-size:18px;font-weight:700;color:var(--text);line-height:1.35;letter-spacing:-0.01em">{{ studyHeadline }}</h2>
                  <p style="font-size:13px;color:var(--text-2);margin-top:6px;line-height:1.65">{{ studySubline }}</p>
                </div>
                <div class="flex items-center gap-2.5">
                  <div style="flex:1;height:8px;border-radius:99px;background:var(--surface-3);overflow:hidden">
                    <div
                      :style="{
                        height:'100%',
                        width:`${todayPercent}%`,
                        borderRadius:'99px',
                        background: remainingToday === 0 ? 'var(--success)' : 'var(--primary)',
                        transition:'width 0.5s var(--ease-out)',
                      }"
                    />
                  </div>
                  <span style="font-size:12px;color:var(--text-3);font-variant-numeric:tabular-nums;white-space:nowrap">
                    {{ todayDone }}/{{ study.dailyGoal }} 今日
                  </span>
                </div>
                <div class="flex gap-2 flex-wrap">
                  <RouterLink :to="dailyPracticePath" class="no-underline">
                    <button class="btn btn-primary btn-sm">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      {{ dailyIds.length > 0 ? `开始今日 ${dailyIds.length} 题` : '开始练习' }}
                    </button>
                  </RouterLink>
                  <RouterLink v-if="counts.review > 0" to="/weak" class="no-underline">
                    <button class="btn btn-secondary btn-sm">查看薄弱点</button>
                  </RouterLink>
                  <RouterLink v-else-if="moduleFocus" :to="`/questions?module=${encodeURIComponent(moduleFocus.module)}`" class="no-underline">
                    <button class="btn btn-secondary btn-sm">练 {{ moduleFocus.module }}</button>
                  </RouterLink>
                </div>
              </div>

              <!-- Signal cards -->
              <div class="grid gap-2.5 min-w-0 study-plan-signals" style="grid-template-columns:1fr 1fr">
                <!-- 待复习 -->
                <div style="border-radius:10px;border:1px solid var(--border-subtle);background:var(--surface-2);padding:11px 12px;min-width:0">
                  <p style="font-size:11px;color:var(--text-3);margin-bottom:4px">待复习</p>
                  <p style="font-size:16px;font-weight:700;color:var(--warning);line-height:1.2;font-variant-numeric:tabular-nums">{{ counts.review }} 道</p>
                  <p style="font-size:11px;color:var(--text-3);margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    {{ oldestReview ? oldestReview.module : '暂无堆积' }}
                  </p>
                  <div style="width:22px;height:3px;border-radius:99px;background:var(--warning-light);margin-top:8px" />
                </div>
                <!-- 未学习 -->
                <div style="border-radius:10px;border:1px solid var(--border-subtle);background:var(--surface-2);padding:11px 12px;min-width:0">
                  <p style="font-size:11px;color:var(--text-3);margin-bottom:4px">未学习</p>
                  <p style="font-size:16px;font-weight:700;color:var(--primary);line-height:1.2;font-variant-numeric:tabular-nums">{{ counts.unlearned }} 道</p>
                  <p style="font-size:11px;color:var(--text-3);margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    {{ moduleFocus ? `${moduleFocus.module} 优先` : '题库已覆盖' }}
                  </p>
                  <div style="width:22px;height:3px;border-radius:99px;background:var(--primary-light);margin-top:8px" />
                </div>
                <!-- 薄弱模块 -->
                <div style="border-radius:10px;border:1px solid var(--border-subtle);background:var(--surface-2);padding:11px 12px;min-width:0">
                  <p style="font-size:11px;color:var(--text-3);margin-bottom:4px">薄弱模块</p>
                  <p
                    :style="{
                      fontSize:'16px',fontWeight:700,lineHeight:1.2,fontVariantNumeric:'tabular-nums',
                      color: moduleFocus ? 'var(--danger)' : 'var(--success)',
                    }"
                  >
                    {{ moduleFocus ? `${moduleFocus.percent}%` : '完成' }}
                  </p>
                  <p style="font-size:11px;color:var(--text-3);margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    {{ moduleFocus ? `${moduleFocus.mastered}/${moduleFocus.total} 已掌握` : '没有明显短板' }}
                  </p>
                  <div
                    :style="{
                      width:'22px',height:'3px',borderRadius:'99px',marginTop:'8px',
                      background: moduleFocus ? 'var(--danger-light)' : 'var(--success-light)',
                    }"
                  />
                </div>
                <!-- 下一题 -->
                <div style="border-radius:10px;border:1px solid var(--border-subtle);background:var(--surface-2);padding:11px 12px;min-width:0">
                  <p style="font-size:11px;color:var(--text-3);margin-bottom:4px">下一题</p>
                  <p style="font-size:16px;font-weight:700;color:var(--text);line-height:1.2">
                    {{ nextDailyQuestion ? DIFFICULTY_LABELS[nextDailyQuestion.difficulty as 1|2|3] : '无' }}
                  </p>
                  <p style="font-size:11px;color:var(--text-3);margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    {{ nextDailyQuestion ? nextDailyQuestion.module : '今日题单已清空' }}
                  </p>
                  <div style="width:22px;height:3px;border-radius:99px;background:var(--surface-3);margin-top:8px" />
                </div>
              </div>
            </div>
          </div>

          <!-- Recent Notes -->
          <div class="card animate-fade-in stagger-2" style="padding:20px">
            <div class="flex items-start justify-between gap-3 mb-3.5">
              <div class="min-w-0">
                <h2 style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:3px">最近笔记</h2>
                <p style="font-size:12px;color:var(--text-3)">
                  {{ recentNoteItems.length > 0 ? `${recentNoteItems.length} 道题已有笔记` : '记录后的题目会在这里出现' }}
                </p>
              </div>
              <RouterLink to="/questions?notes=1&sort=note-updated" class="no-underline flex-shrink-0">
                <button class="btn btn-secondary btn-sm">查看全部</button>
              </RouterLink>
            </div>

            <!-- No notes -->
            <div
              v-if="recentNoteItems.length === 0"
              class="flex items-center justify-between gap-3.5 p-3.5 rounded-lg"
              style="border:1px dashed var(--border);background:var(--surface-2)"
            >
              <div class="min-w-0">
                <p style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:3px">暂无笔记</p>
                <p style="font-size:12px;color:var(--text-3);line-height:1.6">
                  在题目页按 N 打开笔记，复盘内容会自动汇总到这里。
                </p>
              </div>
              <RouterLink to="/questions" class="no-underline flex-shrink-0">
                <button class="btn btn-primary btn-sm">去题库</button>
              </RouterLink>
            </div>

            <!-- Notes grid -->
            <div v-else class="recent-notes-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
              <RouterLink
                v-for="{ note, question } in recentNoteItems.slice(0, 4)"
                :key="note.questionId"
                :to="`/questions/${question.id}?note=1`"
                class="note-card flex flex-col gap-1.5 min-w-0 p-3 rounded-lg no-underline"
                style="min-height:116px"
              >
                <div class="flex items-center gap-1.5 min-w-0">
                  <span class="text-[11px] font-semibold text-[var(--primary)] overflow-hidden text-ellipsis whitespace-nowrap">
                    {{ question.module }}
                  </span>
                  <span class="text-[11px] text-[var(--text-3)] flex-shrink-0">
                    {{ DIFFICULTY_LABELS[question.difficulty as 1|2|3] }}
                  </span>
                  <span class="ml-auto text-[11px] text-[var(--text-3)] flex-shrink-0">
                    {{ formatRecentNoteTime(note.updatedAt) }}
                  </span>
                </div>
                <p class="text-[13px] font-semibold text-[var(--text)] leading-[1.45]" style="overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">
                  {{ question.question }}
                </p>
                <p class="text-xs text-[var(--text-3)] leading-[1.55]" style="overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">
                  {{ getNotePreview(note.content) }}
                </p>
              </RouterLink>
            </div>
          </div>
        </div>

        <!-- Daily Recommendations -->
        <div class="card animate-fade-in stagger-4" style="padding:20px;margin-bottom:20px">
          <div class="flex items-start justify-between mb-4">
            <div>
              <h2 style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:3px">今日推荐</h2>
              <p style="font-size:12px;color:var(--text-3)">优先待复习，其次未学习高频题</p>
            </div>
            <div v-if="dailyIds.length > 0" class="flex items-center gap-2">
              <span style="font-size:12px;color:var(--text-3);font-variant-numeric:tabular-nums">
                {{ dailyIds.filter(id => study.records[id]?.status === 'mastered').length }}/{{ dailyIds.length }} 完成
              </span>
              <RouterLink :to="`/practice?ids=${dailyIds.join(',')}`" class="no-underline">
                <button class="btn btn-primary btn-sm">连续刷题</button>
              </RouterLink>
            </div>
          </div>

          <!-- Loading skeleton -->
          <div v-if="dailyLoading" class="daily-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
            <div
              v-for="i in 6"
              :key="'ds-' + i"
              class="flex items-start gap-2.5 p-3 rounded-lg"
              style="border:1px solid var(--border-subtle)"
            >
              <div class="skeleton" style="width:22px;height:22px;border-radius:6px" />
              <div class="flex-1 flex flex-col gap-1.5">
                <div class="skeleton" style="width:80%;height:12px" />
                <div class="skeleton" style="width:45%;height:11px" />
              </div>
            </div>
          </div>

          <!-- Empty -->
          <div
            v-else-if="dailyIds.length === 0"
            class="flex flex-col items-center justify-center py-14"
          >
            <div style="width:56px;height:56px;border-radius:16px;background:var(--surface-3);display:flex;align-items:center;justify-content:center;margin-bottom:16px">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p style="font-size:14px;font-weight:600;color:var(--text)">今日已全部完成</p>
            <p style="font-size:13px;color:var(--text-3);margin-top:4px">所有题目都已掌握，真棒！</p>
          </div>

          <!-- Daily question cards -->
          <div v-else class="daily-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
            <RouterLink
              v-for="(id, i) in dailyIds"
              :key="id"
              :to="`/questions/${id}`"
              class="daily-card animate-fade-in flex items-start gap-3 p-3 rounded-lg no-underline min-w-0 overflow-hidden"
              :style="{ animationDelay:`${i * 0.04}s` }"
            >
              <div
                class="flex items-center justify-center flex-shrink-0 mt-0.5"
                style="width:22px;height:22px;border-radius:6px;background:var(--surface-3);font-size:11px;font-weight:600;color:var(--text-3)"
              >
                {{ i + 1 }}
              </div>
              <div class="flex-1 min-w-0 overflow-hidden">
                <p
                  class="text-[13px] leading-relaxed mb-1.5"
                  style="color:var(--text);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word"
                >
                  {{ visibleQuestions.find(q => q.id === id)?.question ?? '' }}
                </p>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span style="font-size:11px;color:var(--text-3)">
                    {{ visibleQuestions.find(q => q.id === id)?.module ?? '' }}
                  </span>
                  <span
                    :style="{
                      fontSize:'11px',fontWeight:500,
                      color: visibleQuestions.find(q => q.id === id)?.difficulty === 1 ? 'var(--success)' : visibleQuestions.find(q => q.id === id)?.difficulty === 2 ? 'var(--warning)' : 'var(--danger)',
                    }"
                  >
                    {{ DIFFICULTY_LABELS[(visibleQuestions.find(q => q.id === id)?.difficulty ?? 1) as 1|2|3] }}
                  </span>
                  <span
                    v-if="study.records[id]?.status"
                    class="text-[11px] font-medium"
                    :style="{
                      color: study.records[id]?.status === 'mastered' ? 'var(--success)' : study.records[id]?.status === 'review' ? 'var(--warning)' : 'transparent',
                    }"
                  >
                    {{ study.records[id]?.status === 'mastered' ? '已掌握' : study.records[id]?.status === 'review' ? '待复习' : '' }}
                  </span>
                </div>
              </div>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:4px;color:var(--text-3)">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </RouterLink>
          </div>
        </div>
      </template>
    </template>

  </div>
</template>

<style scoped>
/* Notes card hover */
.note-card {
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  transition: border-color 0.15s, background 0.15s;
}
.note-card:hover {
  border-color: rgba(var(--primary-rgb), 0.28);
  background: var(--surface-2);
}

/* Daily question card hover */
.daily-card {
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  transition: border-color 0.15s, background 0.15s;
}
.daily-card:hover {
  border-color: rgba(var(--primary-rgb), 0.3);
  background: var(--surface-2);
}

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
.btn-sm { font-size: 12px; height: 28px; padding: 6px 12px; }
.btn-md { font-size: 14px; height: 36px; padding: 8px 16px; }
.btn-primary {
  background: var(--primary);
  border-color: var(--primary);
  color: white;
  box-shadow: var(--shadow-md);
}
.btn-primary:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
.btn-secondary {
  background: var(--surface);
  border-color: var(--border);
  color: var(--text);
}
.btn-secondary:hover { background: var(--surface-2); }
.btn-ghost {
  background: transparent;
  border-color: transparent;
  color: var(--text-2);
}
.btn-ghost:hover { background: var(--surface-2); color: var(--text); }
.w-full { width: 100%; }

@media (max-width: 900px) {
  .main-grid { grid-template-columns: 1fr !important; }
  .learning-focus-grid { grid-template-columns: 1fr !important; }
  .study-plan-grid { grid-template-columns: 1fr !important; }
  .recent-notes-grid { grid-template-columns: 1fr !important; }
  .daily-grid { grid-template-columns: 1fr !important; }
}
@media (max-width: 640px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
  .main-grid { grid-template-columns: 1fr !important; }
  .learning-focus-grid { grid-template-columns: 1fr !important; }
  .daily-grid { grid-template-columns: 1fr !important; }
  .study-plan-signals { grid-template-columns: 1fr !important; }
}
@media (max-width: 480px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
  .daily-grid { grid-template-columns: 1fr !important; }
}
</style>
