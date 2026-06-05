import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  clearAllStudyRecords,
  deleteStudyRecord,
  getAllStudyRecords,
  putStudyRecord,
} from '@/lib/db'
import { invalidateDailyCache } from '@/lib/questionLoader'
import type { StudyRecord, StudyRecordMap, StudyStatus } from '@/types'

// ─── Streak / Gamification ────────────────────────────────────────────────────

export interface StreakData {
  currentStreak: number
  bestStreak: number
  todayCount: number
  lastActivityDate: string
}

const STREAK_KEY = 'grimoireface_streak'

// ─── Daily Goal ───────────────────────────────────────────────────────────────

export const DAILY_GOAL_MIN = 5
export const DAILY_GOAL_MAX = 50
export const DAILY_GOAL_DEFAULT = 10

const DAILY_GOAL_KEY = 'grimoireface_daily_goal'

function loadDailyGoal(): number {
  try {
    const v = localStorage.getItem(DAILY_GOAL_KEY)
    if (v) {
      const n = parseInt(v, 10)
      if (!Number.isNaN(n) && n >= DAILY_GOAL_MIN && n <= DAILY_GOAL_MAX) return n
    }
  } catch {}
  return DAILY_GOAL_DEFAULT
}

function saveDailyGoal(n: number): void {
  try {
    localStorage.setItem(DAILY_GOAL_KEY, String(n))
  } catch {}
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function loadStreak(): StreakData {
  try {
    const raw = localStorage.getItem(STREAK_KEY)
    if (raw) {
      const parsed: StreakData = JSON.parse(raw)
      if (parsed.lastActivityDate !== todayStr()) {
        return { ...parsed, currentStreak: 0, todayCount: 0, lastActivityDate: todayStr() }
      }
      return parsed
    }
  } catch {}
  return { currentStreak: 0, bestStreak: 0, todayCount: 0, lastActivityDate: todayStr() }
}

function saveStreak(data: StreakData): void {
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(data))
  } catch {}
}

// ─── Study Mode ───────────────────────────────────────────────────────────────

export type StudyMode = 'answer-first' | 'answer-alongside' | 'memory-only'

const STUDY_MODE_KEY = 'grimoireface_study_mode'

function loadStudyMode(): StudyMode {
  try {
    const v = localStorage.getItem(STUDY_MODE_KEY)
    if (v === 'answer-first' || v === 'answer-alongside' || v === 'memory-only') return v
  } catch {}
  return 'answer-first'
}

function saveStudyMode(mode: StudyMode): void {
  try {
    localStorage.setItem(STUDY_MODE_KEY, mode)
  } catch {}
}

// ─── Hidden Categories ────────────────────────────────────────────────────────

const HIDDEN_CATEGORIES_KEY = 'grimoireface_hidden_categories'

function loadHiddenCategories(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_CATEGORIES_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return new Set<string>(arr)
    }
  } catch {}
  return new Set<string>()
}

function saveHiddenCategories(s: Set<string>): void {
  try {
    localStorage.setItem(HIDDEN_CATEGORIES_KEY, JSON.stringify([...s]))
  } catch {}
}

// ─── Theme ────────────────────────────────────────────────────────────────────

const THEME_KEY = 'grimoireface_theme'

function loadTheme(): 'light' | 'dark' {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function saveTheme(theme: 'light' | 'dark'): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {}
}

function applyThemeToDom(theme: 'light' | 'dark'): void {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

// ─── Session Review Guard ─────────────────────────────────────────────────────

const _sessionReviewed = new Set<string>()

export function clearSessionReview(questionId: string) {
  _sessionReviewed.delete(questionId)
}

// ─── BroadcastChannel ─────────────────────────────────────────────────────────

let channel: BroadcastChannel | null = null
try {
  channel = new BroadcastChannel('grimoireface_store')
} catch {}

// ─── Pinia Store ──────────────────────────────────────────────────────────────

export const useStudyStore = defineStore('study', () => {
  const records = ref<StudyRecordMap>({})
  const theme = ref<'light' | 'dark'>('light')
  const studyMode = ref<StudyMode>('answer-first')
  const streak = ref<StreakData>({ currentStreak: 0, bestStreak: 0, todayCount: 0, lastActivityDate: todayStr() })
  const dailyGoal = ref(DAILY_GOAL_DEFAULT)
  const hiddenCategories = ref<Set<string>>(new Set())
  const initialized = ref(false)

  // ── Initialize from IndexedDB + localStorage ──
  async function init() {
    if (initialized.value) return
    const t = loadTheme()
    theme.value = t
    applyThemeToDom(t)
    studyMode.value = loadStudyMode()
    streak.value = loadStreak()
    dailyGoal.value = loadDailyGoal()
    hiddenCategories.value = loadHiddenCategories()

    const all = await getAllStudyRecords()
    const map: StudyRecordMap = {}
    for (const r of all) map[r.questionId] = r
    records.value = map
    initialized.value = true

    // Listen for cross-tab sync
    channel?.addEventListener('message', (e: MessageEvent) => {
      const action = e.data
      if (action.type === 'SET_RECORD') {
        records.value = { ...records.value, [action.record.questionId]: action.record }
      } else if (action.type === 'DELETE_RECORD') {
        const next = { ...records.value }
        delete next[action.questionId]
        records.value = next
      } else if (action.type === 'RESET_RECORDS') {
        records.value = {}
      } else if (action.type === 'SET_THEME') {
        theme.value = action.theme
        applyThemeToDom(action.theme)
      } else if (action.type === 'SET_STUDY_MODE') {
        studyMode.value = action.studyMode
      } else if (action.type === 'SET_DAILY_GOAL') {
        dailyGoal.value = action.dailyGoal
      } else if (action.type === 'SET_HIDDEN_CATEGORIES') {
        hiddenCategories.value = new Set(action.hiddenCategories)
      } else if (action.type === 'INCREMENT_STREAK') {
        streak.value = action.streak
      } else if (action.type === 'RESET_STREAK') {
        streak.value = action.streak
      }
    })
  }

  // ── Actions ──

  async function setStatus(questionId: string, status: StudyStatus) {
    const existing = records.value[questionId]
    const alreadyCountedThisSession = _sessionReviewed.has(questionId)
    let newReviewCount: number
    if (status === 'review') {
      if (!alreadyCountedThisSession) {
        newReviewCount = (existing?.reviewCount ?? 0) + 1
        _sessionReviewed.add(questionId)
      } else {
        newReviewCount = existing?.reviewCount ?? 1
      }
    } else {
      newReviewCount = existing?.reviewCount ?? 0
    }

    const record: StudyRecord = {
      questionId,
      status,
      lastUpdated: Date.now(),
      reviewCount: newReviewCount,
    }
    records.value = { ...records.value, [questionId]: record }
    await putStudyRecord(record)
    await invalidateDailyCache()
    broadcast({ type: 'SET_RECORD', record })
  }

  async function clearRecord(questionId: string) {
    const next = { ...records.value }
    delete next[questionId]
    records.value = next
    await deleteStudyRecord(questionId)
    broadcast({ type: 'DELETE_RECORD', questionId })
  }

  async function resetAll() {
    records.value = {}
    await clearAllStudyRecords()
    await invalidateDailyCache()
    broadcast({ type: 'RESET_RECORDS' })
  }

  function setTheme(t: 'light' | 'dark') {
    theme.value = t
    saveTheme(t)
    applyThemeToDom(t)
    broadcast({ type: 'SET_THEME', theme: t })
  }

  function toggleTheme() {
    setTheme(theme.value === 'light' ? 'dark' : 'light')
  }

  function setStudyMode(mode: StudyMode) {
    studyMode.value = mode
    saveStudyMode(mode)
    broadcast({ type: 'SET_STUDY_MODE', studyMode: mode })
  }

  function incrementStreak() {
    const today = todayStr()
    const prev = streak.value
    const newStreak: StreakData = {
      currentStreak: prev.lastActivityDate === today ? prev.currentStreak + 1 : 1,
      bestStreak: Math.max(prev.bestStreak, prev.lastActivityDate === today ? prev.currentStreak + 1 : 1),
      todayCount: prev.lastActivityDate === today ? prev.todayCount + 1 : 1,
      lastActivityDate: today,
    }
    streak.value = newStreak
    saveStreak(newStreak)
    broadcast({ type: 'INCREMENT_STREAK', streak: newStreak })
  }

  function resetStreak() {
    const reset: StreakData = {
      currentStreak: 0,
      bestStreak: streak.value.bestStreak,
      todayCount: 0,
      lastActivityDate: todayStr(),
    }
    streak.value = reset
    saveStreak(reset)
    broadcast({ type: 'RESET_STREAK', streak: reset })
  }

  function setDailyGoal(n: number) {
    const clamped = Math.max(DAILY_GOAL_MIN, Math.min(DAILY_GOAL_MAX, Math.round(n)))
    dailyGoal.value = clamped
    saveDailyGoal(clamped)
    broadcast({ type: 'SET_DAILY_GOAL', dailyGoal: clamped })
  }

  function setHiddenCategories(categoryNames: string[]) {
    const next = new Set(categoryNames)
    hiddenCategories.value = next
    saveHiddenCategories(next)
    broadcast({ type: 'SET_HIDDEN_CATEGORIES', hiddenCategories: [...next] })
    void invalidateDailyCache()
  }

  function setCategoryVisibility(categoryName: string, visible: boolean) {
    const next = new Set(hiddenCategories.value)
    if (visible) next.delete(categoryName)
    else next.add(categoryName)
    setHiddenCategories([...next])
  }

  function toggleCategoryVisibility(categoryName: string) {
    setCategoryVisibility(categoryName, hiddenCategories.value.has(categoryName))
  }

  // ── Queries ──

  function getStatus(questionId: string): StudyStatus {
    return records.value[questionId]?.status ?? 'unlearned'
  }

  function getRecord(questionId: string): StudyRecord | undefined {
    return records.value[questionId]
  }

  const statusCounts = computed(() => {
    const counts = { unlearned: 0, mastered: 0, review: 0 }
    for (const r of Object.values(records.value)) {
      counts[r.status]++
    }
    return counts
  })

  function getStatusCounts(questionIds?: string[]) {
    if (!questionIds) return statusCounts.value
    const counts = { unlearned: 0, mastered: 0, review: 0 }
    for (const id of questionIds) {
      const status = records.value[id]?.status ?? 'unlearned'
      counts[status]++
    }
    return counts
  }

  function getWeakQuestions(): StudyRecord[] {
    return Object.values(records.value)
      .filter((r) => r.status === 'review')
      .sort((a, b) => a.lastUpdated - b.lastUpdated)
  }

  function getEstimatedDays(totalQuestions: number, dailyCount = DAILY_GOAL_DEFAULT): number {
    const mastered = Object.values(records.value).filter((r) => r.status === 'mastered').length
    const remaining = totalQuestions - mastered
    return remaining <= 0 ? 0 : Math.ceil(remaining / dailyCount)
  }

  function isCategoryHidden(categoryName: string): boolean {
    return hiddenCategories.value.has(categoryName)
  }

  return {
    records,
    theme,
    studyMode,
    streak,
    dailyGoal,
    hiddenCategories,
    initialized,
    statusCounts,
    init,
    setStatus,
    clearRecord,
    resetAll,
    setTheme,
    toggleTheme,
    setStudyMode,
    setDailyGoal,
    setHiddenCategories,
    setCategoryVisibility,
    toggleCategoryVisibility,
    incrementStreak,
    resetStreak,
    getStatus,
    getRecord,
    getStatusCounts,
    getWeakQuestions,
    getEstimatedDays,
    isCategoryHidden,
  }
})

// ─── Broadcast helper ─────────────────────────────────────────────────────────

function broadcast(action: Record<string, unknown>) {
  try {
    channel?.postMessage(action)
  } catch {}
}
