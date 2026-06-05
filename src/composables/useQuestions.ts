import { ref, watch, toValue, type MaybeRefOrGetter } from 'vue'
import type { Question, FilterState, Module, Difficulty, StudyStatus } from '@/types'
import { getAllQuestions } from '@/lib/db'
import {
  getDailyRecommendations,
  loadAllBuiltinModulesParallel,
  refreshBuiltinQuestionsIfNeeded,
} from '@/lib/questionLoader'

export type SortKey = 'default' | 'difficulty-asc' | 'difficulty-desc' | 'module'

// ─── In-memory cache shared across composable instances ───────────────────────

let _allQuestions: Question[] = []
let _loaded = false
let _loading = false
const _waiters: Array<() => void> = []

async function ensureLoaded(): Promise<Question[]> {
  if (_loaded) return _allQuestions

  if (_loading) {
    return new Promise<Question[]>((resolve) => {
      _waiters.push(() => resolve(_allQuestions))
    })
  }

  _loading = true

  let cached = await getAllQuestions()
  if (cached.length > 0) {
    try {
      const refreshed = await refreshBuiltinQuestionsIfNeeded()
      if (refreshed) cached = await getAllQuestions()
    } catch (err) {
      console.warn('Failed to refresh built-in questions, using cached data', err)
    }

    _allQuestions = cached
    _loaded = true
    _loading = false
    _waiters.forEach((fn) => fn())
    _waiters.length = 0

    // Background sync
    loadAllBuiltinModulesParallel().then(async () => {
      const updated = await getAllQuestions()
      if (updated.length !== _allQuestions.length) {
        _allQuestions = updated
        _waiters.forEach((fn) => fn())
      }
    })

    return _allQuestions
  }

  await loadAllBuiltinModulesParallel()
  _allQuestions = await getAllQuestions()
  _loaded = true
  _loading = false
  _waiters.forEach((fn) => fn())
  _waiters.length = 0

  return _allQuestions
}

export function invalidateQuestionsCache() {
  _loaded = false
  _loading = false
  _allQuestions = []
}

// ─── Filter helper ────────────────────────────────────────────────────────────

export function applyFilters(
  questions: Question[],
  filter: Partial<FilterState>,
  recordMap: Record<string, { status: StudyStatus }>,
  sort: SortKey = 'default',
): Question[] {
  let result = questions

  if (filter.modules && filter.modules.length > 0) {
    const set = new Set(filter.modules)
    result = result.filter((q) => set.has(q.module))
  }

  if (filter.difficulties && filter.difficulties.length > 0) {
    const set = new Set(filter.difficulties)
    result = result.filter((q) => set.has(q.difficulty))
  }

  if (filter.statuses && filter.statuses.length > 0) {
    const set = new Set(filter.statuses)
    result = result.filter((q) => {
      const status = recordMap[q.id]?.status ?? 'unlearned'
      return set.has(status as StudyStatus)
    })
  }

  if (filter.search?.trim()) {
    const keyword = filter.search.trim().toLowerCase()
    result = result.filter(
      (q) =>
        q.question.toLowerCase().includes(keyword) ||
        q.tags.some((t) => t.toLowerCase().includes(keyword)) ||
        q.module.toLowerCase().includes(keyword) ||
        q.source?.toLowerCase().includes(keyword),
    )
  }

  switch (sort) {
    case 'difficulty-asc':
      result = [...result].sort((a, b) => a.difficulty - b.difficulty)
      break
    case 'difficulty-desc':
      result = [...result].sort((a, b) => b.difficulty - a.difficulty)
      break
    case 'module':
      result = [...result].sort((a, b) => a.module.localeCompare(b.module))
      break
  }

  return result
}

// ─── Composable ───────────────────────────────────────────────────────────────

export function useQuestions(
  filter?: Partial<FilterState>,
  recordMap?: Record<string, { status: StudyStatus }>,
  sort: SortKey = 'default',
) {
  const allQuestions = ref<Question[]>(_allQuestions)
  const loading = ref(!_loaded)
  const initializing = ref(!_loaded)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const questions = await ensureLoaded()
      allQuestions.value = questions
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
      initializing.value = false
    }
  }

  // Auto-load on creation
  load()

  async function reload() {
    invalidateQuestionsCache()
    await load()
  }

  function getFilteredQuestions(): Question[] {
    if (!filter && !recordMap) return allQuestions.value
    return applyFilters(allQuestions.value, filter ?? {}, recordMap ?? {}, sort)
  }

  function getQuestionById(id: string): Question | undefined {
    return allQuestions.value.find((q) => q.id === id)
  }

  function getQuestionsByModule(module: Module): Question[] {
    return allQuestions.value.filter((q) => q.module === module)
  }

  async function getDailyIds(
    rm: Record<string, { status: string; lastUpdated: number }>,
    count = 10,
    questionIds?: string[],
  ): Promise<string[]> {
    const allIds = questionIds ?? allQuestions.value.map((q) => q.id)
    return getDailyRecommendations(allIds, rm, count)
  }

  function getAdjacentIds(
    currentId: string,
    filteredIds: string[],
  ): { prevId: string | null; nextId: string | null } {
    const idx = filteredIds.indexOf(currentId)
    if (idx === -1) return { prevId: null, nextId: null }
    return {
      prevId: idx > 0 ? filteredIds[idx - 1] : null,
      nextId: idx < filteredIds.length - 1 ? filteredIds[idx + 1] : null,
    }
  }

  return {
    questions: allQuestions,
    allQuestions,
    loading,
    initializing,
    error,
    totalCount: () => allQuestions.value.length,
    reload,
    getFilteredQuestions,
    getQuestionById,
    getQuestionsByModule,
    getDailyIds,
    getAdjacentIds,
  }
}

// ─── Lightweight composable for a single question (detail page) ───────────────

export function useQuestion(id: MaybeRefOrGetter<string | undefined>) {
  const question = ref<Question | undefined>(undefined)
  const loading = ref(true)

  watch(
    () => toValue(id),
    (newId) => {
      if (!newId) {
        loading.value = false
        question.value = undefined
        return
      }
      loading.value = true
      ensureLoaded()
        .then((qs) => {
          question.value = qs.find((q) => q.id === newId)
        })
        .finally(() => {
          loading.value = false
        })
    },
    { immediate: true },
  )

  return { question, loading }
}

// ─── Composable for practice session ──────────────────────────────────────────

export function usePracticeQuestions(
  module: Module | null,
  difficulty: Difficulty | null,
) {
  const questions = ref<Question[]>([])
  const loading = ref(true)

  ensureLoaded()
    .then((all) => {
      let filtered = all
      if (module) filtered = filtered.filter((q) => q.module === module)
      if (difficulty) filtered = filtered.filter((q) => q.difficulty === difficulty)
      questions.value = filtered
    })
    .finally(() => {
      loading.value = false
    })

  return { questions, loading }
}
