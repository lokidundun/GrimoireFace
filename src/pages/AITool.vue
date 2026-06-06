<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAIStore } from '@/stores/useAIStore'
import MarkdownRenderer from '@/components/ui/MarkdownRenderer.vue'
import SettingsDrawer from '@/components/layout/SettingsDrawer.vue'
import { useBufferedText } from '@/composables/useBufferedText'
import { requestChatCompletionStream, type ChatCompletionMessage } from '@/lib/aiClient'

// ─── Types ────────────────────────────────────────────────────────

interface ToolField {
  id: string
  label: string
  placeholder: string
  type: 'input' | 'textarea'
  required?: boolean
  rows?: number
}

interface AIToolConfig {
  id: string
  title: string
  description: string
  actionLabel: string
  loadingText: string
  emptyTitle: string
  emptyDescription: string
  fields: ToolField[]
  outputGuide: string
}

// ─── Tool Configs ─────────────────────────────────────────────────

const TOOL_CONFIGS: AIToolConfig[] = [
  {
    id: 'project-deep-dive',
    title: '项目深挖',
    description: '把一段项目经历拆成面试亮点、技术难点、追问和口语化表达。',
    actionLabel: '生成项目深挖',
    loadingText: '正在拆解项目经历...',
    emptyTitle: '等待项目材料',
    emptyDescription: '填入项目经历后，生成可用于面试的深挖稿和追问清单。',
    fields: [
      { id: 'role', label: '目标岗位', placeholder: '例如：前端工程师 / AI Agent 工程师', type: 'input' },
      { id: 'project', label: '项目经历', placeholder: '粘贴项目背景、你的职责、技术方案、结果数据、遇到的问题。越具体，深挖越准。', type: 'textarea', rows: 9, required: true },
      { id: 'focus', label: '想强调的方向', placeholder: '例如：性能优化、复杂状态管理、工程化、业务推进、Agent 工作流', type: 'textarea', rows: 4 },
    ],
    outputGuide: `
请输出 Markdown，包含：
1. 项目一句话定位
2. 面试官会感兴趣的 5 个亮点
3. 3 个技术难点，每个包含背景、方案、权衡、结果
4. 10 个高概率追问，按技术、业务、协作分组
5. 一版 90 秒口语回答
6. STAR 项目版回答
7. 容易被追问穿的风险点和补强建议
`,
  },
  {
    id: 'interview-questions',
    title: '面试问题',
    description: '基于简历、JD 或项目关键词预测这场面试最可能被问的问题。',
    actionLabel: '预测面试问题',
    loadingText: '正在预测高概率问题...',
    emptyTitle: '等待面试材料',
    emptyDescription: '填入 JD、简历或项目关键词后，生成这场面试的重点问题。',
    fields: [
      { id: 'role', label: '目标岗位', placeholder: '例如：中级前端工程师', type: 'input', required: true },
      { id: 'jd', label: '岗位 JD', placeholder: '粘贴岗位要求、技术栈、业务方向。', type: 'textarea', rows: 7 },
      { id: 'resume', label: '简历 / 项目关键词', placeholder: '粘贴简历摘要、项目关键词、技术栈或你想让面试官关注的经历。', type: 'textarea', rows: 7 },
      { id: 'round', label: '面试轮次', placeholder: '例如：一面技术面 / 二面项目深挖 / HR 面', type: 'input' },
    ],
    outputGuide: `
请输出 Markdown，包含：
1. 这场面试的考察重点
2. 最可能被问的 20 个问题，标注优先级和原因
3. 项目深挖问题
4. 技术基础问题
5. 行为与协作问题
6. 每类问题给 1-2 句回答提示
7. 可以直接拿去练习的 10 问清单
`,
  },
  {
    id: 'review-analysis',
    title: '复盘解析',
    description: '把真实面试记录或个人复盘转成失分点、补强项和下一轮练习清单。',
    actionLabel: '解析复盘',
    loadingText: '正在解析面试复盘...',
    emptyTitle: '等待复盘内容',
    emptyDescription: '粘贴面试记录、问题列表或自己的复盘笔记，生成改进建议。',
    fields: [
      { id: 'role', label: '目标岗位', placeholder: '例如：前端工程师', type: 'input' },
      { id: 'transcript', label: '面试记录 / 复盘', placeholder: '粘贴面试问答、面经记录、自己觉得没答好的地方。', type: 'textarea', rows: 11, required: true },
      { id: 'goal', label: '复盘目标', placeholder: '例如：想知道哪里失分、下次怎么答、哪些知识点要补', type: 'textarea', rows: 4 },
    ],
    outputGuide: `
请输出 Markdown，包含：
1. 本场表现概览
2. 明确失分点，按严重程度排序
3. 知识漏洞和表达问题分开列
4. 关键问题的改进回答示例
5. 需要补强的知识点
6. 下一轮模拟面试建议
7. 3 天补强行动清单
`,
  },
  {
    id: 'self-intro',
    title: '自我介绍',
    description: '生成 30 秒、1 分钟、2 分钟版本，并自然埋入项目追问入口。',
    actionLabel: '生成自我介绍',
    loadingText: '正在生成自我介绍...',
    emptyTitle: '等待个人材料',
    emptyDescription: '填入背景和项目亮点后，生成不同长度的中文面试自我介绍。',
    fields: [
      { id: 'role', label: '目标岗位', placeholder: '例如：前端工程师', type: 'input', required: true },
      { id: 'background', label: '个人背景', placeholder: '年限、行业、技术栈、教育或工作背景。', type: 'textarea', rows: 5, required: true },
      { id: 'projects', label: '项目亮点', placeholder: '列出 1-3 个最想在面试里展开的项目或成果。', type: 'textarea', rows: 6 },
      { id: 'tone', label: '风格偏好', placeholder: '例如：稳重、简洁、有技术深度、偏业务结果', type: 'input' },
    ],
    outputGuide: `
请输出 Markdown，包含：
1. 30 秒版本
2. 1 分钟版本
3. 2 分钟版本
4. 每个版本的适用场景
5. 3 个自然引导面试官追问项目的句子
6. 需要避免的表达
`,
  },
  {
    id: 'learning-plan',
    title: '学习计划',
    description: '根据薄弱点、面试日期和可投入时间，生成可执行的补强路径。',
    actionLabel: '生成学习计划',
    loadingText: '正在规划补强路径...',
    emptyTitle: '等待计划目标',
    emptyDescription: '填入目标、薄弱点和时间安排后，生成阶段化学习计划。',
    fields: [
      { id: 'target', label: '目标', placeholder: '例如：7 天后前端技术面，重点准备 React、项目深挖和手写题', type: 'textarea', rows: 5, required: true },
      { id: 'weakness', label: '当前薄弱点', placeholder: '粘贴薄弱点、模拟面试结果、复盘结论或自己不稳的知识点。', type: 'textarea', rows: 7 },
      { id: 'time', label: '每天可投入时间', placeholder: '例如：工作日 1.5 小时，周末 4 小时', type: 'input' },
      { id: 'duration', label: '计划周期', placeholder: '例如：3 天 / 7 天 / 14 天', type: 'input' },
    ],
    outputGuide: `
请输出 Markdown，包含：
1. 计划目标和优先级
2. 每日安排，按天列出任务、产出物和验收标准
3. 每天的练习题方向
4. 复盘检查点
5. 面试前最后一天的准备清单
6. 如果时间不够，哪些任务可以砍掉
`,
  },
]

const TOOL_MAP = new Map(TOOL_CONFIGS.map((tool) => [tool.id, tool]))

function createInitialValues(tool: AIToolConfig): Record<string, string> {
  return Object.fromEntries(tool.fields.map((field) => [field.id, '']))
}

function buildMessages(
  tool: AIToolConfig,
  vals: Record<string, string>,
): ChatCompletionMessage[] {
  const fieldText = tool.fields
    .map((field) => {
      const value = vals[field.id]?.trim()
      return `## ${field.label}\n${value || '未提供'}`
    })
    .join('\n\n')

  return [
    {
      role: 'system',
      content: '你是一个中文技术面试教练。回答要具体、可执行、适合真实面试复盘，不要写空泛套话。输出 Markdown。',
    },
    {
      role: 'user',
      content: `请完成工具「${tool.title}」。\n\n${fieldText}\n\n## 输出要求\n${tool.outputGuide.trim()}`,
    },
  ]
}

// ─── State ────────────────────────────────────────────────────────

const route = useRoute()
const aiStore = useAIStore()

const toolId = computed(() => route.params.toolId as string)
const tool = computed(() => (toolId.value ? TOOL_MAP.get(toolId.value) : undefined))

const aiReady = computed(() => aiStore.config.enabled && aiStore.isProviderAuthenticated(aiStore.config.provider))

const values = ref<Record<string, string>>({})
const result = ref('')
const {
  text: streamingText,
  appendText,
  resetText,
} = useBufferedText()
const generating = ref(false)
const error = ref<string | null>(null)
const settingsOpen = ref(false)
const abortController = ref<AbortController | null>(null)

watch(
  tool,
  (t) => {
    if (!t) return
    values.value = createInitialValues(t)
    result.value = ''
    resetText('')
    error.value = null
  },
  { immediate: true },
)

onUnmounted(() => {
  abortController.value?.abort()
})

const displayResult = computed(() => streamingText.value || result.value)

const missingRequired = computed(() => {
  if (!tool.value) return null
  return tool.value.fields.find((field) => field.required && !values.value[field.id]?.trim()) ?? null
})

function handleFieldChange(fieldId: string, value: string) {
  values.value = { ...values.value, [fieldId]: value }
}

// ─── Actions ──────────────────────────────────────────────────────

async function handleGenerate() {
  if (!tool.value) return
  if (!aiReady.value) {
    error.value = '请先在设置中启用 AI 并配置 API Key'
    return
  }
  if (missingRequired.value) {
    error.value = `请填写${missingRequired.value.label}`
    return
  }

  abortController.value?.abort()
  const controller = new AbortController()
  abortController.value = controller

  generating.value = true
  error.value = null
  result.value = ''
  resetText('')

  try {
    const markdown = await requestChatCompletionStream({
      config: {
        apiKey: aiStore.getProviderApiKey(aiStore.config.provider),
        baseUrl: aiStore.config.baseUrl,
        model: aiStore.config.model,
        temperature: Math.min(0.75, Math.max(0.25, aiStore.config.temperature)),
        maxTokens: Math.max(1800, Math.min(aiStore.config.maxTokens, 3200)),
      },
      messages: buildMessages(tool.value, values.value),
      signal: controller.signal,
      onDelta: appendText,
    })
    result.value = markdown
    resetText('')
  } catch (err) {
    if (controller.signal.aborted) return
    error.value = err instanceof Error ? err.message : '生成失败'
  } finally {
    if (abortController.value === controller) abortController.value = null
    generating.value = false
  }
}

function handleStop() {
  abortController.value?.abort()
  abortController.value = null
  generating.value = false
}

async function handleCopy() {
  if (!displayResult.value) return
  await navigator.clipboard.writeText(displayResult.value)
}
</script>

<template>
  <!-- Invalid tool -->
  <div v-if="!tool" class="page-container ai-tool-page">
    <div class="ai-tool-missing">
      <h1>工具不存在</h1>
      <p>返回工具页选择一个可用工具。</p>
      <RouterLink to="/tools" class="ai-tool-back-link">返回工具页</RouterLink>
    </div>
  </div>

  <!-- Valid tool -->
  <template v-else>
    <div class="page-container ai-tool-page">
      <RouterLink to="/tools" class="back-link" style="display:inline-flex;align-items:center;gap:4px;font-size:13px;color:var(--text-2);text-decoration:none;margin-bottom:16px">← 返回工具</RouterLink>
      <div class="animate-fade-in" style="margin-bottom: 28px">
        <h1 style="font-size: 20px; font-weight: 700; color: var(--text); letter-spacing: -0.015em; margin-bottom: 4px">
          {{ tool.title }}
        </h1>
        <p style="font-size: 13px; color: var(--text-3)">{{ tool.description }}</p>
      </div>

      <div v-if="error" class="ai-tool-alert">{{ error }}</div>

      <div class="ai-tool-layout">
        <!-- Left: Form Panel -->
        <aside class="ai-tool-panel ai-tool-form-panel">
          <div class="ai-tool-panel-header">
            <h2>输入材料</h2>
            <span
              class="ai-tool-badge"
              :class="aiReady ? 'ai-tool-badge-success' : 'ai-tool-badge-warning'"
            >{{ aiReady ? aiStore.config.model : 'AI 未配置' }}</span>
          </div>

          <div class="ai-tool-form">
            <div v-for="field in tool.fields" :key="field.id" class="ai-tool-field">
              <label :for="`ai-tool-${field.id}`">
                {{ field.label }}
                <em v-if="field.required">*</em>
              </label>
              <textarea
                v-if="field.type === 'textarea'"
                :id="`ai-tool-${field.id}`"
                :value="values[field.id] ?? ''"
                @input="handleFieldChange(field.id, ($event.target as HTMLTextAreaElement).value)"
                :placeholder="field.placeholder"
                :rows="field.rows ?? 5"
              />
              <input
                v-else
                :id="`ai-tool-${field.id}`"
                :value="values[field.id] ?? ''"
                @input="handleFieldChange(field.id, ($event.target as HTMLInputElement).value)"
                :placeholder="field.placeholder"
              />
            </div>
          </div>

          <div class="ai-tool-actions">
            <button
              type="button"
              class="ai-tool-btn ai-tool-btn-primary"
              :disabled="generating"
              @click="handleGenerate"
            >
              <svg
                v-if="generating"
                class="ai-tool-spinner"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.2" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" opacity="0.8" />
              </svg>
              {{ generating ? tool.loadingText : tool.actionLabel }}
            </button>
            <button
              v-if="generating"
              type="button"
              class="ai-tool-btn ai-tool-btn-ghost"
              @click="handleStop"
            >
              停止生成
            </button>
            <button
              v-else
              type="button"
              class="ai-tool-btn ai-tool-btn-ghost"
              @click="settingsOpen = true"
            >
              AI 设置
            </button>
          </div>
        </aside>

        <!-- Right: Result Panel -->
        <section class="ai-tool-panel ai-tool-result-panel">
          <div class="ai-tool-panel-header">
            <h2>生成结果</h2>
            <button
              v-if="displayResult"
              type="button"
              class="ai-tool-btn ai-tool-btn-ghost-sm"
              @click="handleCopy"
            >
              复制
            </button>
          </div>

          <output v-if="generating && !streamingText" class="ai-tool-busy" aria-live="polite">
            <svg class="ai-tool-spinner" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.2" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" opacity="0.8" />
            </svg>
            <span>{{ tool.loadingText }}</span>
          </output>

          <MarkdownRenderer
            v-if="displayResult"
            :content="displayResult"
            class="ai-tool-markdown"
          />

          <div v-if="!displayResult && !generating" class="ai-tool-empty">
            <h2>{{ tool.emptyTitle }}</h2>
            <p>{{ tool.emptyDescription }}</p>
          </div>
        </section>
      </div>
    </div>

    <SettingsDrawer :open="settingsOpen" @close="settingsOpen = false" />
  </template>
</template>

<style scoped>
.ai-tool-page {
  max-width: 1100px;
}

.ai-tool-layout {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.ai-tool-panel {
  min-width: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  padding: 16px;
}

.ai-tool-form-panel {
  position: sticky;
  top: calc(var(--navbar-h) + 16px);
}

.ai-tool-result-panel {
  min-height: 620px;
}

.ai-tool-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.ai-tool-panel-header h2 {
  font-size: 15px;
  line-height: 1.3;
  font-weight: 700;
  color: var(--text);
}

/* Badge */
.ai-tool-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 6px;
}

.ai-tool-badge-success {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.ai-tool-badge-warning {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

/* Form */
.ai-tool-form {
  display: grid;
  gap: 14px;
}

.ai-tool-field {
  display: grid;
  gap: 7px;
}

.ai-tool-field > label {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

.ai-tool-form em {
  color: var(--danger);
  font-style: normal;
}

.ai-tool-form input,
.ai-tool-form textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font-size: var(--control-font-size);
  line-height: 1.55;
  padding: 10px 12px;
  outline: none;
  transition: border-color 0.15s var(--ease-out);
  box-sizing: border-box;
}

.ai-tool-form textarea {
  resize: vertical;
  min-height: 104px;
}

.ai-tool-form input:focus,
.ai-tool-form textarea:focus {
  border-color: rgba(var(--primary-rgb), 0.55);
}

/* Buttons */
.ai-tool-actions {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.ai-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: inherit;
  font-weight: 500;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid transparent;
  white-space: nowrap;
  user-select: none;
}

.ai-tool-btn:active {
  transform: scale(0.97);
}

.ai-tool-btn:disabled {
  opacity: 0.5;
  pointer-events: none;
}

.ai-tool-btn-primary {
  width: 100%;
  font-size: 14px;
  height: 36px;
  padding: 8px 16px;
  background: var(--primary);
  border-color: var(--primary);
  color: white;
  box-shadow: var(--shadow-md);
}

.ai-tool-btn-primary:hover {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
}

.ai-tool-btn-ghost {
  width: 100%;
  font-size: 14px;
  height: 36px;
  padding: 8px 16px;
  background: transparent;
  border-color: transparent;
  color: var(--text-2);
}

.ai-tool-btn-ghost:hover {
  background: var(--surface-2);
  color: var(--text);
}

.ai-tool-btn-ghost-sm {
  font-size: 12px;
  height: 28px;
  padding: 6px 12px;
  background: transparent;
  border-color: transparent;
  color: var(--text-2);
}

.ai-tool-btn-ghost-sm:hover {
  background: var(--surface-2);
  color: var(--text);
}

/* Spinner */
.ai-tool-spinner {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  animation: ai-tool-spin 1s linear infinite;
}

@keyframes ai-tool-spin {
  to { transform: rotate(360deg); }
}

/* Alert */
.ai-tool-alert {
  border: 1px solid rgba(239, 68, 68, 0.22);
  background: var(--danger-light);
  color: var(--danger);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  margin-bottom: 16px;
}

/* Busy */
.ai-tool-busy {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-3);
  font-size: 13px;
}

/* Empty / Missing */
.ai-tool-empty,
.ai-tool-missing {
  min-height: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 8px;
  color: var(--text-3);
}

.ai-tool-empty h2,
.ai-tool-missing h1 {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

.ai-tool-empty p,
.ai-tool-missing p {
  max-width: 360px;
  font-size: 13px;
  line-height: 1.7;
}

.ai-tool-back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 8px 16px;
  border-radius: 8px;
  background: var(--primary);
  color: white;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

/* Markdown */
.ai-tool-markdown :deep(h1),
.ai-tool-markdown :deep(h2),
.ai-tool-markdown :deep(h3) {
  margin-top: 1.2em;
  margin-bottom: 0.5em;
}

.ai-tool-markdown :deep(h1:first-child),
.ai-tool-markdown :deep(h2:first-child),
.ai-tool-markdown :deep(h3:first-child) {
  margin-top: 0;
}

.ai-tool-markdown :deep(ul),
.ai-tool-markdown :deep(ol) {
  padding-left: 1.4em;
}

@media (max-width: 900px) {
  .ai-tool-layout {
    grid-template-columns: 1fr;
  }

  .ai-tool-form-panel {
    position: static;
  }

  .ai-tool-result-panel {
    min-height: 420px;
  }
}
</style>
