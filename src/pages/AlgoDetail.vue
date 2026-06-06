<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MarkdownRenderer from '@/components/ui/MarkdownRenderer.vue'
import { useAlgoProblems } from '@/composables/useAlgoProblems'
import { judgeCode } from '@/lib/algoJudge'
import { getAlgoProblemById, getSubmissionsByProblem, putAlgoSubmission } from '@/lib/db'
import type { AlgoLanguage, AlgoProblem, AlgoStatus, AlgoSubmission } from '@/types'
import { DIFFICULTY_LABELS, DIFFICULTY_STYLES } from '@/types'
import { v4 as uuidv4 } from 'uuid'

const route = useRoute()
const router = useRouter()
const problemId = computed(() => route.params.id as string)

const problem = ref<AlgoProblem | null>(null)
const loading = ref(true)
const code = ref('')
const language = ref<AlgoLanguage>('javascript')
const running = ref(false)
const result = ref<ReturnType<typeof judgeCode> extends Promise<infer R> ? R : never | null>(null)
const submissions = ref<AlgoSubmission[]>([])
const activeTab = ref<'description' | 'submissions'>('description')
const showHintIndex = ref<number>(-1)

const { reload: reloadProblems } = useAlgoProblems()

const defaultTemplates: Record<AlgoLanguage, string> = {
  javascript: `const readline = require('readline');\nconst rl = readline.createInterface({\n  input: process.stdin,\n  output: process.stdout\n});\n\nlet lines = [];\nrl.on('line', (line) => {\n  lines.push(line);\n});\n\nrl.on('close', () => {\n  // 在这里写你的代码\n  console.log('hello');\n});`,
  python: `import sys\n\nfor line in sys.stdin:\n    line = line.strip()\n    # 在这里写你的代码\n    print(line)`,
  java: `import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        // 在这里写你的代码\n        while (sc.hasNext()) {\n            String line = sc.nextLine();\n            System.out.println(line);\n        }\n    }\n}`
}

const statusLabels: Record<AlgoStatus, string> = {
  ac: '通过',
  wa: '答案错误',
  tle: '超时',
  re: '运行错误',
  ce: '编译错误',
  pending: '判题中'
}

const statusColors: Record<AlgoStatus, { bg: string; color: string; border: string }> = {
  ac: { bg: 'rgba(16,185,129,0.1)', color: '#10b981', border: 'rgba(16,185,129,0.2)' },
  wa: { bg: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'rgba(239,68,68,0.2)' },
  tle: { bg: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: 'rgba(245,158,11,0.2)' },
  re: { bg: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'rgba(239,68,68,0.2)' },
  ce: { bg: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: 'rgba(245,158,11,0.2)' },
  pending: { bg: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: 'rgba(59,130,246,0.2)' }
}

async function loadProblem() {
  loading.value = true
  const p = await getAlgoProblemById(problemId.value)
  if (!p) {
    router.push('/algo')
    return
  }
  problem.value = p
  code.value = defaultTemplates[language.value]
  await loadSubmissions()
  loading.value = false
}

async function loadSubmissions() {
  submissions.value = await getSubmissionsByProblem(problemId.value)
}

function onLanguageChange(lang: AlgoLanguage) {
  language.value = lang
  code.value = defaultTemplates[lang]
}

async function handleRun(publicOnly = false) {
  if (!problem.value || running.value) return
  running.value = true
  result.value = null

  const allCases = problem.value.testCases || []
  const testCases = publicOnly
    ? allCases.filter((t) => t.isPublic)
    : allCases

  const judgeResult = await judgeCode({
    code: code.value,
    language: language.value,
    testCases: testCases.map((t) => ({ input: t.input, output: t.output })),
    timeLimit: problem.value.timeLimit ?? 2000
  })

  result.value = judgeResult

  // Save submission
  const submission: AlgoSubmission = {
    id: uuidv4(),
    problemId: problemId.value,
    code: code.value,
    language: language.value,
    status: judgeResult.status,
    passedCount: judgeResult.passedCount,
    totalCount: judgeResult.totalCount,
    runtime: judgeResult.details.find((d) => d.runtime)?.runtime,
    errorMessage: judgeResult.errorMessage,
    createdAt: Date.now()
  }
  await putAlgoSubmission(submission)
  await loadSubmissions()

  running.value = false
}

function handleTabIndent(e: KeyboardEvent) {
  const target = e.target as HTMLTextAreaElement
  if (e.key === 'Tab') {
    e.preventDefault()
    const start = target.selectionStart
    const end = target.selectionEnd
    const spaces = '    '
    target.value = target.value.substring(0, start) + spaces + target.value.substring(end)
    target.selectionStart = target.selectionEnd = start + spaces.length
    code.value = target.value
  }
}

function copyText(text: string) {
  navigator.clipboard.writeText(text)
}

onMounted(() => {
  loadProblem()
})

watch(problemId, () => {
  loadProblem()
})
</script>

<template>
  <div v-if="loading" style="padding: 60px; text-align: center; color: var(--text-3)">加载中...</div>
  <div v-else-if="!problem" style="padding: 60px; text-align: center; color: var(--text-3)">题目不存在</div>
  <div v-else class="algo-detail">
    <!-- Header -->
    <div class="algo-header">
      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
        <h1 style="font-size: 20px; font-weight: 700; color: var(--text); margin: 0">{{ problem.title }}</h1>
        <span
          class="difficulty-badge"
          :style="{
            background: DIFFICULTY_STYLES[problem.difficulty].background,
            color: DIFFICULTY_STYLES[problem.difficulty].color,
            borderColor: DIFFICULTY_STYLES[problem.difficulty].borderColor
          }"
        >
          {{ DIFFICULTY_LABELS[problem.difficulty] }}
        </span>
        <span style="font-size: 13px; color: var(--text-3)">{{ problem.module }}</span>
      </div>
      <div style="display: flex; gap: 8px">
        <button type="button" class="btn-ghost-sm" @click="$router.push('/algo')">返回列表</button>
      </div>
    </div>

    <div class="algo-body">
      <!-- Left panel: problem description -->
      <div class="left-panel">
        <div class="tab-bar">
          <button
            type="button"
            class="tab-btn"
            :class="{ active: activeTab === 'description' }"
            @click="activeTab = 'description'"
          >题目描述</button>
          <button
            type="button"
            class="tab-btn"
            :class="{ active: activeTab === 'submissions' }"
            @click="activeTab = 'submissions'"
          >提交记录 ({{ submissions.length }})</button>
        </div>

        <div v-if="activeTab === 'description'" class="panel-content">
          <div style="margin-bottom: 20px">
            <MarkdownRenderer :content="problem.description" />
          </div>

          <div v-if="problem.inputDesc || problem.outputDesc" style="margin-bottom: 20px">
            <h3 style="font-size: 15px; font-weight: 600; color: var(--text); margin: 0 0 10px">输入输出</h3>
            <div v-if="problem.inputDesc" style="margin-bottom: 10px">
              <div style="font-size: 12px; font-weight: 600; color: var(--text-3); margin-bottom: 4px">输入描述</div>
              <div style="font-size: 13px; color: var(--text-2); line-height: 1.6">{{ problem.inputDesc }}</div>
            </div>
            <div v-if="problem.outputDesc">
              <div style="font-size: 12px; font-weight: 600; color: var(--text-3); margin-bottom: 4px">输出描述</div>
              <div style="font-size: 13px; color: var(--text-2); line-height: 1.6">{{ problem.outputDesc }}</div>
            </div>
          </div>

          <!-- Samples -->
          <div v-if="(problem.samples || []).length > 0" style="margin-bottom: 20px">
            <h3 style="font-size: 15px; font-weight: 600; color: var(--text); margin: 0 0 10px">样例</h3>
            <div v-for="(sample, i) in (problem.samples || [])" :key="i" style="margin-bottom: 12px">
              <div class="sample-block">
                <div class="sample-row">
                  <span class="sample-label">输入</span>
                  <button type="button" class="sample-copy" @click="copyText(sample.input)">复制</button>
                </div>
                <pre class="sample-code">{{ sample.input }}</pre>
              </div>
              <div class="sample-block">
                <div class="sample-row">
                  <span class="sample-label">输出</span>
                  <button type="button" class="sample-copy" @click="copyText(sample.output)">复制</button>
                </div>
                <pre class="sample-code">{{ sample.output }}</pre>
              </div>
              <div v-if="sample.explanation" style="font-size: 12px; color: var(--text-3); margin-top: 4px">
                {{ sample.explanation }}
              </div>
            </div>
          </div>

          <!-- Hints -->
          <div v-if="(problem.hints || []).length > 0" style="margin-bottom: 20px">
            <h3 style="font-size: 15px; font-weight: 600; color: var(--text); margin: 0 0 10px">提示</h3>
            <div v-for="(hint, i) in (problem.hints || [])" :key="i" style="margin-bottom: 6px">
              <button
                type="button"
                class="hint-btn"
                @click="showHintIndex = showHintIndex === i ? -1 : i"
              >
                <span>提示 {{ i + 1 }}</span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  style="transition: transform 0.15s"
                  :style="{ transform: showHintIndex === i ? 'rotate(180deg)' : '' }"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <div
                v-if="showHintIndex === i"
                style="padding: 10px 12px; font-size: 13px; color: var(--text-2); background: var(--surface-2); border-radius: 0 0 8px 8px"
              >
                {{ hint }}
              </div>
            </div>
          </div>

          <!-- Tags -->
          <div v-if="(problem.tags || []).length > 0" style="display: flex; gap: 6px; flex-wrap: wrap">
            <span v-for="tag in (problem.tags || [])" :key="tag" class="tag">{{ tag }}</span>
          </div>
        </div>

        <!-- Submissions tab -->
        <div v-else class="panel-content">
          <div v-if="submissions.length === 0" style="text-align: center; padding: 40px; color: var(--text-3)">
            暂无提交记录
          </div>
          <div v-else style="display: flex; flex-direction: column; gap: 8px">
            <div
              v-for="s in submissions.slice().reverse().slice(0, 20)"
              :key="s.id"
              style="padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface)"
            >
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px">
                <span
                  style="font-size: 12px; font-weight: 600; padding: 2px 7px; border-radius: 5px; border: 1px solid"
                  :style="{
                    background: statusColors[s.status].bg,
                    color: statusColors[s.status].color,
                    borderColor: statusColors[s.status].border
                  }"
                >
                  {{ statusLabels[s.status] }}
                </span>
                <span style="font-size: 11px; color: var(--text-3)">
                  {{ new Date(s.createdAt).toLocaleString() }}
                </span>
              </div>
              <div style="font-size: 12px; color: var(--text-2)">
                {{ s.language }} · {{ s.passedCount }}/{{ s.totalCount }}
                <span v-if="s.runtime"> · {{ s.runtime }}ms</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right panel: code editor -->
      <div class="right-panel">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px">
          <div style="display: flex; gap: 4px">
            <button
              v-for="lang in (['javascript', 'python', 'java'] as AlgoLanguage[])"
              :key="lang"
              type="button"
              class="lang-btn"
              :class="{ active: language === lang }"
              @click="onLanguageChange(lang)"
            >
              {{ lang === 'javascript' ? 'JavaScript' : lang === 'python' ? 'Python' : 'Java' }}
            </button>
          </div>
          <div style="display: flex; gap: 6px">
            <button
              type="button"
              class="btn-secondary-sm"
              :disabled="running"
              @click="handleRun(true)"
            >
              运行样例
            </button>
            <button
              type="button"
              class="btn-primary-sm"
              :disabled="running"
              @click="handleRun(false)"
            >
              {{ running ? '判题中...' : '提交' }}
            </button>
          </div>
        </div>

        <textarea
          v-model="code"
          class="code-editor"
          spellcheck="false"
          @keydown="handleTabIndent"
        />

        <!-- Results -->
        <div v-if="result" class="result-panel">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px">
            <span
              style="font-size: 14px; font-weight: 600; padding: 4px 10px; border-radius: 6px; border: 1px solid"
              :style="{
                background: statusColors[result.status].bg,
                color: statusColors[result.status].color,
                borderColor: statusColors[result.status].border
              }"
            >
              {{ statusLabels[result.status] }}
            </span>
            <span style="font-size: 13px; color: var(--text-2)">
              {{ result.passedCount }}/{{ result.totalCount }}
            </span>
          </div>

          <div v-if="result.errorMessage" style="padding: 10px; border-radius: 8px; background: rgba(239,68,68,0.06); color: #ef4444; font-size: 12px; font-family: monospace; white-space: pre-wrap; margin-bottom: 10px">
            {{ result.errorMessage }}
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px">
            <div
              v-for="(detail, i) in result.details"
              :key="i"
              style="padding: 10px; border-radius: 8px; border: 1px solid var(--border); font-size: 12px"
              :style="detail.status === 'ac' ? { borderColor: 'rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.04)' } : { borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.04)' }"
            >
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px">
                <span style="font-weight: 600">测试用例 {{ i + 1 }}</span>
                <span
                  style="font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 4px"
                  :style="{
                    background: statusColors[detail.status].bg,
                    color: statusColors[detail.status].color
                  }"
                >
                  {{ statusLabels[detail.status] }}
                </span>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px">
                <div>
                  <div style="color: var(--text-3); margin-bottom: 2px">输入</div>
                  <pre style="margin: 0; font-family: monospace; white-space: pre-wrap; word-break: break-all; background: var(--surface-2); padding: 6px; border-radius: 4px">{{ detail.input }}</pre>
                </div>
                <div>
                  <div style="color: var(--text-3); margin-bottom: 2px">预期输出</div>
                  <pre style="margin: 0; font-family: monospace; white-space: pre-wrap; word-break: break-all; background: var(--surface-2); padding: 6px; border-radius: 4px">{{ detail.expectedOutput }}</pre>
                </div>
                <div v-if="detail.status !== 'ac'" style="grid-column: 1 / -1">
                  <div style="color: var(--text-3); margin-bottom: 2px">实际输出</div>
                  <pre style="margin: 0; font-family: monospace; white-space: pre-wrap; word-break: break-all; background: var(--surface-2); padding: 6px; border-radius: 4px">{{ detail.actualOutput || '(空输出)' }}</pre>
                </div>
                <div v-if="detail.errorMessage" style="grid-column: 1 / -1">
                  <div style="color: var(--text-3); margin-bottom: 2px">错误信息</div>
                  <pre style="margin: 0; font-family: monospace; white-space: pre-wrap; word-break: break-all; background: rgba(239,68,68,0.06); color: #ef4444; padding: 6px; border-radius: 4px">{{ detail.errorMessage }}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.algo-detail {
  max-width: 1200px;
  margin: 0 auto;
  padding: calc(var(--navbar-h) + 24px) 16px 24px;
}

.algo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}

.algo-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
}

@media (max-width: 900px) {
  .algo-body {
    grid-template-columns: 1fr;
  }
}

.left-panel,
.right-panel {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - var(--navbar-h) - 100px);
  overflow-y: auto;
  min-height: 0;
}

.tab-bar {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
}

.tab-btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
}

.tab-btn.active {
  color: var(--primary);
  background: var(--primary-light);
}

.panel-content {
  flex: 1;
  overflow-y: auto;
}

.sample-block {
  background: var(--surface-2);
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  margin-bottom: 6px;
}

.sample-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.sample-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sample-copy {
  font-size: 11px;
  color: var(--primary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
}

.sample-code {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  font-family: var(--font-mono);
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-2);
}

.hint-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}

.tag {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 5px;
  background: var(--surface-2);
  color: var(--text-3);
  border: 1px solid var(--border-subtle);
}

.lang-btn {
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.12s;
}

.lang-btn.active {
  border-color: var(--primary);
  background: var(--primary-light);
  color: var(--primary);
}

.code-editor {
  width: 100%;
  min-height: 320px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  font-family: var(--font-mono);
  line-height: 1.6;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
  flex: 1;
}

.code-editor:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-light);
}

.result-panel {
  margin-top: 12px;
  padding: 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
}

.difficulty-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 5px;
  border: 1px solid;
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

.btn-primary-sm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.btn-secondary-sm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
