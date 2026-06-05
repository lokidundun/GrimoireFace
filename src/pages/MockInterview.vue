<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useAIStore } from '@/stores/useAIStore'
import MarkdownRenderer from '@/components/ui/MarkdownRenderer.vue'
import SettingsDrawer from '@/components/layout/SettingsDrawer.vue'
import { useBufferedText } from '@/composables/useBufferedText'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { type ChatCompletionMessage, requestChatCompletionStream } from '@/lib/aiClient'
import {
  deleteMockInterview,
  getAllMockInterviews,
  getAllQuestions,
  putMockInterview,
} from '@/lib/db'
import {
  buildInterviewerMessages,
  buildPlanMessages,
  buildReviewMessages,
  createMockInterviewSession,
  createMockInterviewTurn,
  extractDimensionScores,
  extractOverallScore,
  MOCK_LEVEL_LABELS,
  MOCK_TYPE_LABELS,
  type MockInterviewSetupInput,
  parseInterviewerReply,
  parsePlan,
  recommendPracticeQuestions,
} from '@/lib/mockInterview'
import { createPracticeSessionPath } from '@/lib/practiceSession'
import { parseResumeFile } from '@/lib/resumeParser'
import type { MockInterviewLevel, MockInterviewSession, MockInterviewType, Question } from '@/types'

// ─── Types ────────────────────────────────────────────────────────

type BusyState = 'idle' | 'planning' | 'interviewing' | 'reviewing'

interface SetupForm {
  roleTitle: string
  level: MockInterviewLevel
  interviewType: MockInterviewType
  durationMinutes: number
  targetQuestionCount: number
  jdText: string
  resumeText: string
  resumeFileName?: string
}

const DEFAULT_FORM: SetupForm = {
  roleTitle: '前端工程师',
  level: 'mid',
  interviewType: 'comprehensive',
  durationMinutes: 30,
  targetQuestionCount: 6,
  jdText: '',
  resumeText: '',
}

const levelOptions: MockInterviewLevel[] = ['junior', 'mid', 'senior']
const typeOptions: MockInterviewType[] = ['technical', 'project', 'comprehensive']

// ─── Helpers ──────────────────────────────────────────────────────

function formatDateTime(timestamp?: number): string {
  if (!timestamp) return '未开始'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function countCandidateAnswers(session: MockInterviewSession): number {
  return session.turns.filter((turn) => turn.role === 'candidate').length
}

function countInterviewerQuestions(session: MockInterviewSession): number {
  return session.turns.filter(
    (turn) => turn.role === 'interviewer' && (turn.kind === 'question' || turn.kind === 'follow_up'),
  ).length
}

function updatedSession(session: MockInterviewSession): MockInterviewSession {
  return { ...session, updatedAt: Date.now() }
}

function cleanDimensionComment(comment: string): string {
  const cleaned = comment.replace(/[*_`]/g, '').trim()
  return cleaned.length > 0 ? cleaned : ''
}

// ─── State ────────────────────────────────────────────────────────

const router = useRouter()
const { config } = useAIStore()
const fileRef = ref<HTMLInputElement | null>(null)
const transcriptEndRef = ref<HTMLDivElement | null>(null)
const reportRef = ref<HTMLDivElement | null>(null)

const form = ref<SetupForm>({ ...DEFAULT_FORM })
const sessions = ref<MockInterviewSession[]>([])
const activeSession = ref<MockInterviewSession | null>(null)
const questions = ref<Question[]>([])
const draftAnswer = ref('')
const busy = ref<BusyState>('idle')
const {
  text: streamingText,
  appendText,
  resetText: setStreamingText,
} = useBufferedText()
const error = ref<string | null>(null)
const resumeMessage = ref<string | null>(null)
const settingsOpen = ref(false)
const parsingResume = ref(false)
const setupCollapsed = ref(false)
const scrollToReportOnReady = ref(false)

const isBusy = computed(() => busy.value !== 'idle')
const aiReady = computed(() => config.enabled && config.apiKey.trim().length > 0)
const setupIsCollapsed = computed(() => Boolean(activeSession.value) && setupCollapsed.value)

const busyLabel = computed(() => {
  switch (busy.value) {
    case 'planning': return '正在生成面试计划'
    case 'reviewing': return '正在生成复盘报告'
    case 'interviewing': return '面试官正在思考'
    default: return ''
  }
})

const answerCount = computed(() => activeSession.value ? countCandidateAnswers(activeSession.value) : 0)
const interviewerQuestionCount = computed(() => activeSession.value ? countInterviewerQuestions(activeSession.value) : 0)

const activeRecommendations = computed(() => {
  const ids = activeSession.value?.report?.recommendedQuestionIds ?? []
  if (!ids.length) return []
  const byId = new Map(questions.value.map((q) => [q.id, q]))
  return ids.map((id) => byId.get(id)).filter((item): item is Question => Boolean(item))
})

// ─── Lifecycle ────────────────────────────────────────────────────

onMounted(async () => {
  const [loaded, qs] = await Promise.all([
    getAllMockInterviews(),
    getAllQuestions(),
  ])
  sessions.value = loaded
  questions.value = qs
})

// Auto-scroll transcript
watch(
  () => `${activeSession.value?.id ?? ''}:${activeSession.value?.turns.length ?? 0}:${streamingText.value.length}`,
  () => {
    nextTick(() => {
      transcriptEndRef.value?.scrollIntoView({ behavior: isBusy.value ? 'auto' : 'smooth', block: 'end' })
    })
  },
)

// Scroll to report when ready
watch(
  () => activeSession.value?.report?.createdAt ?? 0,
  (val) => {
    if (!val || !scrollToReportOnReady.value) return
    nextTick(() => {
      reportRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      scrollToReportOnReady.value = false
    })
  },
)

// ─── Actions ──────────────────────────────────────────────────────

async function saveSession(session: MockInterviewSession): Promise<MockInterviewSession> {
  const next = updatedSession(session)
  await putMockInterview(next)
  activeSession.value = next
  sessions.value = [
    next,
    ...sessions.value.filter((item) => item.id !== next.id),
  ].sort((a, b) => b.updatedAt - a.updatedAt)
  return next
}

async function requestAI(
  messages: ChatCompletionMessage[],
  onDelta: (delta: string) => void,
  maxTokens = 1800,
): Promise<string> {
  if (!config.enabled) throw new Error('请先在设置中启用 AI 功能')
  if (!config.apiKey.trim()) throw new Error('请先在设置中配置 API Key')

  return requestChatCompletionStream({
    config: {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      temperature: Math.min(0.8, Math.max(0.3, config.temperature)),
      maxTokens,
    },
    messages,
    onDelta,
  })
}

const speech = useSpeechRecognition({
  lang: 'zh-CN',
  onFinalTranscript: (text) => {
    draftAnswer.value = `${draftAnswer.value}${draftAnswer.value.trim() ? '\n' : ''}${text}`
  },
})

function updateForm(patch: Partial<SetupForm>) {
  form.value = { ...form.value, ...patch }
}

async function handleResumeFile(file: File) {
  parsingResume.value = true
  resumeMessage.value = null
  error.value = null
  try {
    const parsed = await parseResumeFile(file)
    updateForm({ resumeText: parsed.text, resumeFileName: parsed.fileName })
    resumeMessage.value = parsed.warning ?? `已解析 ${parsed.fileName}`
  } catch (err) {
    error.value = err instanceof Error ? err.message : '简历解析失败'
  } finally {
    parsingResume.value = false
    if (fileRef.value) fileRef.value.value = ''
  }
}

async function finishSession(session: MockInterviewSession) {
  busy.value = 'reviewing'
  setStreamingText('')
  error.value = null

  try {
    const rawReport = await requestAI(buildReviewMessages(session), appendText, 2600)
    const report = {
      markdown: rawReport,
      overallScore: extractOverallScore(rawReport),
      dimensions: extractDimensionScores(rawReport),
      recommendedQuestionIds: [] as string[],
      createdAt: Date.now(),
    }
    const sessionWithReport: MockInterviewSession = {
      ...session,
      status: 'completed',
      completedAt: Date.now(),
      report,
    }
    const recommended = recommendPracticeQuestions(sessionWithReport, questions.value)
    await saveSession({
      ...sessionWithReport,
      report: { ...report, recommendedQuestionIds: recommended.map((q) => q.id) },
    })
    scrollToReportOnReady.value = true
    setStreamingText('')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '生成复盘失败'
  } finally {
    busy.value = 'idle'
  }
}

async function handleStartInterview() {
  if (!aiReady.value) { error.value = '请先在设置中启用 AI 并配置 API Key'; return }
  if (!form.value.roleTitle.trim()) { error.value = '请填写目标岗位'; return }
  if (!form.value.jdText.trim() && !form.value.resumeText.trim()) {
    error.value = '请至少提供 JD 或简历文本'; return
  }

  busy.value = 'planning'
  setStreamingText('')
  error.value = null

  const input: MockInterviewSetupInput = { ...form.value, model: config.model }
  const draftSession = createMockInterviewSession(input)
  activeSession.value = draftSession

  try {
    const rawPlan = await requestAI(buildPlanMessages(input), appendText, 1400)
    const fallbackQuestion = `我们先从你的经历开始。请结合简历，介绍一个和 ${form.value.roleTitle} 最相关的项目。`
    const plan = parsePlan(rawPlan, fallbackQuestion)
    const next: MockInterviewSession = {
      ...draftSession,
      status: 'interviewing',
      plan,
      questionIndex: 1,
      startedAt: Date.now(),
      turns: [createMockInterviewTurn('interviewer', 'question', plan.openingQuestion)],
    }
    await saveSession(next)
    setupCollapsed.value = true
    setStreamingText('')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '生成面试计划失败'
    activeSession.value = null
  } finally {
    busy.value = 'idle'
  }
}

async function handleSubmitAnswer() {
  if (!activeSession.value || activeSession.value.status !== 'interviewing' || isBusy.value) return
  const answer = draftAnswer.value.trim()
  if (!answer) return

  speech.stop()
  draftAnswer.value = ''
  busy.value = 'interviewing'
  setStreamingText('')
  error.value = null

  const answeredSession = await saveSession({
    ...activeSession.value,
    turns: [...activeSession.value.turns, createMockInterviewTurn('candidate', 'answer', answer)],
  })

  try {
    const rawReply = await requestAI(
      buildInterviewerMessages(answeredSession, answer, 'answer'),
      appendText,
      900,
    )
    const reply = parseInterviewerReply(rawReply)
    const kind = reply.action === 'complete' ? 'closing' : reply.action === 'next_question' ? 'question' : 'follow_up'
    const nextSession: MockInterviewSession = {
      ...answeredSession,
      turns: [...answeredSession.turns, createMockInterviewTurn('interviewer', kind, reply.question)],
      questionIndex: reply.action === 'next_question'
        ? Math.min(answeredSession.targetQuestionCount, answeredSession.questionIndex + 1)
        : answeredSession.questionIndex,
      followUpDepth: reply.action === 'follow_up' ? answeredSession.followUpDepth + 1 : 0,
    }
    const saved = await saveSession(nextSession)
    setStreamingText('')

    if (reply.action === 'complete') {
      await finishSession(saved)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '面试官响应失败'
  } finally {
    busy.value = 'idle'
  }
}

async function handleClarify() {
  if (!activeSession.value || activeSession.value.status !== 'interviewing' || isBusy.value) return

  busy.value = 'interviewing'
  setStreamingText('')
  error.value = null

  const clarifyText = '请你澄清一下当前问题。'
  const clarifiedSession = await saveSession({
    ...activeSession.value,
    turns: [...activeSession.value.turns, createMockInterviewTurn('candidate', 'answer', clarifyText)],
  })

  try {
    const rawReply = await requestAI(
      buildInterviewerMessages(clarifiedSession, clarifyText, 'clarify'),
      appendText,
      600,
    )
    const reply = parseInterviewerReply(rawReply)
    await saveSession({
      ...clarifiedSession,
      turns: [...clarifiedSession.turns, createMockInterviewTurn('interviewer', 'clarification', reply.question)],
    })
    setStreamingText('')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '澄清问题失败'
  } finally {
    busy.value = 'idle'
  }
}

async function handleRepeatQuestion() {
  if (!activeSession.value || activeSession.value.status !== 'interviewing' || isBusy.value) return
  const lastQuestion = [...activeSession.value.turns]
    .reverse()
    .find((turn) => turn.role === 'interviewer' && turn.kind !== 'closing')
  if (!lastQuestion) return

  await saveSession({
    ...activeSession.value,
    turns: [
      ...activeSession.value.turns,
      createMockInterviewTurn('interviewer', 'clarification', `我重复一下：${lastQuestion.content}`),
    ],
  })
}

async function handleFinishNow() {
  if (!activeSession.value || activeSession.value.status === 'completed' || isBusy.value) return
  speech.stop()
  const closing = createMockInterviewTurn(
    'interviewer',
    'closing',
    '好的，本次模拟面试到这里。接下来我会基于刚才的表现做复盘。',
  )
  const next = await saveSession({
    ...activeSession.value,
    turns: [...activeSession.value.turns, closing],
  })
  await finishSession(next)
}

async function handleDeleteSession(sessionId: string) {
  await deleteMockInterview(sessionId)
  sessions.value = sessions.value.filter((s) => s.id !== sessionId)
  if (activeSession.value?.id === sessionId) {
    activeSession.value = null
    setupCollapsed.value = false
  }
}

function handleSelectSession(session: MockInterviewSession) {
  activeSession.value = session
  form.value = {
    roleTitle: session.roleTitle,
    level: session.level,
    interviewType: session.interviewType,
    durationMinutes: session.durationMinutes,
    targetQuestionCount: session.targetQuestionCount,
    jdText: session.jdText,
    resumeText: session.resumeText,
    resumeFileName: session.resumeFileName,
  }
  draftAnswer.value = ''
  setStreamingText('')
  error.value = null
  setupCollapsed.value = true
}

function handleNewInterview() {
  speech.stop()
  activeSession.value = null
  draftAnswer.value = ''
  setStreamingText('')
  error.value = null
  setupCollapsed.value = false
}

function handleStartPractice() {
  const ids = activeRecommendations.value.map((q) => q.id)
  if (!ids.length) return
  router.push(createPracticeSessionPath(ids[0], ids))
}

// ScorePill helper
function scoreVariant(score: number | null): string {
  if (score === null) return 'ghost'
  if (score >= 80) return 'success'
  if (score >= 60) return 'warning'
  return 'danger'
}
</script>

<template>
  <div class="page-container mock-page" :class="{ 'has-active-session': activeSession }">
    <!-- Header -->
    <div class="animate-fade-in" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 28px">
      <div>
        <h1 style="font-size: 20px; font-weight: 700; color: var(--text); letter-spacing: -0.015em; margin-bottom: 4px">
          模拟面试
        </h1>
        <p style="font-size: 13px; color: var(--text-3)">
          基于岗位 JD 和简历进行一问一答，结束后查看评分与改进建议
        </p>
      </div>
      <button
        v-if="!aiReady"
        type="button"
        class="mock-btn mock-btn-primary-sm"
        @click="settingsOpen = true"
      >
        配置 AI
      </button>
    </div>

    <!-- Error -->
    <div v-if="error" class="mock-alert">{{ error }}</div>

    <!-- Grid -->
    <div
      class="mock-interview-grid"
      :class="{ 'is-collapsed': setupIsCollapsed, 'has-active': activeSession }"
    >
      <!-- Sidebar -->
      <aside class="mock-sidebar">
        <!-- Collapsed context -->
        <section v-if="setupIsCollapsed" class="mock-panel mock-context-panel">
          <div class="mock-panel-header">
            <h2>本场面试</h2>
            <span class="mock-badge mock-badge-success">{{ config.model }}</span>
          </div>
          <div class="mock-context-meta">
            <span>岗位</span>
            <strong>{{ activeSession?.roleTitle || form.roleTitle || '未指定' }}</strong>
            <span>模式</span>
            <strong>
              {{ activeSession
                ? `${MOCK_TYPE_LABELS[activeSession.interviewType]} · ${MOCK_LEVEL_LABELS[activeSession.level]}`
                : `${MOCK_TYPE_LABELS[form.interviewType]} · ${MOCK_LEVEL_LABELS[form.level]}` }}
            </strong>
            <span>进度</span>
            <strong>
              {{ answerCount }} 次作答 · {{ interviewerQuestionCount }}/{{
                activeSession?.targetQuestionCount ?? form.targetQuestionCount
              }} 问
            </strong>
          </div>
          <div class="mock-context-actions">
            <button type="button" class="mock-btn mock-btn-secondary-sm" style="width: 100%" @click="setupCollapsed = false">
              面试资料
            </button>
            <button type="button" class="mock-btn mock-btn-ghost-sm" style="width: 100%" @click="handleNewInterview">
              新面试
            </button>
          </div>
        </section>

        <!-- Setup form -->
        <section v-else class="mock-panel">
          <div class="mock-panel-header">
            <h2>{{ activeSession ? '面试资料' : '准备面试' }}</h2>
            <div style="display: flex; gap: 8px; align-items: center">
              <span class="mock-badge" :class="aiReady ? 'mock-badge-success' : 'mock-badge-warning'">
                {{ aiReady ? config.model : 'AI 未配置' }}
              </span>
              <button
                v-if="activeSession"
                type="button"
                class="mock-btn mock-btn-ghost-sm"
                @click="setupCollapsed = true"
              >
                收起
              </button>
            </div>
          </div>

          <div class="mock-form">
            <!-- Role -->
            <div class="mock-field">
              <label>目标岗位</label>
              <input
                :value="form.roleTitle"
                @input="updateForm({ roleTitle: ($event.target as HTMLInputElement).value })"
                placeholder="例如：前端工程师"
                class="mock-input"
              />
            </div>

            <!-- Level + Type -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
              <div class="mock-field">
                <label>级别</label>
                <select
                  :value="form.level"
                  @change="updateForm({ level: ($event.target as HTMLSelectElement).value as MockInterviewLevel })"
                  class="mock-select"
                >
                  <option v-for="lvl in levelOptions" :key="lvl" :value="lvl">{{ MOCK_LEVEL_LABELS[lvl] }}</option>
                </select>
              </div>
              <div class="mock-field">
                <label>面试类型</label>
                <select
                  :value="form.interviewType"
                  @change="updateForm({ interviewType: ($event.target as HTMLSelectElement).value as MockInterviewType })"
                  class="mock-select"
                >
                  <option v-for="typ in typeOptions" :key="typ" :value="typ">{{ MOCK_TYPE_LABELS[typ] }}</option>
                </select>
              </div>
            </div>

            <!-- Duration + Question count -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px">
              <div class="mock-field">
                <label>时长</label>
                <select
                  :value="form.durationMinutes"
                  @change="updateForm({ durationMinutes: Number(($event.target as HTMLSelectElement).value) })"
                  class="mock-select"
                >
                  <option v-for="m in [15, 30, 45, 60]" :key="m" :value="m">{{ m }} 分钟</option>
                </select>
              </div>
              <div class="mock-field">
                <label>题数</label>
                <select
                  :value="form.targetQuestionCount"
                  @change="updateForm({ targetQuestionCount: Number(($event.target as HTMLSelectElement).value) })"
                  class="mock-select"
                >
                  <option v-for="c in [4, 6, 8, 10]" :key="c" :value="c">{{ c }} 题</option>
                </select>
              </div>
            </div>

            <!-- JD -->
            <div class="mock-field">
              <label>岗位 JD</label>
              <textarea
                :value="form.jdText"
                @input="updateForm({ jdText: ($event.target as HTMLTextAreaElement).value })"
                placeholder="粘贴岗位职责、任职要求、技术栈关键词..."
                class="mock-textarea"
                style="min-height: 120px"
              />
            </div>

            <!-- Resume -->
            <div class="mock-field">
              <div style="display: flex; flex-direction: column; gap: 6px">
                <span style="font-size: 12px; font-weight: 600; color: var(--text)">简历</span>
                <span v-if="form.resumeFileName" style="font-size: 11px; color: var(--text-3)">{{ form.resumeFileName }}</span>
                <span v-else style="font-size: 11px; color: var(--text-3)">支持 PDF、DOCX、TXT、MD</span>
              </div>
              <input
                ref="fileRef"
                type="file"
                accept=".pdf,.docx,.txt,.md,text/plain,text/markdown,application/pdf"
                style="display: none"
                @change="(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleResumeFile(f) }"
              />
              <div style="display: flex; gap: 8px; margin-bottom: 8px">
                <button
                  type="button"
                  class="mock-btn mock-btn-secondary-sm"
                  :disabled="parsingResume"
                  @click="fileRef?.click()"
                >
                  <svg v-if="parsingResume" class="mock-spinner" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.2" />
                    <path fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" opacity="0.8" />
                  </svg>
                  上传解析
                </button>
                <button
                  v-if="form.resumeText"
                  type="button"
                  class="mock-btn mock-btn-ghost-sm"
                  @click="updateForm({ resumeText: '', resumeFileName: undefined })"
                >
                  清空
                </button>
              </div>
              <p v-if="resumeMessage" style="font-size: 11px; color: var(--text-3); margin-bottom: 8px">{{ resumeMessage }}</p>
              <textarea
                :value="form.resumeText"
                @input="updateForm({ resumeText: ($event.target as HTMLTextAreaElement).value })"
                placeholder="也可以直接粘贴简历文本..."
                class="mock-textarea"
                style="min-height: 120px"
              />
            </div>

            <button
              type="button"
              class="mock-btn mock-btn-primary"
              style="width: 100%"
              :disabled="busy === 'planning'"
              @click="handleStartInterview"
            >
              <svg v-if="busy === 'planning'" class="mock-spinner" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.2" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" opacity="0.8" />
              </svg>
              开始面试
            </button>
          </div>
        </section>

        <!-- History -->
        <section class="mock-panel">
          <div class="mock-panel-header">
            <h2>历史记录</h2>
            <span class="mock-badge mock-badge-ghost">{{ sessions.length }}</span>
          </div>
          <div class="mock-history-list">
            <p v-if="sessions.length === 0" style="font-size: 12px; color: var(--text-3)">暂无记录</p>
            <button
              v-for="session in sessions"
              :key="session.id"
              type="button"
              class="mock-history-item"
              :data-active="activeSession?.id === session.id"
              @click="handleSelectSession(session)"
            >
              <span class="mock-history-main">
                <strong>{{ session.title }}</strong>
                <span>{{ formatDateTime(session.updatedAt) }}</span>
              </span>
              <span class="mock-history-score">
                <span
                  v-if="session.report?.overallScore != null"
                  class="mock-badge"
                  :class="`mock-badge-${scoreVariant(session.report.overallScore)}`"
                  style="font-size: 10px"
                >{{ session.report.overallScore }}/100</span>
                <span v-else class="mock-badge mock-badge-ghost" style="font-size: 10px">未评分</span>
              </span>
            </button>
          </div>
        </section>
      </aside>

      <!-- Main Room -->
      <section class="mock-room">
        <!-- Empty state -->
        <div v-if="!activeSession" class="mock-empty">
          <h2>面试室待开始</h2>
          <p>填入岗位资料后开始。</p>
        </div>

        <template v-else>
          <!-- Room header -->
          <div class="mock-room-header">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
                <h2>{{ activeSession.title }}</h2>
                <span class="mock-badge" :class="activeSession.status === 'completed' ? 'mock-badge-success' : 'mock-badge-primary'">
                  {{ activeSession.status === 'completed' ? '已完成' : '进行中' }}
                </span>
              </div>
              <p>
                {{ MOCK_TYPE_LABELS[activeSession.interviewType] }} · {{ MOCK_LEVEL_LABELS[activeSession.level] }} · {{ answerCount }} 次作答 · {{ interviewerQuestionCount }}/{{ activeSession.targetQuestionCount }} 问
              </p>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end">
              <button
                v-if="activeSession.status !== 'completed'"
                type="button"
                class="mock-btn mock-btn-danger-sm"
                :disabled="isBusy"
                @click="handleFinishNow"
              >
                结束并复盘
              </button>
              <button
                type="button"
                class="mock-btn mock-btn-ghost-sm"
                :disabled="isBusy"
                @click="handleDeleteSession(activeSession.id)"
              >
                删除
              </button>
            </div>
          </div>

          <!-- Busy banner -->
          <output v-if="isBusy && busyLabel" class="mock-busy-banner" aria-live="polite">
            <svg class="mock-spinner" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.2" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" opacity="0.8" />
            </svg>
            <span>{{ busyLabel }}…</span>
          </output>

          <!-- Plan -->
          <div v-if="activeSession.plan" class="mock-plan">
            <div>
              <strong>面试重点</strong>
              <p>{{ activeSession.plan.summary }}</p>
            </div>
            <div class="mock-focus-list">
              <span
                v-for="item in activeSession.plan.focusAreas"
                :key="item"
                class="mock-badge mock-badge-ghost"
              >{{ item }}</span>
            </div>
          </div>

          <!-- Transcript -->
          <div class="mock-transcript">
            <div
              v-for="turn in activeSession.turns"
              :key="turn.id"
              class="mock-turn"
              :class="`mock-turn-${turn.role}`"
            >
              <div class="mock-turn-label">
                {{ turn.role === 'interviewer' ? '面试官' : '候选人' }}
                <span>{{ formatDateTime(turn.createdAt) }}</span>
              </div>
              <p>{{ turn.content }}</p>
            </div>

            <div v-if="streamingText" class="mock-turn mock-turn-interviewer">
              <div class="mock-turn-label">
                {{ busy === 'reviewing' ? '复盘生成中' : busy === 'planning' ? '计划生成中' : '面试官' }}
              </div>
              <MarkdownRenderer v-if="busy === 'reviewing'" :content="streamingText" class="mock-markdown" />
              <p v-else>{{ streamingText }}</p>
            </div>

            <div v-if="isBusy && !streamingText" class="mock-turn mock-turn-interviewer mock-turn-pending">
              <div class="mock-turn-label">{{ busyLabel }}</div>
              <p>正在整理下一步内容，请稍等。</p>
            </div>
            <div ref="transcriptEndRef" />
          </div>

          <!-- Answer box -->
          <div v-if="activeSession.status === 'interviewing'" class="mock-answer-box">
            <textarea
              v-model="draftAnswer"
              placeholder="像真实面试一样作答，可以用语音输入。"
              :disabled="isBusy"
            />
            <div class="mock-answer-actions">
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0">
                <button
                  v-if="speech.supported.value"
                  type="button"
                  class="mock-btn"
                  :class="speech.listening.value ? 'mock-btn-primary-sm' : 'mock-btn-secondary-sm'"
                  :disabled="isBusy"
                  @click="speech.toggle()"
                >
                  {{ speech.listening.value ? '停止语音' : '语音输入' }}
                </button>
                <span v-if="speech.interimTranscript.value" class="mock-interim">
                  正在识别：{{ speech.interimTranscript.value }}
                </span>
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end">
                <button
                  type="button"
                  class="mock-btn mock-btn-ghost-sm"
                  :disabled="isBusy"
                  @click="handleRepeatQuestion"
                >
                  重复问题
                </button>
                <button
                  type="button"
                  class="mock-btn mock-btn-secondary-sm"
                  :disabled="isBusy"
                  @click="handleClarify"
                >
                  澄清题意
                </button>
                <button
                  type="button"
                  class="mock-btn mock-btn-primary-sm"
                  :disabled="!draftAnswer.trim() || busy === 'interviewing'"
                  @click="handleSubmitAnswer"
                >
                  <svg v-if="busy === 'interviewing'" class="mock-spinner" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.2" />
                    <path fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" opacity="0.8" />
                  </svg>
                  提交回答
                </button>
              </div>
            </div>
          </div>

          <!-- Report -->
          <div v-if="activeSession.report" class="mock-report" ref="reportRef">
            <div class="mock-report-header">
              <div>
                <h2>复盘报告</h2>
                <p>{{ formatDateTime(activeSession.report.createdAt) }}</p>
              </div>
              <span
                v-if="activeSession.report.overallScore != null"
                class="mock-badge"
                :class="`mock-badge-${scoreVariant(activeSession.report.overallScore)}`"
              >{{ activeSession.report.overallScore }}/100</span>
              <span v-else class="mock-badge mock-badge-ghost">未评分</span>
            </div>

            <div v-if="activeSession.report.dimensions.length > 0" class="mock-dimensions">
              <div v-for="dim in activeSession.report.dimensions" :key="dim.label">
                <strong>{{ dim.label }}</strong>
                <span>{{ dim.score }}/100</span>
                <p v-if="cleanDimensionComment(dim.comment)">{{ cleanDimensionComment(dim.comment) }}</p>
              </div>
            </div>

            <MarkdownRenderer :content="activeSession.report.markdown" class="mock-markdown" />

            <div v-if="activeRecommendations.length > 0" class="mock-recommendations">
              <div class="mock-panel-header">
                <h2>相关练习</h2>
                <button type="button" class="mock-btn mock-btn-secondary-sm" @click="handleStartPractice">
                  开始练习
                </button>
              </div>
              <div style="display: grid; gap: 8px">
                <RouterLink
                  v-for="q in activeRecommendations"
                  :key="q.id"
                  :to="`/questions/${q.id}`"
                  class="mock-question-link"
                >
                  <span>{{ q.question }}</span>
                  <span class="mock-badge mock-badge-ghost">{{ q.module }}</span>
                </RouterLink>
              </div>
            </div>
          </div>
        </template>
      </section>
    </div>

    <SettingsDrawer :open="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>

<style scoped>
.mock-page {
  max-width: 1100px;
}

.mock-interview-grid {
  display: grid;
  grid-template-columns: 330px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.mock-interview-grid.is-collapsed {
  grid-template-columns: 238px minmax(0, 1fr);
}

.mock-sidebar {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.mock-panel,
.mock-room {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

.mock-panel {
  padding: 14px;
  min-width: 0;
  overflow: hidden;
}

.mock-context-panel {
  position: sticky;
  top: calc(var(--navbar-h) + 14px);
}

.mock-context-meta {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 10px;
  align-items: baseline;
  margin-bottom: 12px;
}

.mock-context-meta span {
  font-size: 11px;
  color: var(--text-3);
}

.mock-context-meta strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text);
}

.mock-context-actions {
  display: grid;
  gap: 8px;
}

.mock-form {
  display: grid;
  gap: 12px;
}

.mock-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mock-field label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.mock-panel-header,
.mock-room-header,
.mock-report-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.mock-panel-header h2,
.mock-room-header h2,
.mock-report-header h2 {
  font-size: 15px;
  line-height: 1.3;
  font-weight: 700;
  color: var(--text);
}

.mock-room-header p,
.mock-report-header p {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-3);
}

/* Form inputs */
.mock-input {
  height: 38px;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  padding: 0 12px;
  font-size: var(--control-font-size);
  outline: none;
  box-sizing: border-box;
}

.mock-select {
  height: 38px;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  padding: 0 10px;
  font-size: var(--control-font-size);
  outline: none;
}

.mock-textarea {
  width: 100%;
  min-height: 120px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  padding: 10px 12px;
  font-size: var(--control-font-size);
  line-height: 1.6;
  resize: vertical;
  outline: none;
  font-family: var(--font-sans);
  box-sizing: border-box;
}

/* Badges */
.mock-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 6px;
  flex-shrink: 0;
}

.mock-badge-success {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.mock-badge-warning {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.mock-badge-danger {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.mock-badge-primary {
  background: var(--primary-light);
  color: var(--primary);
  border: 1px solid rgba(var(--primary-rgb), 0.2);
}

.mock-badge-ghost {
  background: transparent;
  color: var(--text-3);
  border: 1px solid var(--border-subtle);
}

/* Buttons */
.mock-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: inherit;
  font-weight: 500;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid transparent;
  white-space: nowrap;
  user-select: none;
}

.mock-btn:disabled {
  opacity: 0.5;
  pointer-events: none;
}

.mock-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.mock-btn-primary {
  font-size: 14px;
  height: 36px;
  padding: 8px 16px;
  background: var(--primary);
  border-color: var(--primary);
  color: white;
  box-shadow: var(--shadow-md);
}

.mock-btn-primary:hover {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
}

.mock-btn-primary-sm {
  font-size: 12px;
  height: 28px;
  padding: 6px 12px;
  background: var(--primary);
  border-color: var(--primary);
  color: white;
  box-shadow: var(--shadow-md);
}

.mock-btn-primary-sm:hover {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
}

.mock-btn-secondary-sm {
  font-size: 12px;
  height: 28px;
  padding: 6px 12px;
  background: var(--surface);
  border-color: var(--border);
  color: var(--text);
}

.mock-btn-secondary-sm:hover {
  background: var(--surface-2);
}

.mock-btn-ghost-sm {
  font-size: 12px;
  height: 28px;
  padding: 6px 12px;
  background: transparent;
  border-color: transparent;
  color: var(--text-2);
}

.mock-btn-ghost-sm:hover {
  background: var(--surface-2);
  color: var(--text);
}

.mock-btn-danger-sm {
  font-size: 12px;
  height: 28px;
  padding: 6px 12px;
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.mock-btn-danger-sm:hover {
  background: #ef4444;
  border-color: #ef4444;
  color: white;
}

/* Alert */
.mock-alert {
  border: 1px solid rgba(239, 68, 68, 0.22);
  background: var(--danger-light);
  color: var(--danger);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  margin-bottom: 16px;
}

/* Spinner */
.mock-spinner {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  animation: mock-spin 1s linear infinite;
}

@keyframes mock-spin {
  to { transform: rotate(360deg); }
}

/* History */
.mock-history-list {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.mock-history-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--text);
  padding: 10px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}

.mock-history-item[data-active='true'] {
  border-color: rgba(var(--primary-rgb), 0.32);
  background: var(--primary-light);
}

.mock-history-main {
  min-width: 0;
  overflow: hidden;
}

.mock-history-score {
  display: flex;
  justify-content: flex-end;
  min-width: 0;
  max-width: 52px;
  overflow: hidden;
}

.mock-history-item strong,
.mock-history-main > span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mock-history-item strong {
  font-size: 12px;
  color: var(--text);
}

.mock-history-main > span {
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-3);
}

/* Room */
.mock-room {
  min-height: 720px;
  min-width: 0;
  overflow: hidden;
  padding: 16px;
}

.mock-busy-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(var(--primary-rgb), 0.18);
  border-radius: 8px;
  background: var(--primary-light);
  color: var(--primary);
  padding: 9px 11px;
  margin-bottom: 14px;
  font-size: 12px;
  font-weight: 600;
}

.mock-empty {
  min-height: 520px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 8px;
  color: var(--text-3);
}

.mock-empty h2 {
  font-size: 18px;
  color: var(--text);
}

.mock-empty p {
  max-width: 420px;
  font-size: 13px;
}

/* Plan */
.mock-plan {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-2);
  padding: 12px;
  margin-bottom: 14px;
}

.mock-plan strong {
  display: block;
  font-size: 12px;
  color: var(--text);
  margin-bottom: 4px;
}

.mock-plan p {
  font-size: 12px;
  color: var(--text-2);
}

.mock-focus-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
  max-width: 340px;
}

/* Transcript */
.mock-transcript {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  max-height: 520px;
  overflow: auto;
  padding: 2px 2px 12px;
}

.mock-turn {
  min-width: 0;
  max-width: min(760px, 92%);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 12px;
}

.mock-turn-interviewer {
  align-self: flex-start;
  background: var(--surface-2);
}

.mock-turn-candidate {
  align-self: flex-end;
  background: var(--primary-light);
  border-color: rgba(var(--primary-rgb), 0.16);
}

.mock-turn-pending {
  opacity: 0.82;
}

.mock-turn-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-2);
}

.mock-turn-label span {
  font-weight: 400;
  color: var(--text-3);
}

.mock-turn p {
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
}

/* Answer box */
.mock-answer-box {
  border-top: 1px solid var(--border-subtle);
  margin-top: 14px;
  padding-top: 14px;
}

.mock-answer-box textarea {
  width: 100%;
  min-height: 110px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  padding: 12px;
  font-size: var(--control-font-size);
  line-height: 1.7;
  resize: vertical;
  outline: none;
  font-family: var(--font-sans);
  box-sizing: border-box;
}

.mock-answer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.mock-interim {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--primary);
}

/* Report */
.mock-report {
  border-top: 1px solid var(--border-subtle);
  margin-top: 18px;
  padding-top: 18px;
}

.mock-dimensions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.mock-dimensions div {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-2);
  padding: 10px;
}

.mock-dimensions strong,
.mock-dimensions span {
  display: block;
  font-size: 12px;
  color: var(--text);
}

.mock-dimensions span {
  margin-top: 4px;
  font-weight: 700;
  color: var(--primary);
}

.mock-dimensions p {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.5;
}

.mock-markdown :deep(*) {
  font-size: 14px;
  color: var(--text);
  overflow-wrap: anywhere;
}

.mock-recommendations {
  margin-top: 18px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-2);
  padding: 12px;
}

.mock-question-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface);
  padding: 10px 12px;
  color: var(--text);
  text-decoration: none;
}

.mock-question-link span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

@media (max-width: 920px) {
  .mock-interview-grid {
    grid-template-columns: 1fr !important;
  }

  .mock-interview-grid.has-active .mock-sidebar {
    order: 2;
  }

  .mock-interview-grid.has-active .mock-room {
    order: 1;
  }

  .mock-context-panel {
    position: static;
  }

  .mock-room {
    min-height: 560px;
  }

  .mock-turn {
    width: 100%;
    max-width: 100%;
  }

  .mock-plan {
    grid-template-columns: 1fr;
  }

  .mock-focus-list {
    justify-content: flex-start;
    max-width: none;
  }
}
</style>
