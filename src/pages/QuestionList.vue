<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useQuestions } from '@/composables/useQuestions'
import {
  type CategoryMap,
  DEFAULT_CATEGORY_MAP,
  getAllQuestionFlags,
  getAllQuestionNotes,
  getCategoryMap,
} from '@/lib/db'
import { createPracticeSessionPath } from '@/lib/practiceSession'
import { filterVisibleQuestions, getHiddenModules } from '@/lib/questionVisibility'
import { useStudyStore } from '@/stores/useStudyStore'
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_STYLES,
  type Difficulty,
  type Module,
  type Question,
  type QuestionFlag,
  type QuestionNote,
  STATUS_LABELS,
  STATUS_STYLES,
  type StudyStatus,
} from '@/types'

const router = useRouter()
const route = useRoute()
const { allQuestions, initializing } = useQuestions()
const studyStore = useStudyStore()

// ─── URL param helpers ──────────────────────────────────────────────────────────

const STATUS_VALUES = new Set<StudyStatus>(['unlearned', 'review', 'mastered'])
const DIFFICULTY_VALUES = new Set<Difficulty>([1, 2, 3])
const SORT_VALUES = new Set(['default', 'note-updated', 'difficulty-asc', 'difficulty-desc', 'module'])

function parseListParam(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .flatMap((v) => (typeof v === 'string' ? v.split(',') : []))
      .map((v) => v.trim())
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((v) => v.trim()).filter(Boolean)
  }
  return []
}

function uniqueValues<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function parseModuleParams(): Module[] {
  return uniqueValues(parseListParam(route.query.module) as Module[])
}

function parseDifficultyParams(): Difficulty[] {
  return uniqueValues(
    parseListParam(route.query.difficulty)
      .map(Number)
      .filter((v): v is Difficulty => DIFFICULTY_VALUES.has(v as Difficulty)),
  )
}

function parseStatusParams(): StudyStatus[] {
  return uniqueValues(
    parseListParam(route.query.status).filter((v): v is StudyStatus =>
      STATUS_VALUES.has(v as StudyStatus),
    ),
  )
}

function parseSortParam(): string {
  const value = route.query.sort as string | undefined
  return value && SORT_VALUES.has(value) ? value : 'default'
}

function parseNotesOnlyParam(): boolean {
  return route.query.notes === '1'
}

function parseStarredOnlyParam(): boolean {
  return route.query.starred === '1'
}

function buildQueryParams(state: {
  modules: Module[]
  difficulties: Difficulty[]
  statuses: StudyStatus[]
  starredOnly: boolean
  notesOnly: boolean
  search: string
  sort: string
}): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {}
  if (state.modules.length > 0) params.module = state.modules.join(',')
  if (state.difficulties.length > 0) params.difficulty = state.difficulties.join(',')
  if (state.statuses.length > 0) params.status = state.statuses.join(',')
  if (state.starredOnly) params.starred = '1'
  if (state.notesOnly) params.notes = '1'
  if (state.search.trim()) params.q = state.search.trim()
  if (state.sort !== 'default') params.sort = state.sort
  return params
}

// ─── Category map ───────────────────────────────────────────────────────────────

const categoryMap = ref<CategoryMap>({ ...DEFAULT_CATEGORY_MAP })

onMounted(() => {
  getCategoryMap().then((m) => {
    categoryMap.value = m
  })
})

// Listen for category map changes from settings
function onCategoryMapUpdated() {
  getCategoryMap().then((m) => {
    categoryMap.value = m
  })
}

if (typeof window !== 'undefined') {
  window.addEventListener('grimoireface_category_map_updated', onCategoryMapUpdated)
}

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('grimoireface_category_map_updated', onCategoryMapUpdated)
  }
})

const hiddenModules = computed(() =>
  getHiddenModules(categoryMap.value, studyStore.hiddenCategories),
)
const visibleQuestions = computed(() =>
  filterVisibleQuestions(allQuestions.value, hiddenModules.value),
)

const availableModules = computed<Module[]>(() => {
  const moduleSet = new Set(visibleQuestions.value.map((q) => q.module))
  const modules = [...moduleSet]

  // Build a map of module -> category order for sorting
  const moduleOrder = new Map<string, number>()
  const moduleCategory = new Map<string, string>()
  for (const cat of Object.values(categoryMap.value)) {
    for (let i = 0; i < cat.modules.length; i++) {
      const m = cat.modules[i]
      if (!moduleOrder.has(m)) {
        moduleOrder.set(m, (cat.order ?? 0) * 1000 + i)
        moduleCategory.set(m, cat.name)
      }
    }
  }

  modules.sort((a, b) => {
    const orderA = moduleOrder.get(a)
    const orderB = moduleOrder.get(b)
    if (orderA !== undefined && orderB !== undefined) return orderA - orderB
    if (orderA !== undefined) return -1
    if (orderB !== undefined) return 1
    return a.localeCompare(b)
  })

  return modules
})

/** Returns the category name for a module (from categoryMap), or null if uncategorized. */
function getModuleCategoryLabel(mod: string): string | null {
  for (const cat of Object.values(categoryMap.value)) {
    if (cat.modules.includes(mod)) return cat.name
  }
  return null
}

/** Checks whether a module is present in any built-in category. */
function isBuiltinModule(mod: string): boolean {
  for (const cat of Object.values(DEFAULT_CATEGORY_MAP)) {
    if (cat.modules.includes(mod)) return true
  }
  return false
}

// ─── Filter state ───────────────────────────────────────────────────────────────

const selectedModules = ref<Module[]>(parseModuleParams())
const selectedDifficulties = ref<Difficulty[]>(parseDifficultyParams())
const selectedStatuses = ref<StudyStatus[]>(parseStatusParams())
const starredOnly = ref(parseStarredOnlyParam())
const notesOnly = ref(parseNotesOnlyParam())
const search = ref((route.query.q as string) ?? '')
const sort = ref(parseSortParam())
const page = ref(1)
const mobileFilterOpen = ref(false)
const questionFlags = ref<QuestionFlag[]>([])
const questionNotes = ref<QuestionNote[]>([])

const searchRef = ref<HTMLInputElement | null>(null)
const mobileFilterPanelRef = ref<HTMLDivElement | null>(null)
const mobileFilterButtonRef = ref<HTMLButtonElement | null>(null)
let lastSyncedSearch = route.fullPath

// Load flags and notes
onMounted(() => {
  let cancelled = false

  async function loadMeta() {
    const [notesResult, flagsResult] = await Promise.allSettled([
      getAllQuestionNotes(),
      getAllQuestionFlags(),
    ])
    if (cancelled) return
    questionNotes.value = notesResult.status === 'fulfilled' ? notesResult.value : []
    questionFlags.value = flagsResult.status === 'fulfilled' ? flagsResult.value : []
  }

  loadMeta()
  window.addEventListener('focus', loadMeta)
  onUnmounted(() => {
    cancelled = true
    window.removeEventListener('focus', loadMeta)
  })
})

const noteByQuestionId = computed(() => {
  const map = new Map<string, QuestionNote>()
  for (const note of questionNotes.value) {
    if (note.content.trim()) map.set(note.questionId, note)
  }
  return map
})

const noteIds = computed(() => new Set(noteByQuestionId.value.keys()))
const starredIds = computed(
  () => new Set(questionFlags.value.filter((f) => f.starred).map((f) => f.questionId)),
)

// ─── Debounced search ───────────────────────────────────────────────────────────

const debouncedSearch = ref(search.value)
let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedSearch.value = val
  }, 250)
})

// ─── URL sync ───────────────────────────────────────────────────────────────────

watch(
  [selectedModules, selectedDifficulties, selectedStatuses, starredOnly, notesOnly, debouncedSearch, sort],
  () => {
    const desiredParams = buildQueryParams({
      modules: selectedModules.value,
      difficulties: selectedDifficulties.value,
      statuses: selectedStatuses.value,
      starredOnly: starredOnly.value,
      notesOnly: notesOnly.value,
      search: debouncedSearch.value,
      sort: sort.value,
    })
    const desiredSearch = new URLSearchParams(
      Object.entries(desiredParams).filter(([, v]) => v !== undefined) as [string, string][],
    ).toString()
    const currentSearch = new URLSearchParams(route.query as Record<string, string>).toString()

    if (currentSearch !== desiredSearch) {
      lastSyncedSearch = desiredSearch
      router.replace({ query: desiredParams })
    }
  },
  { deep: true },
)

// Sync from URL on back/forward
watch(
  () => route.fullPath,
  (newPath) => {
    if (newPath === lastSyncedSearch) return
    lastSyncedSearch = newPath

    const newModules = parseModuleParams()
    const newDifficulties = parseDifficultyParams()
    const newStatuses = parseStatusParams()
    const newStarred = parseStarredOnlyParam()
    const newNotes = parseNotesOnlyParam()
    const newSearch = (route.query.q as string) ?? ''
    const newSort = parseSortParam()

    if (JSON.stringify(newModules) !== JSON.stringify(selectedModules.value)) selectedModules.value = newModules
    if (JSON.stringify(newDifficulties) !== JSON.stringify(selectedDifficulties.value)) selectedDifficulties.value = newDifficulties
    if (JSON.stringify(newStatuses) !== JSON.stringify(selectedStatuses.value)) selectedStatuses.value = newStatuses
    if (starredOnly.value !== newStarred) starredOnly.value = newStarred
    if (notesOnly.value !== newNotes) notesOnly.value = newNotes
    if (search.value !== newSearch) { search.value = newSearch; debouncedSearch.value = newSearch }
    if (sort.value !== newSort) sort.value = newSort
    page.value = 1
  },
)

// ─── Keyboard shortcuts ─────────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent) {
  if (
    e.key === '/' &&
    document.activeElement !== searchRef.value &&
    !['INPUT', 'TEXTAREA'].includes((document.activeElement as HTMLElement)?.tagName ?? '')
  ) {
    e.preventDefault()
    searchRef.value?.focus()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})

function onKeydownN(e: KeyboardEvent) {
  const activeElement = document.activeElement as HTMLElement | null
  const activeTag = activeElement?.tagName ?? ''
  const isTyping =
    activeElement?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)

  if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey || isTyping) return
  e.preventDefault()
  notesOnly.value = !notesOnly.value
  page.value = 1
}

onMounted(() => {
  window.addEventListener('keydown', onKeydownN)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydownN)
})

// ─── Mobile filter drawer ───────────────────────────────────────────────────────

watch(mobileFilterOpen, (open) => {
  if (!open) return
  const previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'

  const frame = requestAnimationFrame(() => {
    mobileFilterPanelRef.value?.focus({ preventScroll: true } as any)
  })

  function onEscape(e: KeyboardEvent) {
    if (e.key === 'Escape') mobileFilterOpen.value = false
  }
  window.addEventListener('keydown', onEscape)

  onUnmounted(() => {
    cancelAnimationFrame(frame)
    window.removeEventListener('keydown', onEscape)
    document.body.style.overflow = previousOverflow
  })
})

// ─── Filter helpers ─────────────────────────────────────────────────────────────

function toggleModule(m: Module) {
  page.value = 1
  const prev = selectedModules.value
  selectedModules.value = prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
}

function toggleDifficulty(d: Difficulty) {
  page.value = 1
  const prev = selectedDifficulties.value
  selectedDifficulties.value = prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
}

function toggleStatus(s: StudyStatus) {
  page.value = 1
  const prev = selectedStatuses.value
  selectedStatuses.value = prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
}

function toggleNotesOnly() {
  page.value = 1
  notesOnly.value = !notesOnly.value
}

function toggleStarredOnly() {
  page.value = 1
  starredOnly.value = !starredOnly.value
}

function clearFilters() {
  page.value = 1
  selectedModules.value = []
  selectedDifficulties.value = []
  selectedStatuses.value = []
  starredOnly.value = false
  notesOnly.value = false
  search.value = ''
  debouncedSearch.value = ''
}

function handleSearchChange(value: string) {
  page.value = 1
  search.value = value
}

function handleSortChange(value: string) {
  page.value = 1
  sort.value = value
}

// ─── Filtered questions ─────────────────────────────────────────────────────────

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase()
}

function questionMatchesKeyword(q: Question, keyword: string): boolean {
  if (!keyword) return true
  return (
    q.question.toLowerCase().includes(keyword) ||
    q.tags.some((tag) => tag.toLowerCase().includes(keyword)) ||
    q.module.toLowerCase().includes(keyword) ||
    Boolean(q.source?.toLowerCase().includes(keyword))
  )
}

function getNoteSearchSnippet(content: string, keyword: string): string {
  const text = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_[\]`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return ''

  const index = keyword ? text.toLowerCase().indexOf(keyword) : -1
  if (index === -1) return text.length > 120 ? `${text.slice(0, 120)}...` : text

  const start = Math.max(0, index - 36)
  const end = Math.min(text.length, index + keyword.length + 64)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < text.length ? '...' : ''
  return `${prefix}${text.slice(start, end)}${suffix}`
}

function sortQuestionsByRecentNote(
  questions: Question[],
  noteMap: Map<string, QuestionNote>,
): Question[] {
  return [...questions].sort((a, b) => {
    const aUpdatedAt = noteMap.get(a.id)?.updatedAt ?? 0
    const bUpdatedAt = noteMap.get(b.id)?.updatedAt ?? 0
    return bUpdatedAt - aUpdatedAt
  })
}

const filteredResult = computed(() => {
  let structuralQuestions = visibleQuestions.value

  if (selectedModules.value.length > 0) {
    const set = new Set(selectedModules.value)
    structuralQuestions = structuralQuestions.filter((q) => set.has(q.module))
  }
  if (selectedDifficulties.value.length > 0) {
    const set = new Set(selectedDifficulties.value)
    structuralQuestions = structuralQuestions.filter((q) => set.has(q.difficulty))
  }
  if (selectedStatuses.value.length > 0) {
    const set = new Set(selectedStatuses.value)
    structuralQuestions = structuralQuestions.filter((q) => {
      const status = studyStore.records[q.id]?.status ?? 'unlearned'
      return set.has(status)
    })
  }

  // Apply non-note-updated sort at the structural level
  if (sort.value !== 'note-updated') {
    switch (sort.value) {
      case 'difficulty-asc':
        structuralQuestions = [...structuralQuestions].sort((a, b) => a.difficulty - b.difficulty)
        break
      case 'difficulty-desc':
        structuralQuestions = [...structuralQuestions].sort((a, b) => b.difficulty - a.difficulty)
        break
      case 'module':
        structuralQuestions = [...structuralQuestions].sort((a, b) => a.module.localeCompare(b.module))
        break
    }
  }

  const keyword = normalizeKeyword(debouncedSearch.value)
  const noteSearchMatchedIds = new Set<string>()
  const noteSearchSnippets = new Map<string, string>()
  const searchedQuestions = keyword
    ? structuralQuestions.filter((q) => {
        const questionMatched = questionMatchesKeyword(q, keyword)
        const noteContent = noteByQuestionId.value.get(q.id)?.content
        const noteMatched = noteContent?.toLowerCase().includes(keyword)
        if (noteMatched && noteContent) {
          noteSearchMatchedIds.add(q.id)
          noteSearchSnippets.set(q.id, getNoteSearchSnippet(noteContent, keyword))
        }
        return questionMatched || noteMatched
      })
    : structuralQuestions

  let questions = searchedQuestions
  if (starredOnly.value) {
    questions = questions.filter((q) => starredIds.value.has(q.id))
  }
  if (notesOnly.value) {
    questions = questions.filter((q) => noteIds.value.has(q.id))
  }
  if (sort.value === 'note-updated') {
    questions = sortQuestionsByRecentNote(questions, noteByQuestionId.value)
  }

  return { questions, noteSearchMatchedIds, noteSearchSnippets }
})

const filteredQuestions = computed(() => filteredResult.value.questions)
const noteSearchMatchedIds = computed(() => filteredResult.value.noteSearchMatchedIds)
const noteSearchSnippets = computed(() => filteredResult.value.noteSearchSnippets)

const notedQuestionCount = computed(() =>
  visibleQuestions.value.reduce((count, q) => count + (noteIds.value.has(q.id) ? 1 : 0), 0),
)
const starredQuestionCount = computed(() =>
  visibleQuestions.value.reduce((count, q) => count + (starredIds.value.has(q.id) ? 1 : 0), 0),
)

const currentSessionIds = computed(() => filteredQuestions.value.map((q) => q.id))

function handleStartFilteredSession() {
  if (currentSessionIds.value.length === 0) return
  router.push(createPracticeSessionPath(currentSessionIds.value[0], currentSessionIds.value))
}

// ─── Pagination ─────────────────────────────────────────────────────────────────

const PAGE_SIZE_KEY = 'grimoireface_questionlist_page_size'
const PAGE_SIZE_MIN = 5
const PAGE_SIZE_MAX = 200

function loadPageSize(): number {
  try {
    const v = localStorage.getItem(PAGE_SIZE_KEY)
    if (v) {
      const n = parseInt(v, 10)
      if (!Number.isNaN(n) && n >= PAGE_SIZE_MIN && n <= PAGE_SIZE_MAX) return n
    }
  } catch {}
  return 30
}

function savePageSize(n: number): void {
  try { localStorage.setItem(PAGE_SIZE_KEY, String(n)) } catch {}
}

const pageSize = ref(loadPageSize())

function setPageSize(n: number) {
  const clamped = Math.max(PAGE_SIZE_MIN, Math.min(PAGE_SIZE_MAX, Math.round(n)))
  pageSize.value = clamped
  savePageSize(clamped)
  page.value = 1
}

const totalPages = computed(() => Math.max(1, Math.ceil(filteredQuestions.value.length / pageSize.value)))

const pagedQuestions = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredQuestions.value.slice(start, start + pageSize.value)
})

const hasMore = computed(() => page.value < totalPages.value)

// Reset to page 1 when filters change (page already resets in toggle* handlers)
// Scroll to top when page changes
watch(page, () => {
  window.scrollTo({ top: 0, behavior: 'smooth' })
})

// Keep selectedModules valid when availableModules changes
watch([() => allQuestions.value.length, availableModules], () => {
  if (allQuestions.value.length === 0 && availableModules.value.length === 0) return
  selectedModules.value = selectedModules.value.filter((m) => availableModules.value.includes(m))
})

const hasFilters = computed(
  () =>
    selectedModules.value.length > 0 ||
    selectedDifficulties.value.length > 0 ||
    selectedStatuses.value.length > 0 ||
    starredOnly.value ||
    notesOnly.value ||
    debouncedSearch.value.length > 0,
)

const allHidden = computed(() => allQuestions.value.length > 0 && visibleQuestions.value.length === 0)

const emptyStateTitle = computed(() => {
  if (allHidden.value) return '所有题库已关闭展示'
  if (!hasFilters.value) return '题库为空'
  if (starredOnly.value && starredQuestionCount.value === 0) return '还没有重点题'
  if (notesOnly.value && notedQuestionCount.value === 0) return '还没有题目笔记'
  return '没有匹配的题目'
})

const emptyStateDescription = computed(() => {
  if (allHidden.value)
    return '在「设置 → 刷题偏好 → 题库展示」中启用题库后，这里会重新显示题目'
  if (!hasFilters.value) return '请前往「导入题目」页面加载题库'
  if (starredOnly.value && starredQuestionCount.value === 0)
    return '在题目详情中标记重点题后，可在这里集中复习'
  if (notesOnly.value && notedQuestionCount.value === 0)
    return '打开任意题目的笔记入口，记录理解或把 AI 复盘保存为笔记'
  if (starredOnly.value) return '当前筛选条件下没有重点题，可以清除部分条件再试'
  if (notesOnly.value) return '当前筛选条件下没有带笔记的题目，可以清除部分条件再试'
  return '试试调整筛选条件，或搜索题目、标签、模块和笔记内容'
})

function getStatus(qId: string): StudyStatus {
  return studyStore.records[qId]?.status ?? 'unlearned'
}
</script>

<template>
  <div class="page-container">
    <!-- Page header -->
    <div
      class="animate-fade-in"
      style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px"
    >
      <div>
        <h1
          style="
            font-size: 20px;
            font-weight: 700;
            color: var(--text);
            letter-spacing: -0.015em;
          "
        >
          题库
        </h1>
        <p style="font-size: 12px; color: var(--text-3); margin-top: 2px">
          <template v-if="hasFilters">
            当前显示 {{ filteredQuestions.length }} / {{ visibleQuestions.length }} 道题
          </template>
          <template v-else>共 {{ visibleQuestions.length }} 道题</template>
        </p>
      </div>
      <div style="display: flex; align-items: center; gap: 8px">
        <!-- Mobile filter toggle -->
        <button
          ref="mobileFilterButtonRef"
          type="button"
          class="mobile-filter-btn"
          @click="mobileFilterOpen = !mobileFilterOpen"
          style="
            display: none;
            align-items: center;
            gap: 6px;
            flex-shrink: 0;
            padding: 6px 12px;
            border-radius: 8px;
            white-space: nowrap;
            border: 1px solid var(--border);
            color: var(--text-2);
            background: var(--surface);
            cursor: pointer;
            transition: background 0.15s;
          "
        >
          <svg
            width="13" height="13" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"
            style="flex-shrink: 0"
          >
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="8" y1="12" x2="16" y2="12" />
            <line x1="10" y1="18" x2="14" y2="18" />
          </svg>
          <span style="white-space: nowrap">筛选</span>
          <span
            v-if="hasFilters"
            style="
              width: 6px;
              height: 6px;
              border-radius: 50%;
              background: var(--primary);
              display: inline-block;
              flex-shrink: 0;
            "
          />
        </button>

        <!-- Sort -->
        <select
          :value="sort"
          @change="handleSortChange(($event.target as HTMLSelectElement).value)"
          style="
            padding: 6px 10px;
            border-radius: 8px;
            background: var(--surface);
            border: 1px solid var(--border);
            color: var(--text);
            cursor: pointer;
            outline: none;
            font-size: 13px;
          "
        >
          <option value="default">默认排序</option>
          <option value="note-updated">最近笔记</option>
          <option value="difficulty-asc">难度↑</option>
          <option value="difficulty-desc">难度↓</option>
          <option value="module">按模块</option>
        </select>

        <button
          v-if="currentSessionIds.length > 0"
          type="button"
          class="question-list-start-btn"
          @click="handleStartFilteredSession"
          :style="{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            height: '28px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 600,
            border: 'none',
            background: 'var(--primary)',
            color: 'white',
            boxShadow: 'var(--shadow-md)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'background 0.15s',
          }"
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round"
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          练习当前
          <span class="question-list-start-count">{{ currentSessionIds.length }}</span>
        </button>
      </div>
    </div>

    <!-- Search bar -->
    <div class="animate-fade-in" style="position: relative; margin-bottom: 16px">
      <svg
        width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"
        style="
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-3);
          pointer-events: none;
        "
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        ref="searchRef"
        type="search"
        placeholder="搜索题目、标签、模块或笔记…"
        :value="search"
        @input="handleSearchChange(($event.target as HTMLInputElement).value)"
        style="
          width: 100%;
          padding: 10px 60px 10px 36px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text);
          font-size: 14px;
          outline: none;
          box-shadow: var(--shadow-xs);
          box-sizing: border-box;
        "
      />
      <div
        style="
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          gap: 6px;
        "
      >
        <button
          v-if="search"
          type="button"
          @click="handleSearchChange('')"
          style="
            color: var(--text-3);
            background: none;
            border: none;
            cursor: pointer;
            display: flex;
            padding: 2px;
          "
        >
          <svg
            width="13" height="13" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <span v-else class="kbd">/</span>
      </div>
    </div>

    <!-- Active filter chips -->
    <div
      v-if="hasFilters"
      class="animate-fade-in"
      style="
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      "
    >
      <button
        v-if="starredOnly"
        type="button"
        @click="toggleStarredOnly()"
        style="
          display: flex; align-items: center; gap: 4px;
          padding: 3px 10px; border-radius: 99px; font-size: 12px; font-weight: 500;
          background: rgba(245,158,11,0.1); color: #b45309;
          border: 1px solid rgba(245,158,11,0.22);
          cursor: pointer; transition: all 0.12s;
        "
      >
        重点题
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <button
        v-if="notesOnly"
        type="button"
        @click="toggleNotesOnly()"
        style="
          display: flex; align-items: center; gap: 4px;
          padding: 3px 10px; border-radius: 99px; font-size: 12px; font-weight: 500;
          background: rgba(var(--primary-rgb), 0.08); color: var(--primary);
          border: 1px solid rgba(var(--primary-rgb), 0.18);
          cursor: pointer; transition: all 0.12s;
        "
      >
        有笔记
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <button
        v-for="m in selectedModules" :key="m"
        type="button"
        @click="toggleModule(m)"
        style="
          display: flex; align-items: center; gap: 4px;
          padding: 3px 10px; border-radius: 99px; font-size: 12px; font-weight: 500;
          background: var(--primary-light); color: var(--primary);
          border: 1px solid rgba(var(--primary-rgb), 0.2);
          cursor: pointer; transition: all 0.12s;
        "
      >
        {{ m }}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <button
        v-for="d in selectedDifficulties" :key="d"
        type="button"
        @click="toggleDifficulty(d)"
        :style="{
          display: 'flex', alignItems: 'center', gap: '4px',
          padding: '3px 10px', borderRadius: '99px', fontSize: '12px', fontWeight: 500,
          border: '1px solid',
          cursor: 'pointer', transition: 'all 0.15s',
          color: DIFFICULTY_STYLES[d].color,
          background: DIFFICULTY_STYLES[d].background,
          borderColor: DIFFICULTY_STYLES[d].borderColor,
        }"
      >
        {{ DIFFICULTY_LABELS[d] }}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <button
        v-for="s in selectedStatuses" :key="s"
        type="button"
        @click="toggleStatus(s)"
        :style="{
          display: 'flex', alignItems: 'center', gap: '4px',
          padding: '3px 10px', borderRadius: '99px', fontSize: '12px', fontWeight: 500,
          border: '1px solid',
          cursor: 'pointer', transition: 'all 0.15s',
          color: STATUS_STYLES[s].color,
          background: STATUS_STYLES[s].background,
          borderColor: STATUS_STYLES[s].borderColor,
        }"
      >
        {{ STATUS_LABELS[s] }}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <button
        v-if="debouncedSearch"
        type="button"
        @click="handleSearchChange('')"
        style="
          display: flex; align-items: center; gap: 4px;
          padding: 3px 10px; border-radius: 99px; font-size: 12px; font-weight: 500;
          background: var(--surface-3); color: var(--text-2);
          border: 1px solid var(--border);
          cursor: pointer;
        "
      >
        "{{ debouncedSearch }}"
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <!-- Main layout -->
    <div style="display: flex; gap: 20px; align-items: flex-start">
      <!-- Sidebar filter (desktop) -->
      <div
        class="ql-sidebar"
        style="
          position: sticky;
          top: calc(var(--navbar-h) + 20px);
          width: 200px;
          flex-shrink: 0;
        "
      >
        <aside
          style="
            width: 100%;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            gap: 20px;
          "
        >
          <!-- Header -->
          <div style="display: flex; align-items: center; justify-content: space-between">
            <span
              style="
                font-size: 11px;
                font-weight: 600;
                color: var(--text-3);
                text-transform: uppercase;
                letter-spacing: 0.06em;
              "
            >筛选</span>
            <button
              v-if="selectedModules.length > 0 || selectedDifficulties.length > 0 || selectedStatuses.length > 0 || starredOnly || notesOnly"
              type="button"
              @click="clearFilters"
              style="
                font-size: 12px; color: var(--primary);
                background: none; border: none; cursor: pointer; padding: 0;
              "
            >清除全部</button>
          </div>

          <!-- Results count -->
          <div style="font-size: 12px; color: var(--text-3)">
            显示 <span style="font-weight: 600; color: var(--text)">{{ filteredQuestions.length }}</span> / {{ visibleQuestions.length }} 题
          </div>

          <!-- Difficulty -->
          <div>
            <p
              style="
                font-size: 11px; font-weight: 500; color: var(--text-3);
                margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em;
              "
            >难度</p>
            <div style="display: flex; flex-direction: column; gap: 2px">
              <button
                v-for="d in ([1, 2, 3] as Difficulty[])"
                :key="d"
                type="button"
                @click="toggleDifficulty(d)"
                :style="{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '5px 10px', borderRadius: '8px',
                  background: selectedDifficulties.includes(d) ? 'var(--surface-2)' : 'transparent',
                  border: 'none', cursor: 'pointer', transition: 'background 0.12s',
                }"
                @mouseenter="(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }"
                @mouseleave="(e: MouseEvent) => { if (!selectedDifficulties.includes(d)) (e.currentTarget as HTMLElement).style.background = 'transparent' }"
              >
                <span
                  :style="{
                    fontSize: '11px', fontWeight: 500,
                    padding: '2px 8px', borderRadius: '6px',
                    border: '1px solid',
                    color: DIFFICULTY_STYLES[d].color,
                    background: DIFFICULTY_STYLES[d].background,
                    borderColor: DIFFICULTY_STYLES[d].borderColor,
                  }"
                >{{ DIFFICULTY_LABELS[d] }}</span>
                <svg
                  v-if="selectedDifficulties.includes(d)"
                  width="12" height="12" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="3"
                  stroke-linecap="round" stroke-linejoin="round"
                  style="color: var(--primary); margin-left: auto"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Status -->
          <div>
            <p
              style="
                font-size: 11px; font-weight: 500; color: var(--text-3);
                margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em;
              "
            >学习状态</p>
            <div style="display: flex; flex-direction: column; gap: 2px">
              <button
                v-for="s in (['unlearned', 'review', 'mastered'] as StudyStatus[])"
                :key="s"
                type="button"
                @click="toggleStatus(s)"
                :style="{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '5px 10px', borderRadius: '8px',
                  background: selectedStatuses.includes(s) ? 'var(--surface-2)' : 'transparent',
                  border: 'none', cursor: 'pointer', transition: 'background 0.12s',
                }"
                @mouseenter="(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)' }"
                @mouseleave="(e: MouseEvent) => { if (!selectedStatuses.includes(s)) (e.currentTarget as HTMLElement).style.background = 'transparent' }"
              >
                <span
                  :style="{
                    fontSize: '11px', fontWeight: 500,
                    padding: '2px 8px', borderRadius: '6px',
                    border: '1px solid',
                    color: STATUS_STYLES[s].color,
                    background: STATUS_STYLES[s].background,
                    borderColor: STATUS_STYLES[s].borderColor,
                  }"
                >{{ STATUS_LABELS[s] }}</span>
                <svg
                  v-if="selectedStatuses.includes(s)"
                  width="12" height="12" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="3"
                  stroke-linecap="round" stroke-linejoin="round"
                  style="color: var(--primary); margin-left: auto"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Module -->
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px">
              <p
                style="
                  font-size: 11px; font-weight: 500; color: var(--text-3);
                  text-transform: uppercase; letter-spacing: 0.05em;
                "
              >模块</p>
              <span
                v-if="availableModules.some(m => !isBuiltinModule(m))"
                style="
                  font-size: 10px; padding: 1px 5px; border-radius: 4px;
                  background: var(--primary-light); color: var(--primary);
                  border: 1px solid rgba(var(--primary-rgb),0.2);
                "
              >含自定义</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 1px">
              <button
                v-for="mod in availableModules"
                :key="mod"
                type="button"
                @click="toggleModule(mod)"
                :style="{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '6px 10px', borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: selectedModules.includes(mod) ? 500 : 400,
                  color: selectedModules.includes(mod) ? 'var(--primary)' : 'var(--text-2)',
                  background: selectedModules.includes(mod) ? 'var(--primary-light)' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  textAlign: 'left', transition: 'background 0.12s, color 0.12s',
                  width: '100%',
                }"
                @mouseenter="(e: MouseEvent) => {
                  if (!selectedModules.includes(mod)) {
                    (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--text)';
                  }
                }"
                @mouseleave="(e: MouseEvent) => {
                  if (!selectedModules.includes(mod)) {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                    (e.currentTarget as HTMLElement).style.color = 'var(--text-2)';
                  }
                }"
              >
                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ mod }}</span>
                <span
                  v-if="getModuleCategoryLabel(mod)"
                  :style="{
                    fontSize: '9px', padding: '1px 4px', borderRadius: '3px',
                    background: selectedModules.includes(mod) ? 'rgba(255,255,255,0.2)' : 'var(--surface-3)',
                    color: selectedModules.includes(mod) ? 'rgba(255,255,255,0.8)' : 'var(--text-3)',
                    flexShrink: 0,
                  }"
                >{{ getModuleCategoryLabel(mod) }}</span>
                <span
                  v-if="!isBuiltinModule(mod)"
                  :style="{
                    fontSize: '9px', padding: '1px 4px', borderRadius: '3px',
                    background: selectedModules.includes(mod) ? 'rgba(255,255,255,0.2)' : 'var(--surface-3)',
                    color: selectedModules.includes(mod) ? 'rgba(255,255,255,0.8)' : 'var(--text-3)',
                    flexShrink: 0,
                  }"
                >自定义</span>
                <svg
                  v-if="selectedModules.includes(mod)"
                  width="12" height="12" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="3"
                  stroke-linecap="round" stroke-linejoin="round"
                  style="flex-shrink: 0"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Review -->
          <div>
            <p
              style="
                font-size: 11px; font-weight: 500; color: var(--text-3);
                margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em;
              "
            >复盘</p>
            <button
              type="button"
              :aria-pressed="starredOnly"
              @click="toggleStarredOnly()"
              :style="{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '8px', width: '100%', minHeight: '36px',
                padding: '7px 10px', borderRadius: '10px',
                border: starredOnly
                  ? '1px solid rgba(245,158,11,0.35)'
                  : '1px solid var(--border-subtle)',
                background: starredOnly ? 'rgba(245,158,11,0.1)' : 'var(--surface)',
                color: starredOnly ? '#b45309' : 'var(--text-2)',
                cursor: 'pointer', transition: 'background 0.12s, border-color 0.12s, color 0.12s',
                marginBottom: '6px',
              }"
            >
              <span style="display: inline-flex; align-items: center; gap: 7px; min-width: 0">
                <svg
                  width="13" height="13" viewBox="0 0 24 24"
                  :fill="starredOnly ? 'currentColor' : 'none'"
                  stroke="currentColor" stroke-width="2.1"
                  stroke-linecap="round" stroke-linejoin="round"
                  style="flex-shrink: 0"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <span
                  :style="{
                    fontSize: '13px', fontWeight: starredOnly ? 600 : 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }"
                >只看重点题</span>
              </span>
              <span style="display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0">
                <span
                  :style="{
                    minWidth: '20px', padding: '1px 6px', borderRadius: '99px',
                    fontSize: '11px', fontWeight: 600, lineHeight: 1.45, textAlign: 'center',
                    background: starredOnly ? 'rgba(255,255,255,0.55)' : 'var(--surface-2)',
                    color: starredOnly ? '#b45309' : 'var(--text-3)',
                  }"
                >{{ starredQuestionCount }}</span>
                <svg
                  v-if="starredOnly"
                  width="12" height="12" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="3"
                  stroke-linecap="round" stroke-linejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            </button>
            <button
              type="button"
              :aria-pressed="notesOnly"
              @click="toggleNotesOnly()"
              :style="{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '8px', width: '100%', minHeight: '36px',
                padding: '7px 10px', borderRadius: '10px',
                border: notesOnly
                  ? '1px solid rgba(var(--primary-rgb), 0.28)'
                  : '1px solid var(--border-subtle)',
                background: notesOnly ? 'var(--primary-light)' : 'var(--surface)',
                color: notesOnly ? 'var(--primary)' : 'var(--text-2)',
                cursor: 'pointer', transition: 'background 0.12s, border-color 0.12s, color 0.12s',
              }"
            >
              <span style="display: inline-flex; align-items: center; gap: 7px; min-width: 0">
                <svg
                  width="13" height="13" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="2.2"
                  stroke-linecap="round" stroke-linejoin="round"
                  style="flex-shrink: 0"
                >
                  <path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5z" />
                  <path d="M8 7h6" />
                  <path d="M8 11h8" />
                </svg>
                <span
                  :style="{
                    fontSize: '13px', fontWeight: notesOnly ? 600 : 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }"
                >只看有笔记</span>
              </span>
              <span style="display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0">
                <span
                  :style="{
                    minWidth: '20px', padding: '1px 6px', borderRadius: '99px',
                    fontSize: '11px', fontWeight: 600, lineHeight: 1.45, textAlign: 'center',
                    background: notesOnly ? 'rgba(255,255,255,0.55)' : 'var(--surface-2)',
                    color: notesOnly ? 'var(--primary)' : 'var(--text-3)',
                  }"
                >{{ notedQuestionCount }}</span>
                <svg
                  v-if="notesOnly"
                  width="12" height="12" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="3"
                  stroke-linecap="round" stroke-linejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            </button>
          </div>
        </aside>
      </div>

      <!-- Mobile filter drawer -->
      <template v-if="mobileFilterOpen">
        <button
          type="button"
          aria-label="关闭筛选面板"
          style="
            position: fixed; inset: 0; z-index: 40;
            background: rgba(0,0,0,0.2); backdrop-filter: blur(2px);
            border: none; padding: 0; margin: 0; cursor: pointer;
          "
          @click="mobileFilterOpen = false"
        />
        <div
          ref="mobileFilterPanelRef"
          role="dialog"
          aria-modal="true"
          aria-label="题库筛选"
          tabindex="-1"
          style="
            position: fixed; left: 0; right: 0; bottom: 0;
            z-index: 50; outline: none;
          "
          class="animate-slide-up"
        >
          <div
            class="glass"
            style="
              border-radius: 18px 18px 0 0; padding: 20px;
              box-shadow: var(--shadow-xl);
              max-height: 80dvh; overflow-y: auto;
              overscroll-behavior: contain;
              -webkit-overflow-scrolling: touch;
            "
          >
            <div
              style="
                display: flex; align-items: center;
                justify-content: space-between; margin-bottom: 16px;
              "
            >
              <span style="font-weight: 600; font-size: 15px; color: var(--text)">筛选</span>
              <button
                type="button"
                @click="mobileFilterOpen = false"
                style="
                  font-size: 13px; padding: 6px 12px;
                  background: transparent; border: none;
                  color: var(--text-2); cursor: pointer;
                  border-radius: 8px;
                "
              >完成</button>
            </div>
            <!-- Reuse the same filter panel content inline for mobile -->
            <aside
              style="
                width: 100%;
                flex-shrink: 0;
                display: flex;
                flex-direction: column;
                gap: 20px;
              "
            >
              <div style="display: flex; align-items: center; justify-content: space-between">
                <span
                  style="
                    font-size: 11px; font-weight: 600; color: var(--text-3);
                    text-transform: uppercase; letter-spacing: 0.06em;
                  "
                >筛选</span>
                <button
                  v-if="selectedModules.length > 0 || selectedDifficulties.length > 0 || selectedStatuses.length > 0 || starredOnly || notesOnly"
                  type="button"
                  @click="clearFilters"
                  style="font-size: 12px; color: var(--primary); background: none; border: none; cursor: pointer; padding: 0"
                >清除全部</button>
              </div>
              <div style="font-size: 12px; color: var(--text-3)">
                显示 <span style="font-weight: 600; color: var(--text)">{{ filteredQuestions.length }}</span> / {{ visibleQuestions.length }} 题
              </div>

              <!-- Difficulty -->
              <div>
                <p style="font-size: 11px; font-weight: 500; color: var(--text-3); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em">难度</p>
                <div style="display: flex; flex-direction: column; gap: 2px">
                  <button
                    v-for="d in ([1, 2, 3] as Difficulty[])" :key="d" type="button"
                    @click="toggleDifficulty(d)"
                    :style="{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '5px 10px', borderRadius: '8px',
                      background: selectedDifficulties.includes(d) ? 'var(--surface-2)' : 'transparent',
                      border: 'none', cursor: 'pointer',
                    }"
                  >
                    <span :style="{ fontSize: '11px', fontWeight: 500, padding: '2px 8px', borderRadius: '6px', border: '1px solid', color: DIFFICULTY_STYLES[d].color, background: DIFFICULTY_STYLES[d].background, borderColor: DIFFICULTY_STYLES[d].borderColor }">{{ DIFFICULTY_LABELS[d] }}</span>
                    <svg v-if="selectedDifficulties.includes(d)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary); margin-left: auto"><polyline points="20 6 9 17 4 12" /></svg>
                  </button>
                </div>
              </div>

              <!-- Status -->
              <div>
                <p style="font-size: 11px; font-weight: 500; color: var(--text-3); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em">学习状态</p>
                <div style="display: flex; flex-direction: column; gap: 2px">
                  <button
                    v-for="s in (['unlearned', 'review', 'mastered'] as StudyStatus[])" :key="s" type="button"
                    @click="toggleStatus(s)"
                    :style="{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '5px 10px', borderRadius: '8px',
                      background: selectedStatuses.includes(s) ? 'var(--surface-2)' : 'transparent',
                      border: 'none', cursor: 'pointer',
                    }"
                  >
                    <span :style="{ fontSize: '11px', fontWeight: 500, padding: '2px 8px', borderRadius: '6px', border: '1px solid', color: STATUS_STYLES[s].color, background: STATUS_STYLES[s].background, borderColor: STATUS_STYLES[s].borderColor }">{{ STATUS_LABELS[s] }}</span>
                    <svg v-if="selectedStatuses.includes(s)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary); margin-left: auto"><polyline points="20 6 9 17 4 12" /></svg>
                  </button>
                </div>
              </div>

              <!-- Module -->
              <div>
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px">
                  <p style="font-size: 11px; font-weight: 500; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.05em">模块</p>
                  <span
                    v-if="availableModules.some(m => !isBuiltinModule(m))"
                    style="font-size: 10px; padding: 1px 5px; border-radius: 4px; background: var(--primary-light); color: var(--primary); border: 1px solid rgba(var(--primary-rgb),0.2)"
                  >含自定义</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 1px">
                  <button
                    v-for="mod in availableModules" :key="mod" type="button"
                    @click="toggleModule(mod)"
                    :style="{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '6px 10px', borderRadius: '8px', fontSize: '13px',
                      fontWeight: selectedModules.includes(mod) ? 500 : 400,
                      color: selectedModules.includes(mod) ? 'var(--primary)' : 'var(--text-2)',
                      background: selectedModules.includes(mod) ? 'var(--primary-light)' : 'transparent',
                      border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
                    }"
                  >
                    <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ mod }}</span>
                    <span v-if="getModuleCategoryLabel(mod)" :style="{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: selectedModules.includes(mod) ? 'rgba(255,255,255,0.2)' : 'var(--surface-3)', color: selectedModules.includes(mod) ? 'rgba(255,255,255,0.8)' : 'var(--text-3)', flexShrink: 0 }">{{ getModuleCategoryLabel(mod) }}</span>
                    <span v-if="!isBuiltinModule(mod)" :style="{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: selectedModules.includes(mod) ? 'rgba(255,255,255,0.2)' : 'var(--surface-3)', color: selectedModules.includes(mod) ? 'rgba(255,255,255,0.8)' : 'var(--text-3)', flexShrink: 0 }">自定义</span>
                    <svg v-if="selectedModules.includes(mod)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0"><polyline points="20 6 9 17 4 12" /></svg>
                  </button>
                </div>
              </div>

              <!-- Review -->
              <div>
                <p style="font-size: 11px; font-weight: 500; color: var(--text-3); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em">复盘</p>
                <button
                  type="button" :aria-pressed="starredOnly" @click="toggleStarredOnly()"
                  :style="{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: '8px', width: '100%', minHeight: '36px',
                    padding: '7px 10px', borderRadius: '10px',
                    border: starredOnly ? '1px solid rgba(245,158,11,0.35)' : '1px solid var(--border-subtle)',
                    background: starredOnly ? 'rgba(245,158,11,0.1)' : 'var(--surface)',
                    color: starredOnly ? '#b45309' : 'var(--text-2)',
                    cursor: 'pointer', marginBottom: '6px',
                  }"
                >
                  <span style="display: inline-flex; align-items: center; gap: 7px; min-width: 0">
                    <svg width="13" height="13" viewBox="0 0 24 24" :fill="starredOnly ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                    <span :style="{ fontSize: '13px', fontWeight: starredOnly ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }">只看重点题</span>
                  </span>
                  <span style="display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0">
                    <span :style="{ minWidth: '20px', padding: '1px 6px', borderRadius: '99px', fontSize: '11px', fontWeight: 600, lineHeight: 1.45, textAlign: 'center', background: starredOnly ? 'rgba(255,255,255,0.55)' : 'var(--surface-2)', color: starredOnly ? '#b45309' : 'var(--text-3)' }">{{ starredQuestionCount }}</span>
                    <svg v-if="starredOnly" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </span>
                </button>
                <button
                  type="button" :aria-pressed="notesOnly" @click="toggleNotesOnly()"
                  :style="{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: '8px', width: '100%', minHeight: '36px',
                    padding: '7px 10px', borderRadius: '10px',
                    border: notesOnly ? '1px solid rgba(var(--primary-rgb), 0.28)' : '1px solid var(--border-subtle)',
                    background: notesOnly ? 'var(--primary-light)' : 'var(--surface)',
                    color: notesOnly ? 'var(--primary)' : 'var(--text-2)',
                    cursor: 'pointer',
                  }"
                >
                  <span style="display: inline-flex; align-items: center; gap: 7px; min-width: 0">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0"><path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5z" /><path d="M8 7h6" /><path d="M8 11h8" /></svg>
                    <span :style="{ fontSize: '13px', fontWeight: notesOnly ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }">只看有笔记</span>
                  </span>
                  <span style="display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0">
                    <span :style="{ minWidth: '20px', padding: '1px 6px', borderRadius: '99px', fontSize: '11px', fontWeight: 600, lineHeight: 1.45, textAlign: 'center', background: notesOnly ? 'rgba(255,255,255,0.55)' : 'var(--surface-2)', color: notesOnly ? 'var(--primary)' : 'var(--text-3)' }">{{ notedQuestionCount }}</span>
                    <svg v-if="notesOnly" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </span>
                </button>
              </div>
            </aside>
          </div>
        </div>
      </template>

      <!-- Question list -->
      <div style="flex: 1; min-width: 0">
        <!-- Loading skeleton -->
        <div v-if="initializing" style="display: flex; flex-direction: column; gap: 8px">
          <div
            v-for="i in 8" :key="i"
            class="card"
            style="padding: 14px 16px; display: flex; align-items: flex-start; gap: 14px"
          >
            <div
              class="skeleton"
              style="width:3px;height:52px;border-radius:4px;"
              :style="{ background: 'var(--surface-3)', animation: 'skeleton-pulse 1.6s var(--ease-in-out) infinite' }"
            />
            <div style="flex: 1; display: flex; flex-direction: column; gap: 8px">
              <div class="skeleton" style="width:75%;height:14px;border-radius:4px" :style="{ background: 'var(--surface-3)', animation: 'skeleton-pulse 1.6s var(--ease-in-out) infinite' }" />
              <div class="skeleton" style="width:45%;height:12px;border-radius:4px" :style="{ background: 'var(--surface-3)', animation: 'skeleton-pulse 1.6s var(--ease-in-out) infinite' }" />
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else-if="filteredQuestions.length === 0" class="card" style="padding: 60px 20px; text-align: center">
          <p style="font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 6px">{{ emptyStateTitle }}</p>
          <p style="font-size: 13px; color: var(--text-3); margin-bottom: hasFilters ? 20 : 6px">
            {{ emptyStateDescription }}
          </p>
          <button
            v-if="hasFilters"
            type="button"
            @click="clearFilters"
            style="
              padding: 6px 16px; height: 28px; border-radius: 8px;
              font-size: 12px; font-weight: 500; cursor: pointer;
              background: var(--surface); border: 1px solid var(--border); color: var(--text);
            "
          >清除筛选</button>
          <RouterLink v-else to="/import">
            <button
              type="button"
              style="
                padding: 6px 16px; height: 28px; border-radius: 8px;
                font-size: 12px; font-weight: 600; cursor: pointer; border: none;
                background: var(--primary); color: white; box-shadow: var(--shadow-md);
              "
            >去导入</button>
          </RouterLink>
        </div>

        <!-- Question cards -->
        <div v-else style="display: flex; flex-direction: column; gap: 6px">
          <RouterLink
            v-for="(q, i) in pagedQuestions"
            :key="q.id"
            :to="`/questions/${q.id}${noteSearchMatchedIds.has(q.id) ? '?note=1' : ''}`"
            class="animate-fade-in card card-interactive"
            style="
              display: flex; align-items: flex-start; gap: 14px;
              padding: 14px 16px; text-decoration: none;
            "
            :style="{ animationDelay: `${Math.min(i * 0.025, 0.3)}s` }"
          >
            <!-- Status indicator strip -->
            <div
              :style="{
                width: '3px',
                alignSelf: 'stretch',
                borderRadius: '99px',
                flexShrink: 0,
                background:
                  getStatus(q.id) === 'mastered'
                    ? 'var(--success)'
                    : getStatus(q.id) === 'review'
                      ? 'var(--warning)'
                      : 'var(--border)',
                opacity: getStatus(q.id) === 'unlearned' ? 0.4 : 1,
              }"
            />

            <div style="flex: 1; min-width: 0">
              <!-- Question text -->
              <p
                style="
                  font-size: 14px; font-weight: 500; color: var(--text);
                  line-height: 1.55; margin-bottom: 8px;
                  overflow: hidden; display: -webkit-box;
                  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
                "
              >{{ q.question }}</p>

              <!-- Meta row -->
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap">
                <span style="font-size: 12px; color: var(--text-3)">{{ q.module }}</span>
                <span style="color: var(--border); font-size: 12px">·</span>
                <span
                  :style="{
                    fontSize: '11px', fontWeight: 500,
                    padding: '2px 7px', borderRadius: '5px',
                    border: '1px solid',
                    color: DIFFICULTY_STYLES[q.difficulty].color,
                    background: DIFFICULTY_STYLES[q.difficulty].background,
                    borderColor: DIFFICULTY_STYLES[q.difficulty].borderColor,
                  }"
                >{{ DIFFICULTY_LABELS[q.difficulty] }}</span>

                <span
                  v-if="getStatus(q.id) !== 'unlearned'"
                  :style="{
                    fontSize: '11px', fontWeight: 500,
                    padding: '2px 7px', borderRadius: '5px',
                    border: '1px solid',
                    color: STATUS_STYLES[getStatus(q.id)].color,
                    background: STATUS_STYLES[getStatus(q.id)].background,
                    borderColor: STATUS_STYLES[getStatus(q.id)].borderColor,
                  }"
                >{{ STATUS_LABELS[getStatus(q.id)] }}</span>

                <span
                  v-if="starredIds.has(q.id)"
                  title="重点题"
                  style="
                    display: inline-flex; align-items: center; gap: 4px;
                    font-size: 11px; font-weight: 500;
                    padding: 1px 7px; border-radius: 5px;
                    background: rgba(245,158,11,0.1); color: #b45309;
                    border: 1px solid rgba(245,158,11,0.22);
                  "
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  重点
                </span>

                <span
                  v-if="noteIds.has(q.id)"
                  :title="noteSearchMatchedIds.has(q.id) ? '笔记内容匹配当前搜索' : '这道题有笔记'"
                  style="
                    display: inline-flex; align-items: center; gap: 4px;
                    font-size: 11px; font-weight: 500;
                    padding: 1px 7px; border-radius: 5px;
                    background: rgba(var(--primary-rgb), 0.08); color: var(--primary);
                    border: 1px solid rgba(var(--primary-rgb), 0.18);
                  "
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5z" />
                    <path d="M8 7h6" />
                    <path d="M8 11h8" />
                  </svg>
                  {{ noteSearchMatchedIds.has(q.id) ? '命中笔记' : '笔记' }}
                </span>

                <span
                  v-for="tag in q.tags.slice(0, 2)"
                  :key="tag"
                  style="
                    font-size: 11px; padding: 1px 7px; border-radius: 5px;
                    border: 1px solid var(--border-subtle); color: var(--text-3);
                  "
                >{{ tag }}</span>
              </div>

              <!-- Note search snippet -->
              <div
                v-if="noteSearchMatchedIds.has(q.id) && noteSearchSnippets.get(q.id)"
                style="
                  margin-top: 10px; padding: 9px 10px; border-radius: 8px;
                  background: var(--surface-2);
                  border: 1px solid rgba(var(--primary-rgb), 0.14);
                "
              >
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px; color: var(--primary); font-size: 11px; font-weight: 600">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5z" />
                    <path d="M8 7h6" />
                    <path d="M8 11h8" />
                  </svg>
                  笔记摘录
                </div>
                <p
                  style="
                    font-size: 12px; color: var(--text-2); line-height: 1.55;
                    overflow: hidden; display: -webkit-box;
                    -webkit-line-clamp: 2; -webkit-box-orient: vertical;
                  "
                >{{ noteSearchSnippets.get(q.id) }}</p>
              </div>
            </div>

            <!-- Arrow -->
            <svg
              width="14" height="14" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"
              style="flex-shrink: 0; margin-top: 2px; color: var(--text-3)"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </RouterLink>

          <!-- Pagination -->
          <div
            v-if="totalPages > 1 || filteredQuestions.length > 10"
            style="
              display: flex; align-items: center; justify-content: space-between;
              padding-top: 16px; gap: 12px; flex-wrap: wrap;
            "
          >
            <!-- Page size selector -->
            <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-3)">
              <span style="white-space: nowrap">每页</span>
              <input
                type="number"
                :value="pageSize"
                @change="setPageSize(parseInt(($event.target as HTMLInputElement).value, 10) || 30)"
                :min="PAGE_SIZE_MIN"
                :max="PAGE_SIZE_MAX"
                style="
                  width: 48px; padding: 3px 6px; border-radius: 6px;
                  border: 1px solid var(--border); background: var(--surface);
                  color: var(--text); font-size: 12px; text-align: center;
                  outline: none; font-variant-numeric: tabular-nums;
                "
              />
              <span style="white-space: nowrap">道</span>
            </div>

            <!-- Page navigation -->
            <div style="display: flex; align-items: center; gap: 4px">
              <button
                type="button"
                :disabled="page <= 1"
                @click="page = 1"
                style="
                  padding: 4px 8px; border-radius: 6px;
                  border: 1px solid var(--border); background: var(--surface);
                  color: var(--text-2); font-size: 12px; cursor: pointer;
                  transition: all 0.12s;
                "
                :style="{ opacity: page <= 1 ? 0.4 : 1, pointerEvents: page <= 1 ? 'none' : 'auto' }"
                title="首页"
              >«</button>
              <button
                type="button"
                :disabled="page <= 1"
                @click="page--"
                style="
                  padding: 4px 10px; border-radius: 6px;
                  border: 1px solid var(--border); background: var(--surface);
                  color: var(--text-2); font-size: 12px; cursor: pointer;
                  transition: all 0.12s;
                "
                :style="{ opacity: page <= 1 ? 0.4 : 1, pointerEvents: page <= 1 ? 'none' : 'auto' }"
              >← 上一页</button>

              <template v-for="pg in totalPages" :key="pg">
                <button
                  v-if="pg === 1 || pg === totalPages || (pg >= page - 2 && pg <= page + 2)"
                  type="button"
                  @click="page = pg"
                  :style="{
                    minWidth: '28px', padding: '4px 8px', borderRadius: '6px',
                    border: page === pg ? '1px solid var(--primary)' : '1px solid transparent',
                    background: page === pg ? 'var(--primary-light)' : 'transparent',
                    color: page === pg ? 'var(--primary)' : 'var(--text-2)',
                    fontSize: '12px', fontWeight: page === pg ? 600 : 400,
                    cursor: 'pointer', transition: 'all 0.12s',
                  }"
                >{{ pg }}</button>
                <span
                  v-else-if="pg === page - 3 || pg === page + 3"
                  style="font-size: 12px; color: var(--text-3); padding: 0 2px"
                >…</span>
              </template>

              <button
                type="button"
                :disabled="page >= totalPages"
                @click="page++"
                style="
                  padding: 4px 10px; border-radius: 6px;
                  border: 1px solid var(--border); background: var(--surface);
                  color: var(--text-2); font-size: 12px; cursor: pointer;
                  transition: all 0.12s;
                "
                :style="{ opacity: page >= totalPages ? 0.4 : 1, pointerEvents: page >= totalPages ? 'none' : 'auto' }"
              >下一页 →</button>
              <button
                type="button"
                :disabled="page >= totalPages"
                @click="page = totalPages"
                style="
                  padding: 4px 8px; border-radius: 6px;
                  border: 1px solid var(--border); background: var(--surface);
                  color: var(--text-2); font-size: 12px; cursor: pointer;
                  transition: all 0.12s;
                "
                :style="{ opacity: page >= totalPages ? 0.4 : 1, pointerEvents: page >= totalPages ? 'none' : 'auto' }"
                title="末页"
              >»</button>
            </div>

            <!-- Summary -->
            <span style="font-size: 11px; color: var(--text-3); white-space: nowrap">
              第 {{ filteredQuestions.length === 0 ? 0 : page }}/{{ totalPages }} 页，共 {{ filteredQuestions.length }} 道
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Responsive */
@media (max-width: 768px) {
  .ql-sidebar { display: none !important; }
  .mobile-filter-btn { display: flex !important; }
}
.question-list-start-count {
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
@media (max-width: 480px) {
  .question-list-start-btn {
    padding-left: 8px !important;
    padding-right: 8px !important;
  }
  .question-list-start-count { display: none; }
}
</style>
