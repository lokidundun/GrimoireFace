<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStudyStore } from '@/stores/useStudyStore'
import { useAIStore, buildQuestionSystemSuffix, getAIQuickActions } from '@/stores/useAIStore'
import { useQuestion, useQuestions } from '@/composables/useQuestions'
import { useBufferedText } from '@/composables/useBufferedText'
import {
  getQuestionNote,
  putQuestionNote,
  getQuestionFlag,
  setQuestionStarred,
  getQuestionAnswerOverride,
  putQuestionAnswerOverride,
  deleteQuestionAnswerOverride,
} from '@/lib/db'
import { createPracticeSessionPath, readPracticeSession } from '@/lib/practiceSession'
import MarkdownRenderer from '@/components/ui/MarkdownRenderer.vue'
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
  type Difficulty,
  type StudyStatus,
  type QuestionNote,
  type QuestionFlag,
  type QuestionAnswerOverride,
  type Question,
} from '@/types'
import type { AIMessage } from '@/stores/useAIStore'

const props = defineProps<{ id: string }>()

const route = useRoute()
const router = useRouter()
const study = useStudyStore()
const ai = useAIStore()

const { question, loading } = useQuestion(() => props.id)
const { allQuestions } = useQuestions()

// ─── Answer visibility & marking ──────────────────────────────────────────────

const answerVisible = ref(false)
const marking = ref(false)
const justMarked = ref<StudyStatus | null>(null)
const lastPressedKey = ref<'1' | '2' | '3' | null>(null)

// ─── Star & note state ────────────────────────────────────────────────────────

const flag = ref<QuestionFlag | null>(null)
const starred = computed(() => flag.value?.starred ?? false)
const hasNote = ref(false)
const note = ref<QuestionNote | null>(null)
const noteText = ref('')
const noteOpen = ref(false)
const noteDialogRef = ref<HTMLElement | null>(null)

// ─── Answer override ──────────────────────────────────────────────────────────

const answerOverride = ref<QuestionAnswerOverride | null>(null)
const answerOverrideLoading = ref(false)
const answerEditMode = ref(false)
const answerDraft = ref('')
const answerSaveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const showOriginalAnswer = ref(false)

// ─── AI ───────────────────────────────────────────────────────────────────────

const showAI = ref(false)
const aiInput = ref('')
const aiMessages = ref<AIMessage[]>([])
const { text: streamedText, appendText: appendStreamText, resetText: resetStreamText } = useBufferedText()

// ─── Session ──────────────────────────────────────────────────────────────────

const sessionKey = computed(() => route.query.session as string | undefined)
const inlineSessionIds = computed(() => {
  const ids = route.query.ids
  if (!ids) return []
  return (typeof ids === 'string' ? ids : '').split(',').filter(Boolean)
})

const storedSessionIds = ref<string[]>([])
onMounted(() => {
  storedSessionIds.value = readPracticeSession(sessionKey.value)
})
watch(sessionKey, (key) => {
  storedSessionIds.value = readPracticeSession(key)
})

const sessionIds = computed(() =>
  inlineSessionIds.value.length > 0 ? inlineSessionIds.value : storedSessionIds.value,
)
const isInSession = computed(() => sessionIds.value.length > 0)
const sessionIndex = computed(() => (isInSession.value ? sessionIds.value.indexOf(props.id ?? '') : -1))
const sessionSearch = computed(() => {
  if (sessionKey.value) return `?session=${sessionKey.value}`
  if (sessionIds.value.length > 0) return `?ids=${sessionIds.value.join(',')}`
  return ''
})

const prevIdByList = computed(() => {
  if (!props.id || allQuestions.value.length === 0 || !question.value) return null
  const sameModule = allQuestions.value.filter((q) => q.module === question.value!.module)
  const idx = sameModule.findIndex((q) => q.id === props.id)
  return idx > 0 ? sameModule[idx - 1].id : null
})

const nextIdByList = computed(() => {
  if (!props.id || allQuestions.value.length === 0 || !question.value) return null
  const sameModule = allQuestions.value.filter((q) => q.module === question.value!.module)
  const idx = sameModule.findIndex((q) => q.id === props.id)
  return idx >= 0 && idx < sameModule.length - 1 ? sameModule[idx + 1].id : null
})

const prevId = computed(() => {
  if (isInSession.value) return sessionIndex.value > 0 ? sessionIds.value[sessionIndex.value - 1] : null
  return prevIdByList.value
})
const nextId = computed(() => {
  if (isInSession.value)
    return sessionIndex.value >= 0 && sessionIndex.value < sessionIds.value.length - 1
      ? sessionIds.value[sessionIndex.value + 1]
      : null
  return nextIdByList.value
})
const sessionCurrent = computed(() => sessionIndex.value + 1)
const sessionTotal = computed(() => sessionIds.value.length)

// ─── Load data ────────────────────────────────────────────────────────────────

async function loadQuestionData(questionId: string) {
  // Reset answer state
  answerVisible.value = false
  justMarked.value = null
  lastPressedKey.value = null
  showAI.value = false
  answerEditMode.value = false
  showOriginalAnswer.value = false
  answerDraft.value = ''
  answerSaveStatus.value = 'idle'

  const [n, f, ao] = await Promise.all([
    getQuestionNote(questionId),
    getQuestionFlag(questionId),
    getQuestionAnswerOverride(questionId),
  ])
  if (n) { note.value = n; noteText.value = n.content; hasNote.value = n.content.trim().length > 0 }
  else { note.value = null; noteText.value = ''; hasNote.value = false }
  if (f) flag.value = f
  else flag.value = null
  if (ao) { answerOverride.value = ao; answerDraft.value = ao.content }
  else { answerOverride.value = null; answerDraft.value = '' }
  answerOverrideLoading.value = false

  const session = ai.getSession(questionId)
  aiMessages.value = session ? [...session.messages] : []
}

watch(
  () => props.id,
  (newId, oldId) => {
    if (!newId) return
    if (oldId !== undefined && oldId !== newId) answerOverrideLoading.value = true
    loadQuestionData(newId)
  },
  { immediate: true },
)

// ─── Computed ─────────────────────────────────────────────────────────────────

const currentStatus = computed<StudyStatus>(() => study.getStatus(props.id))
const reviewCount = computed(() => study.getRecord(props.id)?.count ?? 0)

const hasCustomAnswer = computed(
  () => !!question.value && !!answerOverride.value?.content.trim(),
)
const effectiveAnswerText = computed(() => {
  if (!question.value) return ''
  return hasCustomAnswer.value ? (answerOverride.value?.content ?? '') : question.value.answer
})
const displayedAnswerText = computed(() => {
  if (!question.value) return ''
  return hasCustomAnswer.value && showOriginalAnswer.value
    ? question.value.answer
    : effectiveAnswerText.value
})
const answerHeading = computed(() => {
  if (answerEditMode.value) return '编辑答案'
  if (hasCustomAnswer.value && !showOriginalAnswer.value) return '自定义答案'
  return '参考答案'
})

const diffStyle = computed(() => {
  if (!question.value) return {}
  return DIFFICULTY_STYLES[question.value.difficulty] ?? {}
})

const quickActions = computed(() => getAIQuickActions(!!question.value?.answer))

// ─── Related practice ─────────────────────────────────────────────────────────

const relatedPracticeItems = computed(() => {
  if (!question.value || allQuestions.value.length === 0) return []
  const currentTags = new Set(question.value.tags.map((t) => t.toLowerCase()))
  const statusRank: Record<StudyStatus, number> = { review: 2, unlearned: 1, mastered: 0 }

  return allQuestions.value
    .filter((c) => c.id !== question.value!.id)
    .map((c) => {
      const matchedTags = c.tags.filter((t) => currentTags.has(t.toLowerCase()))
      const status = study.records[c.id]?.status ?? 'unlearned'
      const sameModule = c.module === question.value!.module
      const sameDifficulty = c.difficulty === question.value!.difficulty
      const score =
        matchedTags.length * 8 + (sameModule ? 5 : 0) + (sameDifficulty ? 2 : 0) + statusRank[status] * 3
      return { question: c, status, matchedTags, score }
    })
    .filter((item) => item.score >= 5)
    .sort((a, b) => b.score - a.score || statusRank[b.status] - statusRank[a.status])
    .slice(0, 5)
})

// ─── Actions ──────────────────────────────────────────────────────────────────

async function handleSetStatus(status: StudyStatus, key?: '1' | '2' | '3') {
  if (!props.id || marking.value) return
  marking.value = true
  justMarked.value = status
  if (key) lastPressedKey.value = key

  try {
    await study.setStatus(props.id, status)
    study.incrementStreak()
  } finally {
    marking.value = false
  }
}

function handleRevealAnswer() {
  answerVisible.value = true
  justMarked.value = null
  lastPressedKey.value = null
}

function navigateTo(targetId: string | null | undefined) {
  if (!targetId) return
  router.push(`/questions/${targetId}${sessionSearch.value}`)
}

async function toggleStar() {
  if (!props.id) return
  const next = !starred.value
  try {
    await setQuestionStarred(props.id, next)
    flag.value = {
      questionId: props.id,
      starred: next,
      createdAt: flag.value?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }
  } catch { /* ignore */ }
}

async function saveNote() {
  if (!noteText.value.trim()) return
  const now = Date.now()
  const n: QuestionNote = {
    questionId: props.id,
    content: noteText.value.trim(),
    createdAt: note.value?.createdAt ?? now,
    updatedAt: now,
  }
  await putQuestionNote(n)
  note.value = n
  hasNote.value = true
}

function handleStartAnswerEdit() {
  answerDraft.value = hasCustomAnswer.value ? (answerOverride.value?.content ?? '') : (question.value?.answer ?? '')
  answerEditMode.value = true
  answerSaveStatus.value = 'idle'
}
function handleCancelAnswerEdit() {
  answerEditMode.value = false
  answerDraft.value = ''
}
async function handleSaveAnswerOverride() {
  if (!props.id || !answerDraft.value.trim()) return
  answerSaveStatus.value = 'saving'
  try {
    const now = Date.now()
    const ao: QuestionAnswerOverride = {
      questionId: props.id,
      content: answerDraft.value.trim(),
      createdAt: answerOverride.value?.createdAt ?? now,
      updatedAt: now,
    }
    await putQuestionAnswerOverride(ao)
    answerOverride.value = ao
    answerEditMode.value = false
    answerSaveStatus.value = 'saved'
  } catch {
    answerSaveStatus.value = 'error'
  }
}
async function deleteOverride() {
  if (!props.id) return
  await deleteQuestionAnswerOverride(props.id)
  answerOverride.value = null
  answerDraft.value = ''
  answerEditMode.value = false
}

function handleStartRelatedPractice() {
  const ids = relatedPracticeItems.value.map((item) => item.question.id)
  if (ids.length === 0) return
  router.push(createPracticeSessionPath(ids[0], ids))
}

// ─── AI ──────────────────────────────────────────────────────────────────────

async function sendAIMessage(message: string) {
  if (!message.trim() || ai.streaming) return
  const userMsg = message.trim()
  aiInput.value = ''
  aiMessages.value.push({ role: 'user', content: userMsg })

  const systemSuffix = question.value
    ? buildQuestionSystemSuffix(question.value.question, question.value.module, question.value.difficulty, question.value.answer)
    : ''

  resetStreamText()
  showAI.value = true

  await ai.sendMessage(
    props.id,
    userMsg,
    aiMessages.value.slice(0, -1),
    systemSuffix,
    (chunk) => appendStreamText(chunk),
    (fullText) => {
      if (fullText) aiMessages.value.push({ role: 'assistant', content: fullText })
      resetStreamText()
    },
    (error) => {
      aiMessages.value.push({ role: 'assistant', content: `Error: ${error}` })
      resetStreamText()
    },
  )
}

// ─── Note dialog ──────────────────────────────────────────────────────────────

function openNoteDialog() {
  noteOpen.value = true
  nextTick(() => noteDialogRef.value?.focus())
}
function closeNoteDialog() {
  noteOpen.value = false
}
watch(noteOpen, (open) => {
  if (!open) return
  const prev = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  onUnmounted(() => { document.body.style.overflow = prev })
})

// ─── Keyboard shortcuts ──────────────────────────────────────────────────────

function handleKeydown(e: KeyboardEvent) {
  const activeTag = (document.activeElement as HTMLElement)?.tagName ?? ''
  const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag) || document.activeElement?.isContentEditable

  if (!answerVisible.value && e.key === ' ' && !isTyping) {
    e.preventDefault()
    handleRevealAnswer()
    return
  }

  if (isTyping) return

  if (answerVisible.value) {
    if (e.key === '1') { e.preventDefault(); handleSetStatus('review', '1') }
    else if (e.key === '2') { e.preventDefault(); handleSetStatus('review', '2') }
    else if (e.key === '3') { e.preventDefault(); handleSetStatus('mastered', '3') }
  }
  if (e.key === 'ArrowRight') { e.preventDefault(); navigateTo(nextId.value) }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); navigateTo(prevId.value) }
  else if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openNoteDialog() }
  else if (e.key.toLowerCase() === 'a' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); showAI.value = !showAI.value }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <div class="page-container" style="max-width: 760px; display: flex; flex-direction: column; gap: 16px">
    <!-- Back link -->
    <div class="animate-fade-in" v-if="!loading">
      <RouterLink to="/questions" class="back-link">← 题库</RouterLink>
    </div>
    <!-- Breadcrumb -->
    <div v-if="!loading">
      <nav v-if="!isInSession" style="display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-3)">
        <RouterLink to="/questions" style="color: var(--text-3); text-decoration: none">题库</RouterLink>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.4"><polyline points="9 18 15 12 9 6"/></svg>
        <RouterLink v-if="question" :to="`/questions?module=${encodeURIComponent(question.module)}`" style="color: var(--text-3); text-decoration: none">{{ question.module }}</RouterLink>
        <svg v-if="question" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.4"><polyline points="9 18 15 12 9 6"/></svg>
        <span v-if="question" style="color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px">{{ question.question.slice(0, 30) }}…</span>
      </nav>
      <!-- Session progress -->
      <div v-else style="display: flex; align-items: center; gap: 12px">
        <button type="button" @click="$router.push('/practice')" style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2); background: none; border: none; cursor: pointer; padding: 0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          退出练习
        </button>
        <div style="display: flex; align-items: center; gap: 8px; margin-left: auto">
          <div style="width: 80px; height: 4px; background: var(--border); border-radius: 99px; overflow: hidden">
            <div style="height: 100%; background: var(--primary); border-radius: 99px; transition: width 0.4s var(--ease-out)" :style="{ width: `${sessionTotal > 0 ? (sessionCurrent / sessionTotal) * 100 : 0}%` }" />
          </div>
          <span style="font-size: 12px; font-weight: 500; color: var(--text-2); font-variant-numeric: tabular-nums; white-space: nowrap">{{ sessionCurrent }} / {{ sessionTotal }}</span>
        </div>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="card" style="padding: 24px; display: flex; flex-direction: column; gap: 16px">
      <div style="display: flex; gap: 8px">
        <div class="skeleton" style="width: 60px; height: 24px; border-radius: 6px; background: var(--surface-3)" />
        <div class="skeleton" style="width: 48px; height: 24px; border-radius: 6px; background: var(--surface-3)" />
      </div>
      <div class="skeleton" style="width: 90%; height: 22px; border-radius: 6px; background: var(--surface-3)" />
      <div class="skeleton" style="width: 100%; height: 120px; border-radius: 10px; background: var(--surface-3)" />
    </div>

    <template v-else-if="question">
      <!-- Question Card -->
      <div class="card animate-fade-in" style="padding: 24px; display: flex; flex-direction: column; gap: 16px">
        <!-- Meta row -->
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
          <span style="font-size: 12px; font-weight: 500; color: var(--text-2); padding: 3px 10px; border-radius: 6px; background: var(--surface-3); border: 1px solid var(--border-subtle)">{{ question.module }}</span>

          <span :style="{ fontSize: '12px', fontWeight: 500, padding: '3px 10px', borderRadius: '6px', border: '1px solid', color: diffStyle.color, background: diffStyle.background, borderColor: diffStyle.borderColor }">{{ DIFFICULTY_LABELS[question.difficulty] }}</span>

          <span v-if="currentStatus !== 'unlearned'" :style="{
            fontSize: '11px', fontWeight: 500, padding: '2px 8px', borderRadius: '5px',
            background: currentStatus === 'mastered' ? 'var(--success-light)' : 'var(--warning-light)',
            color: currentStatus === 'mastered' ? 'var(--success)' : 'var(--warning)',
            border: `1px solid ${currentStatus === 'mastered' ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}`,
          }">{{ currentStatus === 'mastered' ? '已掌握' : '待复习' }}</span>

          <div style="margin-left: auto; display: flex; align-items: center; gap: 8px">
            <!-- Star button -->
            <button type="button" :aria-pressed="starred" :title="starred ? '取消重点题' : '标记为重点题'" @click="toggleStar"
              :style="{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '28px', height: '28px', padding: 0, borderRadius: '8px',
                border: '1px solid', borderColor: starred ? 'rgba(245,158,11,0.28)' : 'transparent',
                background: starred ? 'rgba(245,158,11,0.08)' : 'transparent',
                color: starred ? '#b45309' : 'var(--text-3)',
                cursor: 'pointer', opacity: starred ? 1 : 0.7, transition: 'all 0.15s',
              }">
              <svg width="14" height="14" viewBox="0 0 24 24" :fill="starred ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </button>
            <!-- Note button -->
            <button type="button" :title="hasNote ? '打开题目笔记' : '添加题目笔记 (N)'" @click="openNoteDialog"
              :style="{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '28px', height: '28px', padding: 0, borderRadius: '8px',
                border: '1px solid', borderColor: hasNote ? 'rgba(var(--primary-rgb),0.22)' : 'transparent',
                background: hasNote ? 'rgba(var(--primary-rgb),0.07)' : 'transparent',
                color: hasNote ? 'var(--primary)' : 'var(--text-3)',
                cursor: 'pointer', opacity: hasNote ? 1 : 0.7, transition: 'all 0.15s',
              }">
              <span style="position: relative; display: inline-flex">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5z"/><path d="M8 7h6"/><path d="M8 11h8"/></svg>
                <span v-if="hasNote" style="position: absolute; right: -3px; top: -3px; width: 6px; height: 6px; border-radius: 50%; background: var(--primary); border: 1px solid var(--surface)" />
              </span>
            </button>
          </div>
        </div>

        <!-- Question text -->
        <h1 style="font-size: 17px; font-weight: 600; color: var(--text); line-height: 1.65; letter-spacing: -0.005em">{{ question.question }}</h1>

        <!-- Tags -->
        <div v-if="question.tags.length > 0 || reviewCount > 0" style="display: flex; flex-wrap: wrap; gap: 6px">
          <span v-for="tag in question.tags" :key="tag" style="font-size: 11px; padding: 2px 8px; border-radius: 5px; border: 1px solid var(--border-subtle); color: var(--text-3)">#{{ tag }}</span>
          <span v-if="reviewCount > 0" style="font-size: 11px; padding: 2px 3px; color: var(--text-3); opacity: 0.72; white-space: nowrap">复习 {{ reviewCount }} 次</span>
        </div>

        <!-- Reveal button -->
        <button v-if="!answerVisible" type="button" @click="handleRevealAnswer" class="reveal-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          查看参考答案
          <span class="kbd">Space</span>
        </button>
      </div>

      <!-- Answer Card -->
      <div v-if="answerVisible" class="card animate-scale-in" style="padding: 24px; display: flex; flex-direction: column; gap: 20px">
        <!-- Answer header -->
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-bottom: 14px; border-bottom: 1px solid var(--border-subtle)">
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0">
            <div style="width: 3px; height: 18px; border-radius: 99px; background: var(--primary); flex-shrink: 0" />
            <h2 style="font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap">{{ answerHeading }}</h2>
            <template v-if="hasCustomAnswer && !answerEditMode">
              <span style="font-size: 11px; color: var(--text-3)">·</span>
              <span style="font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--primary-light); color: var(--primary); border: 1px solid rgba(var(--primary-rgb),0.18)">自定义</span>
              <button type="button" @click="showOriginalAnswer = !showOriginalAnswer" style="font-size: 11px; color: var(--primary); background: none; border: none; cursor: pointer; padding: 0">{{ showOriginalAnswer ? '显示自定义' : '显示原始' }}</button>
            </template>
          </div>

          <div style="display: flex; align-items: center; gap: 4px">
            <!-- Edit button -->
            <button type="button" class="answer-tool-btn" :class="{ active: answerEditMode }" :title="hasCustomAnswer ? '编辑自定义答案' : '编辑参考答案'" @click="handleStartAnswerEdit">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
            </button>
            <!-- AI button -->
            <button type="button" class="answer-tool-btn" :class="{ active: showAI }" :title="ai.config.enabled ? '打开 AI 助手 (A)' : 'AI 助手'" @click="showAI = !showAI">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/><circle cx="7.5" cy="14.5" r="1.5"/><circle cx="16.5" cy="14.5" r="1.5"/></svg>
            </button>
          </div>
        </div>

        <!-- Answer content -->
        <div v-if="answerEditMode" style="display: flex; flex-direction: column; gap: 10px">
          <textarea v-model="answerDraft" rows="10" class="answer-editor" />
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <button type="button" class="btn-primary-sm" @click="handleSaveAnswerOverride" :disabled="answerSaveStatus === 'saving'">{{ answerSaveStatus === 'saving' ? '保存中…' : '保存' }}</button>
            <button type="button" class="btn-ghost-sm" @click="handleCancelAnswerEdit">取消</button>
            <button v-if="hasCustomAnswer" type="button" class="btn-danger-ghost-sm" @click="deleteOverride">删除自定义答案</button>
          </div>
          <p v-if="answerSaveStatus === 'error'" style="font-size: 12px; color: var(--danger)">保存失败，请重试</p>
        </div>
        <section v-else class="answer-content" aria-label="答案内容">
          <MarkdownRenderer :content="displayedAnswerText" />
        </section>

        <!-- Status actions -->
        <div style="padding-top: 16px; border-top: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 12px">
          <p style="font-size: 12px; font-weight: 500; color: var(--text-2)">你掌握了吗？</p>
          <div style="display: flex; gap: 8px">
            <button type="button" class="status-btn" :class="{ active: (justMarked === 'review' && lastPressedKey === '1') || (currentStatus === 'review' && lastPressedKey !== '2' && justMarked !== 'review') }" data-variant="danger" @click="handleSetStatus('review', '1')" :disabled="marking">
              <div style="display: flex; align-items: center; gap: 5px">
                <span class="status-label">没掌握</span>
                <span class="status-kbd">1</span>
              </div>
              <span class="status-sub">加入待复习</span>
            </button>
            <button type="button" class="status-btn" :class="{ active: justMarked === 'review' && lastPressedKey === '2' }" data-variant="warning" @click="handleSetStatus('review', '2')" :disabled="marking">
              <div style="display: flex; align-items: center; gap: 5px">
                <span class="status-label">大概会</span>
                <span class="status-kbd">2</span>
              </div>
              <span class="status-sub">还需巩固</span>
            </button>
            <button type="button" class="status-btn" :class="{ active: justMarked === 'mastered' || currentStatus === 'mastered' }" data-variant="success" @click="handleSetStatus('mastered', '3')" :disabled="marking">
              <div style="display: flex; align-items: center; gap: 5px">
                <span class="status-label">完全掌握</span>
                <span class="status-kbd">3</span>
              </div>
              <span class="status-sub">不再推荐</span>
            </button>
          </div>
          <div v-if="marking" style="display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 12px; color: var(--text-3)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 0.8s linear infinite"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"/></svg>
            保存中…
          </div>
        </div>

        <!-- Notes (inline, compact) -->
        <div style="padding-top: 8px; border-top: 1px solid var(--border-subtle)">
          <button type="button" @click="openNoteDialog" style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-3); background: none; border: none; cursor: pointer; padding: 4px 0; transition: color 0.15s">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5z"/><path d="M8 7h6"/><path d="M8 11h8"/></svg>
            {{ hasNote ? '编辑笔记' : '添加笔记' }} (N)
          </button>
        </div>
      </div>

      <!-- AI Panel (inline) -->
      <div v-if="showAI && answerVisible" class="card animate-fade-in" style="padding: 16px; display: flex; flex-direction: column; gap: 12px">
        <div style="display: flex; align-items: center; justify-content: space-between">
          <span style="font-size: 12px; font-weight: 600; color: var(--text-2)">AI 助手</span>
          <button type="button" @click="showAI = false" style="background: none; border: none; color: var(--text-3); cursor: pointer; padding: 2px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <!-- Quick actions -->
        <div v-if="aiMessages.length === 0 && !ai.streaming" style="display: flex; flex-wrap: wrap; gap: 6px">
          <button v-for="action in quickActions" :key="action.id" type="button" class="quick-action-btn" @click="sendAIMessage(action.prompt)" :disabled="ai.streaming">{{ action.icon }} {{ action.label }}</button>
        </div>
        <!-- Messages -->
        <div v-if="aiMessages.length > 0 || ai.streaming" style="display: flex; flex-direction: column; gap: 8px; max-height: 360px; overflow-y: auto">
          <div v-for="(msg, i) in aiMessages" :key="i" :style="{ padding: '10px 12px', borderRadius: '10px', fontSize: '13px', background: msg.role === 'user' ? 'var(--primary-light)' : 'var(--surface-2)', marginLeft: msg.role === 'user' ? '24px' : '0', marginRight: msg.role === 'assistant' ? '24px' : '0' }">
            <div style="font-size: 11px; color: var(--text-3); margin-bottom: 4px">{{ msg.role === 'user' ? '你' : 'AI 助手' }}</div>
            <MarkdownRenderer v-if="msg.role === 'assistant'" :content="msg.content" />
            <span v-else>{{ msg.content }}</span>
          </div>
          <div v-if="ai.streaming && streamedText" style="padding: 10px 12px; border-radius: 10px; font-size: 13px; background: var(--surface-2); margin-right: 24px">
            <div style="font-size: 11px; color: var(--text-3); margin-bottom: 4px">AI 助手</div>
            <MarkdownRenderer :content="streamedText" />
          </div>
        </div>
        <!-- Input -->
        <div style="display: flex; gap: 6px">
          <input v-model="aiInput" type="text" placeholder="向 AI 助手提问…" class="ai-input" @keydown.enter="sendAIMessage(aiInput)" :disabled="ai.streaming || !ai.config.enabled" />
          <button type="button" class="btn-primary-sm" @click="sendAIMessage(aiInput)" :disabled="ai.streaming || !aiInput.trim() || !ai.config.enabled">发送</button>
          <button v-if="ai.streaming" type="button" class="btn-danger-sm" @click="ai.abortStream()">停止</button>
        </div>
        <p v-if="!ai.config.enabled" style="font-size: 11px; color: var(--text-3)">请在设置中配置 API Key 以启用 AI 功能</p>
      </div>

      <!-- Related practice -->
      <div v-if="relatedPracticeItems.length > 0 && !isInSession" class="card animate-fade-in" style="padding: 18px; display: flex; flex-direction: column; gap: 14px">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap">
          <div style="min-width: 0">
            <p style="font-size: 11px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 5px">同主题加练</p>
            <h2 style="font-size: 17px; font-weight: 700; color: var(--text); line-height: 1.35">继续巩固相近考点</h2>
            <p style="font-size: 13px; color: var(--text-2); margin-top: 5px; line-height: 1.6">已按标签、模块和掌握状态挑出最相关的题目。</p>
          </div>
          <button type="button" class="btn-secondary-sm" @click="handleStartRelatedPractice">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            练这 {{ relatedPracticeItems.length }} 题
          </button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px">
          <RouterLink v-for="item in relatedPracticeItems.slice(0, 3)" :key="item.question.id" :to="`/questions/${item.question.id}`"
            style="display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 11px 12px; border-radius: 10px; border: 1px solid var(--border-subtle); background: var(--surface-2); text-decoration: none; color: inherit">
            <div style="min-width: 0">
              <p style="font-size: 13px; font-weight: 600; color: var(--text); line-height: 1.45; margin-bottom: 5px">{{ item.question.question }}</p>
              <p style="font-size: 11px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                {{ [item.question.module, item.matchedTags.length > 0 ? item.matchedTags.slice(0, 2).join(' / ') : null].filter(Boolean).join(' · ') }}
              </p>
            </div>
            <div style="display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end">
              <span :style="{ fontSize: '11px', fontWeight: 500, padding: '2px 7px', borderRadius: '5px', border: '1px solid', color: DIFFICULTY_STYLES[item.question.difficulty].color, background: DIFFICULTY_STYLES[item.question.difficulty].background, borderColor: DIFFICULTY_STYLES[item.question.difficulty].borderColor }">{{ DIFFICULTY_LABELS[item.question.difficulty] }}</span>
              <span :style="{ fontSize: '11px', fontWeight: 500, padding: '2px 7px', borderRadius: '5px', border: '1px solid', color: STATUS_STYLES[item.status].color, background: STATUS_STYLES[item.status].background, borderColor: STATUS_STYLES[item.status].borderColor }">{{ STATUS_LABELS[item.status] }}</span>
            </div>
          </RouterLink>
        </div>
      </div>

      <!-- Streak pill -->
      <div v-if="study.streak.currentStreak >= 2" class="streak-pill">
        <span style="font-size: 16px">🔥</span>
        <span style="font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums">{{ study.streak.currentStreak }}</span>
        <span>连击</span>
        <span v-if="study.streak.bestStreak > study.streak.currentStreak" style="font-size: 11px; color: var(--text-3); margin-left: 2px">最高 {{ study.streak.bestStreak }}</span>
        <span style="font-size: 11px; color: var(--text-3); margin-left: 2px">· 今日 {{ study.streak.todayCount }} 题</span>
      </div>

      <!-- Keyboard shortcuts -->
      <div class="shortcut-hints">
        <template v-if="!answerVisible">
          <span class="shortcut-item"><span class="kbd">Space</span> 查看答案</span>
        </template>
        <template v-else>
          <span class="shortcut-item"><span class="kbd">1</span> 没掌握</span>
          <span class="shortcut-item"><span class="kbd">2</span> 大概会</span>
          <span class="shortcut-item"><span class="kbd">3</span> 完全掌握</span>
        </template>
        <span class="shortcut-item"><span class="kbd">→</span> 下一题</span>
        <span class="shortcut-item"><span class="kbd">←</span> 上一题</span>
        <span class="shortcut-item"><span class="kbd">N</span> 笔记</span>
        <span class="shortcut-item"><span class="kbd">A</span> AI 助手</span>
      </div>

      <!-- Navigation -->
      <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 8px">
        <button type="button" @click="navigateTo(prevId)" :disabled="!prevId" class="nav-btn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          上一题
        </button>
        <RouterLink to="/questions" class="back-link">返回列表</RouterLink>
        <button type="button" @click="navigateTo(nextId)" :disabled="!nextId" class="nav-btn">
          下一题
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </button>
      </div>
    </template>

    <!-- Not found -->
    <div v-else class="card" style="padding: 60px 20px; text-align: center">
      <p style="font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 6px">题目不存在</p>
      <RouterLink to="/questions" style="font-size: 13px; color: var(--primary)">返回题库</RouterLink>
    </div>

    <!-- Note Drawer -->
    <template v-if="noteOpen">
      <button type="button" aria-label="关闭笔记" @click="closeNoteDialog" class="drawer-backdrop" />
      <aside ref="noteDialogRef" role="dialog" aria-modal="true" aria-label="题目笔记" tabindex="-1" class="note-drawer">
        <div class="note-drawer-header">
          <div style="min-width: 0">
            <div style="display: flex; align-items: center; gap: 8px">
              <p style="font-size: 14px; font-weight: 600; color: var(--text)">题目笔记</p>
              <span style="display: inline-flex; align-items: center; gap: 4px">
                <span class="kbd">N</span>
                <span class="kbd">Esc</span>
              </span>
            </div>
            <p style="font-size: 12px; color: var(--text-3); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ question?.question }}</p>
          </div>
          <button type="button" aria-label="关闭题目笔记" @click="closeNoteDialog" class="note-drawer-close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style="flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column">
          <textarea
            v-model="noteText"
            placeholder="记录你的理解、疑问或补充…"
            class="note-textarea"
            @blur="saveNote"
          />
        </div>
      </aside>
    </template>
  </div>
</template>

<style scoped>
/* ─── Reveal button ─── */
.reveal-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 14px;
  border-radius: 12px;
  border: 2px dashed var(--border);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  transition: all 0.18s;
  margin-top: 4px;
}
.reveal-btn:hover {
  border-color: rgba(var(--primary-rgb), 0.5);
  color: var(--primary);
  background: var(--primary-light);
}

/* ─── Kbd ─── */
.kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-3);
  font-size: 10px;
  font-family: var(--font-mono);
  font-weight: 500;
  line-height: 1;
}

/* ─── Status buttons ─── */
.status-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 10px 8px;
  border-radius: 12px;
  border: 1px solid;
  cursor: pointer;
  transition: all 0.18s;
  font-family: inherit;
  opacity: 1;
}
.status-btn:disabled {
  opacity: 0.4;
  pointer-events: none;
}
.status-btn[data-variant="danger"] {
  color: #ef4444;
  background: rgba(239,68,68,0.06);
  border-color: rgba(239,68,68,0.2);
}
.status-btn[data-variant="danger"]:hover:not(.active):not(:disabled) {
  background: rgba(239,68,68,0.12);
  border-color: rgba(239,68,68,0.3);
}
.status-btn[data-variant="danger"].active {
  color: white;
  background: #ef4444;
  border-color: #ef4444;
}

.status-btn[data-variant="warning"] {
  color: #f59e0b;
  background: rgba(245,158,11,0.06);
  border-color: rgba(245,158,11,0.2);
}
.status-btn[data-variant="warning"]:hover:not(.active):not(:disabled) {
  background: rgba(245,158,11,0.12);
  border-color: rgba(245,158,11,0.3);
}
.status-btn[data-variant="warning"].active {
  color: white;
  background: #f59e0b;
  border-color: #f59e0b;
}

.status-btn[data-variant="success"] {
  color: #10b981;
  background: rgba(16,185,129,0.06);
  border-color: rgba(16,185,129,0.2);
}
.status-btn[data-variant="success"]:hover:not(.active):not(:disabled) {
  background: rgba(16,185,129,0.12);
  border-color: rgba(16,185,129,0.3);
}
.status-btn[data-variant="success"].active {
  color: white;
  background: #10b981;
  border-color: #10b981;
}

.status-label { font-size: 13px; font-weight: 600; }
.status-sub { font-size: 11px; opacity: 0.85; }
.status-sub { opacity: 0.55; }
.status-btn.active .status-sub { opacity: 0.85; }
.status-kbd {
  font-size: 10px;
  font-family: var(--font-mono);
  padding: 1px 4px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-3);
}
.status-btn.active .status-kbd {
  border-color: rgba(255,255,255,0.35);
  background: rgba(255,255,255,0.2);
  color: rgba(255,255,255,0.9);
}

/* ─── Answer editor ─── */
.answer-editor {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  font-family: var(--font-mono);
  line-height: 1.7;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}
.answer-editor:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-light);
}

/* ─── Answer content ─── */
.answer-content {
  min-width: 0;
  font-size: 14px;
  line-height: 1.75;
  color: var(--text);
}

/* ─── Buttons ─── */
.btn-primary-sm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: var(--primary);
  color: white;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: opacity 0.15s;
}
.btn-primary-sm:hover { opacity: 0.9; }
.btn-primary-sm:disabled { opacity: 0.5; cursor: default; }

.btn-ghost-sm {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}

.btn-danger-ghost-sm {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid rgba(239,68,68,0.2);
  background: rgba(239,68,68,0.06);
  color: #ef4444;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}

.btn-danger-sm {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: #ef4444;
  color: white;
  font-size: 12px;
  font-weight: 600;
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
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s;
}
.btn-secondary-sm:hover { background: var(--surface-2); }

/* ─── Answer tool buttons ─── */
.answer-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 7px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition: all 0.15s;
}
.answer-tool-btn:hover,
.answer-tool-btn.active {
  border-color: rgba(var(--primary-rgb), 0.28);
  background: rgba(var(--primary-rgb), 0.08);
  color: var(--primary);
}

/* ─── AI input ─── */
.ai-input {
  flex: 1;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  outline: none;
  font-family: inherit;
}
.ai-input:focus {
  border-color: var(--primary);
}

/* ─── Quick action buttons ─── */
.quick-action-btn {
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}
.quick-action-btn:hover:not(:disabled) {
  border-color: rgba(var(--primary-rgb), 0.3);
  color: var(--primary);
}
.quick-action-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ─── Streak pill ─── */
.streak-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 99px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  width: fit-content;
  font-size: 12px;
  color: var(--text-2);
}

/* ─── Shortcut hints ─── */
.shortcut-hints {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-3);
}
.shortcut-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ─── Navigation ─── */
.nav-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-2);
  background: none;
  border: none;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  font-family: inherit;
}
.nav-btn:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--text);
}
.nav-btn:disabled {
  opacity: 0.3;
  pointer-events: none;
}
.back-link {
  font-size: 12px;
  color: var(--text-3);
  text-decoration: none;
  transition: color 0.15s;
}
.back-link:hover { color: var(--primary); }

/* ─── Drawer ─── */
.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 169;
  background: rgba(0,0,0,0.28);
  backdrop-filter: blur(2px);
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  animation: fade-in 0.16s var(--ease-out) both;
}
.note-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 170;
  width: min(420px, 100vw);
  background: var(--surface);
  border-left: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  animation: drawer-slide-in 0.2s var(--ease-out) both;
  outline: none;
}
.note-drawer-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}
.note-drawer-close {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.note-drawer-close:hover {
  background: var(--surface-2);
  color: var(--text);
}
.note-textarea {
  width: 100%;
  flex: 1;
  min-height: 200px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  line-height: 1.7;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}
.note-textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-light);
}

/* ─── Card ─── */
.card {
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  background: var(--surface);
}

/* ─── Animations ─── */
@keyframes fade-in {
  from { opacity: 0 }
  to { opacity: 1 }
}
@keyframes drawer-slide-in {
  from { transform: translateX(24px); opacity: 0.5 }
  to { transform: translateX(0); opacity: 1 }
}
@keyframes spin {
  to { transform: rotate(360deg) }
}

/* ─── Responsive ─── */
@media (max-width: 520px) {
  .note-drawer {
    top: auto;
    left: 0;
    right: 0;
    width: 100%;
    height: min(82dvh, 640px);
    border-left: none;
    border-top: 1px solid var(--border-subtle);
    border-radius: 18px 18px 0 0;
    animation: slide-up 0.2s var(--ease-out) both;
  }
  @keyframes slide-up {
    from { transform: translateY(100%) }
    to { transform: translateY(0) }
  }
}
</style>
