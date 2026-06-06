<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAlgoProblems } from '@/composables/useAlgoProblems'
import { importAlgoProblems, validateAlgoProblems } from '@/lib/algoProblemLoader'
import { deleteAlgoProblemById, putAlgoProblem } from '@/lib/db'
import { requestChatCompletion } from '@/lib/aiClient'
import { useAIStore } from '@/stores/useAIStore'
import { getAIProviderPreset } from '@/stores/aiPresets'
import { DIFFICULTY_LABELS, type AlgoProblem, type AlgoSample, type AlgoTestCase } from '@/types'

const router = useRouter()
const { problems, reload } = useAlgoProblems()
const aiStore = useAIStore()

const generatingTestCases = ref(false)
const aiGenerateError = ref('')

const showImportModal = ref(false)
const importText = ref('')
const importErrors = ref<string[]>([])
const importSuccess = ref('')
const showForm = ref(false)
const editingProblem = ref<AlgoProblem | null>(null)

const form = ref({
  id: '',
  title: '',
  module: '',
  difficulty: 1 as 1 | 2 | 3,
  description: '',
  inputDesc: '',
  outputDesc: '',
  samples: [{ input: '', output: '', explanation: '' }] as AlgoSample[],
  testCases: [{ input: '', output: '', isPublic: false }] as AlgoTestCase[],
  hints: [''],
  tags: '',
  timeLimit: 2000,
  memoryLimit: 256,
})

const searchQuery = ref('')
const filteredProblems = computed(() => {
  if (!searchQuery.value.trim()) return problems.value
  const s = searchQuery.value.toLowerCase()
  return problems.value.filter(
    (p) =>
      p.title.toLowerCase().includes(s) ||
      p.description.toLowerCase().includes(s) ||
      p.module.toLowerCase().includes(s) ||
      (p.tags || []).some((t) => t.toLowerCase().includes(s)),
  )
})

function resetForm() {
  form.value = {
    id: '',
    title: '',
    module: '',
    difficulty: 1,
    description: '',
    inputDesc: '',
    outputDesc: '',
    samples: [{ input: '', output: '', explanation: '' }],
    testCases: [{ input: '', output: '', isPublic: false }],
    hints: [''],
    tags: '',
    timeLimit: 2000,
    memoryLimit: 256,
  }
  editingProblem.value = null
}

function openCreate() {
  resetForm()
  showForm.value = true
}

function openEdit(p: AlgoProblem) {
  editingProblem.value = p
  form.value = {
    id: p.id,
    title: p.title,
    module: p.module,
    difficulty: p.difficulty,
    description: p.description,
    inputDesc: p.inputDesc,
    outputDesc: p.outputDesc,
    samples: (p.samples || []).length > 0 ? [...p.samples] : [{ input: '', output: '', explanation: '' }],
    testCases: (p.testCases || []).length > 0 ? [...p.testCases] : [{ input: '', output: '', isPublic: false }],
    hints: (p.hints || []).length > 0 ? [...p.hints] : [''],
    tags: (p.tags || []).join(', '),
    timeLimit: p.timeLimit ?? 2000,
    memoryLimit: p.memoryLimit ?? 256,
  }
  showForm.value = true
}

async function handleSave() {
  const problem: AlgoProblem = {
    id: form.value.id || `custom_manual_${Date.now()}`,
    title: form.value.title,
    module: form.value.module || '未分类',
    difficulty: form.value.difficulty,
    description: form.value.description,
    inputDesc: form.value.inputDesc,
    outputDesc: form.value.outputDesc,
    samples: form.value.samples.filter((s) => s.input || s.output),
    testCases: [
      ...form.value.samples.filter((s) => s.input || s.output).map((s) => ({ ...s, isPublic: true })),
      ...form.value.testCases.filter((t) => t.input || t.output),
    ],
    hints: form.value.hints.filter((h) => h.trim()),
    tags: form.value.tags
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean),
    source: 'manual',
    timeLimit: Number(form.value.timeLimit) || 2000,
    memoryLimit: Number(form.value.memoryLimit) || 256,
  }

  await putAlgoProblem(problem)
  await reload()
  showForm.value = false
  resetForm()
}

async function handleDelete(id: string) {
  if (!confirm('确定删除这道题吗？')) return
  await deleteAlgoProblemById(id)
  await reload()
}

async function handleImport() {
  importErrors.value = []
  importSuccess.value = ''

  try {
    const data = JSON.parse(importText.value)
    const validation = await validateAlgoProblems(data)
    if (!validation.valid) {
      importErrors.value = validation.errors
      return
    }

    const result = await importAlgoProblems(data, 'import_' + Date.now())
    importSuccess.value = `导入成功：${result.imported} 题，更新 ${result.updated} 题`
    if (result.errors.length > 0) {
      importErrors.value = result.errors
    }
    await reload()
    importText.value = ''
  } catch (err: any) {
    importErrors.value = ['JSON 解析失败：' + (err.message || String(err))]
  }
}

function addSample() {
  form.value.samples.push({ input: '', output: '', explanation: '' })
}

function removeSample(i: number) {
  form.value.samples.splice(i, 1)
}

function addTestCase() {
  form.value.testCases.push({ input: '', output: '', isPublic: false })
}

function removeTestCase(i: number) {
  form.value.testCases.splice(i, 1)
}

function addHint() {
  form.value.hints.push('')
}

function removeHint(i: number) {
  form.value.hints.splice(i, 1)
}

async function generateTestCasesWithAI() {
  aiGenerateError.value = ''

  const apiKey = aiStore.getProviderApiKey(aiStore.config.provider)
  if (!apiKey) {
    aiGenerateError.value = '请先在设置中为 ' + getAIProviderPreset(aiStore.config.provider).label + ' 配置 API Key'
    return
  }
  if (!aiStore.config.enabled) {
    aiGenerateError.value = '请先在设置中启用 AI 功能'
    return
  }

  if (!form.value.title.trim() || !form.value.description.trim()) {
    aiGenerateError.value = '请先填写标题和题目描述'
    return
  }

  generatingTestCases.value = true

  const sampleText = form.value.samples
    .filter((s) => s.input || s.output)
    .map((s, i) => `样例 ${i + 1}：\n输入：\n${s.input}\n输出：\n${s.output}`)
    .join('\n\n') || '暂无'

  const prompt = `你是一位 ACM 算法题的测试用例构造专家。

请根据以下题目信息，构造 5-8 组测试用例（包括公开样例和隐藏测试用例）。

【题目信息】
标题：${form.value.title}
描述：${form.value.description}
输入说明：${form.value.inputDesc || '无'}
输出说明：${form.value.outputDesc || '无'}
已有样例：
${sampleText}

【要求】
1. 每组测试用例包含 input（字符串）和 output（字符串）两个字段
2. 前两组作为公开样例（isPublic: true），其余为隐藏测试用例（isPublic: false）
3. 测试用例应覆盖：边界情况、普通情况、特殊情况
4. input 和 output 中的换行用 \\n 表示（实际内容中的换行就是换行符）
5. 只输出 JSON 数组，不要输出任何其他文字（包括 markdown 代码块标记）

【输出格式】
[
  { "input": "...", "output": "...", "isPublic": true },
  ...
]`

  try {
    const fullText = await requestChatCompletion({
      config: {
        apiKey,
        baseUrl: aiStore.config.baseUrl,
        model: aiStore.config.model,
        temperature: 0.7,
        maxTokens: 4000,
      },
      messages: [
        { role: 'system', content: '你是 ACM 算法题测试用例构造专家，只输出纯 JSON 数组，不输出任何其他文字。' },
        { role: 'user', content: prompt },
      ],
    })

    const jsonText = fullText.replace(/^\s*`{3}(?:json)?\s*|\s*`{3}\s*$/gi, '').trim()
    const parsed = JSON.parse(jsonText)

    if (!Array.isArray(parsed)) {
      throw new Error('AI 返回的不是数组')
    }

    const newCases: AlgoTestCase[] = parsed
      .filter((item: unknown) => item && typeof item === 'object')
      .map((item: Record<string, unknown>) => ({
        input: String(item.input ?? ''),
        output: String(item.output ?? ''),
        isPublic: item.isPublic === true,
      }))
      .filter((tc) => tc.input || tc.output)

    if (newCases.length === 0) {
      throw new Error('AI 没有返回有效的测试用例')
    }

    // 自动把 isPublic=true 的同步到 samples
    const publicCases = newCases.filter((tc) => tc.isPublic)
    if (publicCases.length > 0) {
      form.value.samples = publicCases.map((tc) => ({
        input: tc.input,
        output: tc.output,
        explanation: '',
      }))
    }

    form.value.testCases = newCases.filter((tc) => !tc.isPublic)
  } catch (err: any) {
    aiGenerateError.value = 'AI 生成失败：' + (err.message || String(err))
  } finally {
    generatingTestCases.value = false
  }
}
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h1 class="page-title">算法题管理</h1>
      <div style="display: flex; gap: 8px">
        <button class="btn-secondary-sm" @click="showImportModal = true">导入 JSON</button>
        <button class="btn-primary-sm" @click="openCreate">新建题目</button>
        <button class="btn-ghost-sm" @click="$router.push('/algo')">返回</button>
      </div>
    </div>

    <input v-model="searchQuery" type="text" placeholder="搜索..." class="search-input" style="width: 100%; margin-bottom: 16px; box-sizing: border-box" />

    <div v-if="problems.length === 0" style="text-align: center; padding: 40px; color: var(--text-3)">
      暂无题目，点击"新建题目"或"导入 JSON"
    </div>

    <div v-else class="problem-table">
      <div v-for="p in filteredProblems" :key="p.id" class="problem-row">
        <div style="flex: 1; min-width: 0">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px">
            <span
              class="difficulty-badge"
              :style="{
                background: ['rgba(16,185,129,0.1)', 'rgba(245,158,11,0.1)', 'rgba(239,68,68,0.1)'][p.difficulty - 1],
                color: ['#10b981', '#f59e0b', '#ef4444'][p.difficulty - 1],
                borderColor: ['rgba(16,185,129,0.2)', 'rgba(245,158,11,0.2)', 'rgba(239,68,68,0.2)'][p.difficulty - 1],
              }"
            >
              {{ DIFFICULTY_LABELS[p.difficulty] }}
            </span>
            <span style="font-weight: 600; color: var(--text); font-size: 14px">{{ p.title }}</span>
            <span style="font-size: 12px; color: var(--text-3)">{{ p.module }}</span>
          </div>
          <div style="font-size: 12px; color: var(--text-3)">
            {{ (p.testCases || []).length }} 组测试用例 · {{ (p.tags || []).join(', ') || '无标签' }}
          </div>
        </div>
        <div style="display: flex; gap: 6px; flex-shrink: 0">
          <button class="btn-ghost-sm" @click="$router.push(`/algo/${p.id}`)">做题</button>
          <button class="btn-ghost-sm" @click="openEdit(p)">编辑</button>
          <button class="btn-ghost-sm" style="color: var(--danger)" @click="handleDelete(p.id)">删除</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Import Modal -->
  <div v-if="showImportModal" class="modal-overlay" @click="showImportModal = false">
    <div class="modal-content" @click.stop>
      <h3 style="margin: 0 0 12px; font-size: 16px">导入算法题</h3>
      <p style="font-size: 12px; color: var(--text-3); margin: 0 0 10px">
        粘贴 JSON 数据，格式参考文档
      </p>
      <textarea
        v-model="importText"
        style="width: 100%; height: 200px; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); font-family: monospace; font-size: 12px; box-sizing: border-box; resize: vertical"
        placeholder='{ &quot;problems&quot;: [{ &quot;id&quot;: &quot;a+b&quot;, &quot;title&quot;: &quot;A+B&quot;, ... }] }'
      />
      <div v-if="importErrors.length > 0" style="margin-top: 10px; padding: 10px; border-radius: 8px; background: rgba(239,68,68,0.06); color: #ef4444; font-size: 12px">
        <div v-for="(err, i) in importErrors" :key="i">{{ err }}</div>
      </div>
      <div v-if="importSuccess" style="margin-top: 10px; padding: 10px; border-radius: 8px; background: rgba(16,185,129,0.06); color: #10b981; font-size: 12px">
        {{ importSuccess }}
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px">
        <button class="btn-ghost-sm" @click="showImportModal = false">取消</button>
        <button class="btn-primary-sm" @click="handleImport">导入</button>
      </div>
    </div>
  </div>

  <!-- Create/Edit Modal -->
  <div v-if="showForm" class="modal-overlay" @click="showForm = false">
    <div class="modal-content" style="max-width: 720px; max-height: 90vh; overflow-y: auto" @click.stop>
      <h3 style="margin: 0 0 16px; font-size: 16px">{{ editingProblem ? '编辑题目' : '新建题目' }}</h3>

      <div style="display: flex; flex-direction: column; gap: 12px">
        <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px">
          <input v-model="form.title" placeholder="标题" class="form-input" />
          <input v-model="form.module" placeholder="模块" class="form-input" />
          <select v-model="form.difficulty" class="form-input">
            <option :value="1">初级</option>
            <option :value="2">中级</option>
            <option :value="3">高级</option>
          </select>
        </div>

        <textarea v-model="form.description" placeholder="题目描述（支持 Markdown）" class="form-textarea" rows="4" />
        <textarea v-model="form.inputDesc" placeholder="输入说明" class="form-textarea" rows="2" />
        <textarea v-model="form.outputDesc" placeholder="输出说明" class="form-textarea" rows="2" />

        <div>
          <div style="font-size: 13px; font-weight: 600; margin-bottom: 6px">样例</div>
          <div v-for="(sample, i) in form.samples" :key="i" style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px; margin-bottom: 6px">
            <textarea v-model="sample.input" placeholder="输入" class="form-textarea" rows="2" />
            <textarea v-model="sample.output" placeholder="输出" class="form-textarea" rows="2" />
            <button type="button" class="btn-ghost-sm" @click="removeSample(i)">删除</button>
          </div>
          <button type="button" class="btn-ghost-sm" @click="addSample">+ 添加样例</button>
        </div>

        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px">
            <span style="font-size: 13px; font-weight: 600">测试用例</span>
            <button
              type="button"
              class="btn-ghost-sm"
              :disabled="generatingTestCases"
              @click="generateTestCasesWithAI"
            >
              {{ generatingTestCases ? '生成中...' : 'AI 生成测试用例' }}
            </button>
          </div>
          <div v-if="aiGenerateError" style="margin-bottom: 8px; padding: 8px 10px; border-radius: 6px; background: rgba(239,68,68,0.06); color: #ef4444; font-size: 12px">
            {{ aiGenerateError }}
          </div>
          <div v-for="(tc, i) in form.testCases" :key="i" style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px; margin-bottom: 6px">
            <textarea v-model="tc.input" placeholder="输入" class="form-textarea" rows="2" />
            <textarea v-model="tc.output" placeholder="输出" class="form-textarea" rows="2" />
            <button type="button" class="btn-ghost-sm" @click="removeTestCase(i)">删除</button>
          </div>
          <button type="button" class="btn-ghost-sm" @click="addTestCase">+ 添加测试用例</button>
        </div>

        <div>
          <div style="font-size: 13px; font-weight: 600; margin-bottom: 6px">提示</div>
          <div v-for="(hint, i) in form.hints" :key="i" style="display: flex; gap: 6px; margin-bottom: 6px">
            <input v-model="form.hints[i]" placeholder="提示内容" class="form-input" style="flex: 1" />
            <button type="button" class="btn-ghost-sm" @click="removeHint(i)">删除</button>
          </div>
          <button type="button" class="btn-ghost-sm" @click="addHint">+ 添加提示</button>
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px">
          <input v-model="form.tags" placeholder="标签，逗号分隔" class="form-input" />
          <input v-model.number="form.timeLimit" type="number" placeholder="时间限制(ms)" class="form-input" />
          <input v-model.number="form.memoryLimit" type="number" placeholder="内存限制(MB)" class="form-input" />
        </div>
      </div>

      <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px">
        <button class="btn-ghost-sm" @click="showForm = false">取消</button>
        <button class="btn-primary-sm" @click="handleSave">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-container {
  max-width: 960px;
  margin: 0 auto;
  padding: calc(var(--navbar-h) + 24px) 16px 24px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}

.search-input {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  outline: none;
  font-family: inherit;
}

.problem-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.problem-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
}

.difficulty-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.modal-content {
  background: var(--surface);
  border-radius: 14px;
  border: 1px solid var(--border);
  padding: 20px;
  width: 100%;
  max-width: 560px;
  box-shadow: var(--shadow-lg);
}

.form-input {
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  outline: none;
  font-family: inherit;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: var(--primary);
}

.form-textarea {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  outline: none;
  font-family: inherit;
  resize: vertical;
  box-sizing: border-box;
}

.form-textarea:focus {
  border-color: var(--primary);
}

.btn-primary-sm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: var(--primary);
  color: white;
  font-size: 13px;
  font-weight: 500;
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
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}

.btn-ghost-sm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
</style>
