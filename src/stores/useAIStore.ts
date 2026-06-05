import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { requestChatCompletionStream } from '@/lib/aiClient'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AIProviderId = 'openai' | 'deepseek' | 'dashscope' | 'zhipu' | 'custom'

export interface AIConfig {
  enabled: boolean
  provider: AIProviderId
  apiKey: string
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  systemPrompt: string
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AISession {
  questionId: string
  messages: AIMessage[]
  createdAt: number
  updatedAt: number
}

export interface AIQuickAction {
  id: string
  label: string
  icon: string
  prompt: string
}

export interface AnswerFeedbackInput {
  questionText: string
  referenceAnswer: string
  userAnswer: string
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'grimoireface_ai_config'
const SESSIONS_KEY = 'grimoireface_ai_sessions'
const CONFIG_SYNC_EVENT = 'grimoireface_ai_config_updated'

// ─── Provider Presets ─────────────────────────────────────────────────────────

export interface AIModelPreset {
  label: string
  value: string
  description?: string
  recommended?: boolean
}

export interface AIProviderPreset {
  id: AIProviderId
  label: string
  shortLabel: string
  baseUrl: string
  defaultModel: string
  apiKeyPlaceholder: string
  note: string
  models: AIModelPreset[]
}

export const DEFAULT_SYSTEM_PROMPT = `你是 GrimoireFace 的技术面试教练，负责帮助用户把面试题答清楚、答准确、答得像真实候选人。

## 工作原则
- 先识别题目所属模块和难度，再决定解释深度；不要默认只按前端回答。
- 围绕当前题目回答，优先解决"面试中怎么说"和"为什么这样说"。
- 参考答案只是材料，不要机械复述；可以指出参考答案遗漏或表达不佳之处。
- 明确区分：必答点、加分点、常见误区。
- 需要代码时给最小可读示例，不堆大段代码。
- 不确定或题目信息不足时直接说明，并给出合理假设。

## 默认输出风格
- 使用中文，Markdown 简洁排版。
- 默认 200-500 字；用户要求深入时再展开。
- 适合口头表达，少用论文式长句和空泛套话。
- 多轮追问时直接回答，不重复完整模板。

## 首次讲解建议结构
### 核心结论
用 1 句话先给答案。

### 面试表达
给一段 30-60 秒能直接说出口的回答。

### 关键点
列 3-5 个要点，每个要点解释它为什么重要。

### 追问与误区
给 2-3 个高频追问或易错点。`

export const DEFAULT_AI_CONFIG: AIConfig = {
  enabled: false,
  provider: 'openai',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5.4-mini',
  temperature: 0.7,
  maxTokens: 2000,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
}

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI 官方',
    shortLabel: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4-mini',
    apiKeyPlaceholder: 'sk-...',
    note: '官方 Chat Completions 兼容模型，默认选择速度、质量和成本更均衡的 GPT-5.4 mini。',
    models: [
      { label: 'GPT-5.4 Mini', value: 'gpt-5.4-mini', description: '推荐：面试教练、代码解释、日常问答', recommended: true },
      { label: 'GPT-5.5', value: 'gpt-5.5', description: '旗舰：复杂推理和高质量编码' },
      { label: 'GPT-5.4', value: 'gpt-5.4', description: '高质量：复杂任务成本更低' },
      { label: 'GPT-5.4 Nano', value: 'gpt-5.4-nano', description: '轻量：更低延迟和成本' },
      { label: 'GPT-4.1', value: 'gpt-4.1', description: '非推理通用模型' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    shortLabel: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    apiKeyPlaceholder: 'sk-...',
    note: 'DeepSeek V4 官方模型。deepseek-chat / deepseek-reasoner 是旧兼容名，将于 2026-07-24 废弃。',
    models: [
      { label: 'DeepSeek V4 Flash', value: 'deepseek-v4-flash', description: '推荐：速度快、成本低，适合常规问答和代码辅助', recommended: true },
      { label: 'DeepSeek V4 Pro', value: 'deepseek-v4-pro', description: '更强：复杂推理、长上下文和高质量代码任务' },
    ],
  },
  {
    id: 'dashscope',
    label: '阿里云百炼 DashScope',
    shortLabel: 'DashScope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.6-flash',
    apiKeyPlaceholder: 'sk-...',
    note: '使用 DashScope 的 OpenAI 兼容模式，适合接入 Qwen 系列文本模型。',
    models: [
      { label: 'Qwen3.6 Flash', value: 'qwen3.6-flash', description: '推荐：低成本、长上下文、常规学习助手', recommended: true },
      { label: 'Qwen3.6 Plus', value: 'qwen3.6-plus', description: '均衡：更强质量和 1M 上下文' },
      { label: 'Qwen3.6 Max Preview', value: 'qwen3.6-max-preview', description: '预览：复杂任务和更强推理' },
      { label: 'Qwen3.5 Flash', value: 'qwen3.5-flash', description: '稳定低成本选项' },
      { label: 'Qwen3.5 Plus', value: 'qwen3.5-plus', description: '稳定均衡选项' },
    ],
  },
  {
    id: 'zhipu',
    label: '智谱 Z.ai / GLM',
    shortLabel: 'GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.1',
    apiKeyPlaceholder: '填写智谱 API Key',
    note: '智谱 OpenAI 兼容接口，GLM-5.1 是当前旗舰文本模型。',
    models: [
      { label: 'GLM-5.1', value: 'glm-5.1', description: '推荐：旗舰模型，适合复杂编码和 Agent 任务', recommended: true },
      { label: 'GLM-5', value: 'glm-5', description: '通用 Agentic Engineering 基座' },
      { label: 'GLM-4.6', value: 'glm-4.6', description: '强代码能力，200K 上下文' },
      { label: 'GLM-4.6 Flash', value: 'glm-4.6-flash', description: '轻量低成本选项' },
    ],
  },
  {
    id: 'custom',
    label: '自定义兼容接口',
    shortLabel: '自定义',
    baseUrl: '',
    defaultModel: '',
    apiKeyPlaceholder: 'sk-...',
    note: '用于 OpenAI Chat Completions 兼容接口，例如代理网关或自部署模型服务。',
    models: [],
  },
]

export const PRESET_MODELS = [
  ...AI_PROVIDER_PRESETS.flatMap((p) => p.models),
  { label: '自定义', value: 'custom' },
]

export const PRESET_BASE_URLS = [
  ...AI_PROVIDER_PRESETS.filter((p) => p.id !== 'custom').map((p) => ({
    label: p.label,
    value: p.baseUrl,
  })),
  { label: '自定义', value: 'custom' },
]

export function getAIProviderPreset(providerId: AIProviderId): AIProviderPreset {
  return AI_PROVIDER_PRESETS.find((p) => p.id === providerId) ?? AI_PROVIDER_PRESETS[AI_PROVIDER_PRESETS.length - 1]
}

function isAIProviderId(value: unknown): value is AIProviderId {
  return AI_PROVIDER_PRESETS.some((p) => p.id === value)
}

function inferProviderId(config: Pick<AIConfig, 'baseUrl' | 'model'>): AIProviderId {
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const matchedByUrl = AI_PROVIDER_PRESETS.find(
    (p) => p.id !== 'custom' && p.baseUrl.replace(/\/$/, '') === baseUrl,
  )
  if (matchedByUrl) return matchedByUrl.id
  const matchedByModel = AI_PROVIDER_PRESETS.find((p) =>
    p.models.some((m) => m.value === config.model),
  )
  return matchedByModel?.id ?? 'custom'
}

function normalizeConfig(config: Partial<AIConfig>): AIConfig {
  const next: AIConfig = { ...DEFAULT_AI_CONFIG, ...config }
  next.systemPrompt = normalizeSystemPrompt(config.systemPrompt)
  if (next.model === 'deepseek-chat' || next.model === 'deepseek-reasoner') {
    return {
      ...next,
      provider: 'deepseek',
      baseUrl: getAIProviderPreset('deepseek').baseUrl,
      model: 'deepseek-v4-flash',
    }
  }
  next.provider = isAIProviderId(config.provider) ? config.provider : inferProviderId(next)
  return next
}

function normalizeSystemPrompt(systemPrompt: unknown): string {
  const prompt = typeof systemPrompt === 'string' ? systemPrompt.trim() : ''
  if (!prompt) return DEFAULT_SYSTEM_PROMPT
  const isLegacyDefault =
    prompt.includes('专业的前端面试教练') && prompt.includes('只回答与前端开发、面试相关的问题')
  return isLegacyDefault ? DEFAULT_SYSTEM_PROMPT : prompt
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_AI_CONFIG }
    return normalizeConfig(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_AI_CONFIG }
  }
}

function saveConfig(config: AIConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {}
}

function emitConfigSync(config: AIConfig): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CONFIG_SYNC_EVENT, { detail: config }))
}

function loadSessions(): Record<string, AISession> {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function saveSessions(sessions: Record<string, AISession>): void {
  try {
    const entries = Object.entries(sessions).sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    const trimmed = Object.fromEntries(entries.slice(0, 50))
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(trimmed))
  } catch {}
}

// ─── Pinia Store ──────────────────────────────────────────────────────────────

let _activeAbortController: AbortController | null = null

export const useAIStore = defineStore('ai', () => {
  const config = ref<AIConfig>(loadConfig())
  const sessions = ref<Record<string, AISession>>(loadSessions())
  const streaming = ref(false)
  const streamingQuestionId = ref<string | null>(null)

  // Persist sessions on change
  watch(sessions, (val) => saveSessions(val), { deep: true })

  // Cross-tab config sync
  if (typeof window !== 'undefined') {
    window.addEventListener(CONFIG_SYNC_EVENT, (event: Event) => {
      const next = event instanceof CustomEvent ? normalizeConfig(event.detail) : loadConfig()
      config.value = next
    })
    window.addEventListener('storage', (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) config.value = loadConfig()
    })
  }

  // ── Config Actions ──

  function updateConfig(patch: Partial<AIConfig>) {
    const next = normalizeConfig({ ...config.value, ...patch })
    config.value = next
    saveConfig(next)
    emitConfigSync(next)
  }

  function resetConfig() {
    config.value = { ...DEFAULT_AI_CONFIG }
    saveConfig(DEFAULT_AI_CONFIG)
    emitConfigSync(DEFAULT_AI_CONFIG)
  }

  // ── Session Actions ──

  function getSession(questionId: string): AISession | undefined {
    return sessions.value[questionId]
  }

  function getMessages(questionId: string): AIMessage[] {
    return sessions.value[questionId]?.messages ?? []
  }

  function clearSession(questionId: string) {
    const next = { ...sessions.value }
    delete next[questionId]
    sessions.value = next
  }

  function replaceSessionMessages(questionId: string, messages: AIMessage[]) {
    const existing = sessions.value[questionId]
    const now = Date.now()
    sessions.value = {
      ...sessions.value,
      [questionId]: {
        questionId,
        messages,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      },
    }
  }

  function clearAllSessions() {
    sessions.value = {}
  }

  function upsertSessions(newSessions: AISession[]) {
    const next = { ...sessions.value }
    for (const session of newSessions) {
      next[session.questionId] = session
    }
    sessions.value = next
  }

  function abortStream() {
    if (_activeAbortController) {
      _activeAbortController.abort()
      _activeAbortController = null
    }
    streaming.value = false
    streamingQuestionId.value = null
  }

  // ── AI Chat ──

  async function sendMessage(
    questionId: string,
    userMessage: string,
    contextMessages: AIMessage[],
    systemSuffix: string,
    onChunk: (chunk: string) => void,
    onDone: (fullText: string) => void,
    onError: (error: string) => void,
  ): Promise<void> {
    if (!config.value.apiKey.trim()) {
      onError('请先在设置中配置 API Key')
      return
    }
    if (!config.value.enabled) {
      onError('请先在设置中启用 AI 功能')
      return
    }

    streaming.value = true
    streamingQuestionId.value = questionId

    const userMsg: AIMessage = { role: 'user', content: userMessage }
    const existing = sessions.value[questionId]
    const now = Date.now()
    sessions.value = {
      ...sessions.value,
      [questionId]: existing
        ? { ...existing, messages: [...existing.messages, userMsg], updatedAt: now }
        : { questionId, messages: [userMsg], createdAt: now, updatedAt: now },
    }

    const baseSystem = buildSystemPrompt(config.value.systemPrompt)
    const systemContent = systemSuffix ? baseSystem + systemSuffix : baseSystem

    const messages: AIMessage[] = [
      { role: 'system', content: systemContent },
      ...contextMessages,
      userMsg,
    ]

    const controller = new AbortController()
    _activeAbortController = controller

    try {
      const fullText = await requestChatCompletionStream({
        config: {
          apiKey: config.value.apiKey,
          baseUrl: config.value.baseUrl,
          model: config.value.model,
          temperature: config.value.temperature,
          maxTokens: config.value.maxTokens,
        },
        messages,
        signal: controller.signal,
        onDelta: (delta) => onChunk(delta),
      })

      const assistantMsg: AIMessage = { role: 'assistant', content: fullText }
      const sess = sessions.value[questionId]
      sessions.value = {
        ...sessions.value,
        [questionId]: {
          ...sess!,
          messages: [...sess!.messages, assistantMsg],
          updatedAt: Date.now(),
        },
      }
      onDone(fullText)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        onDone('')
      } else {
        onError(err instanceof Error ? err.message : '未知错误')
      }
    } finally {
      if (_activeAbortController === controller) _activeAbortController = null
      streaming.value = false
      streamingQuestionId.value = null
    }
  }

  return {
    config,
    sessions,
    streaming,
    streamingQuestionId,
    updateConfig,
    resetConfig,
    getSession,
    getMessages,
    clearSession,
    replaceSessionMessages,
    clearAllSessions,
    upsertSessions,
    sendMessage,
    abortStream,
  }
})

// ─── Prompt Builders (exported as standalone functions) ────────────────────────

export function buildSystemPrompt(customPrompt?: string): string {
  return customPrompt?.trim() || DEFAULT_SYSTEM_PROMPT
}

export function buildQuestionSystemSuffix(
  question: string,
  module: string,
  difficulty: number,
  referenceAnswer?: string,
): string {
  return `\n\n---\n## 当前题目上下文\n${buildQuestionContext(question, module, difficulty, referenceAnswer)}`
}

export function buildQuestionContext(
  question: string,
  module: string,
  difficulty: number,
  referenceAnswer?: string,
): string {
  const diffLabel = ['', '初级', '中级', '高级'][difficulty] ?? '未知'
  let ctx = `### 题目\n- 模块：${module}\n- 难度：${diffLabel}\n- 题干：${question}`
  if (referenceAnswer) ctx += `\n\n### 参考答案\n${referenceAnswer}`
  return ctx
}

export function buildAnswerFeedbackSystemSuffix(): string {
  return `\n\n---\n## 当前任务：批改用户自测作答
你正在批改用户在查看参考答案前写下的作答。请只基于题目、参考答案和用户作答给反馈。

### 评估重点
- 覆盖度：是否答到核心必答点。
- 准确性：是否有概念混淆、因果倒置、过度绝对化。
- 表达质量：是否适合面试口头表达，是否有结构。

### 输出格式
#### 结论
用一句话判断：基本掌握 / 部分掌握 / 需要补齐，并说明最主要原因。

#### 做得好的
列 1-2 条，必须具体对应用户原文。

#### 需要补齐
最多 3 条，每条包含"问题 + 怎么补"。

#### 面试版回答
给一段 60-100 字的可复述版本，帮助用户直接修正表达。

#### 参考评分
放在全文最后，给出自测参考分，不要放到开头。格式固定为：
- 总分：0-100/100
- 覆盖度：0-40/40
- 准确性：0-40/40
- 表达：0-20/20

### 风格要求
- 严格但友善，不空泛鼓励。
- 不要逐字复述完整参考答案。
- 除参考评分外，总字数控制在 350 字以内。`
}

export function buildAnswerFeedbackContext({
  questionText,
  referenceAnswer,
  userAnswer,
}: AnswerFeedbackInput): AIMessage[] {
  return [
    {
      role: 'user',
      content: `## 题目\n${questionText}\n\n## 参考答案\n${referenceAnswer}\n\n## 用户作答\n${userAnswer}`,
    },
  ]
}

export function getAIQuickActions(hasAnswer: boolean): AIQuickAction[] {
  return [
    {
      id: 'analyze',
      label: '分析考点',
      icon: '🎯',
      prompt: '请分析这道题的核心考点。按"必答点 / 考察能力 / 高频误区 / 一句话面试表达"输出，重点帮我知道面试官到底想听什么。',
    },
    {
      id: 'structure',
      label: '答题结构',
      icon: '📝',
      prompt: '请给我一个适合面试口述的答题结构：先给 30 秒版本，再给 2 分钟展开版本，并标出哪些点必须说、哪些点是加分项。',
    },
    {
      id: 'explain',
      label: '讲解知识点',
      icon: '📖',
      prompt: '请深入讲解这道题涉及的核心知识点。先讲原理，再讲工程场景，最后给一个容易混淆的对比或小例子。',
    },
    ...(hasAnswer
      ? [
          {
            id: 'improve',
            label: '优化答案',
            icon: '✨',
            prompt: '请基于参考答案提炼一版更适合面试口头表达的回答。不要照抄参考答案，要压缩成清晰、有层次、能直接复述的版本，并指出 2 个加分表达。',
          },
        ]
      : []),
    {
      id: 'followup',
      label: '追问预测',
      icon: '🔮',
      prompt: '请模拟面试官，列出这道题后最可能继续追问的 3-5 个问题。每个追问给出简短回答思路，并标注难度。',
    },
    {
      id: 'pitfalls',
      label: '踩坑提醒',
      icon: '⚠️',
      prompt: '请指出回答这道题时最容易踩的坑。按"错误说法 / 为什么错 / 正确表达"整理，优先列高频误区。',
    },
    {
      id: 'practice',
      label: '模拟面试',
      icon: '🎤',
      prompt: '请扮演面试官，围绕这道题和我的回答能力做追问式模拟面试。一次只问一个问题，等我回答后再点评并继续追问。',
    },
  ]
}
