<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { invalidateQuestionsCache } from '@/composables/useQuestions'
import {
  deleteQuestionsBySource,
  getActiveModules,
  getAllQuestions,
  getCategoryMap,
  getCustomSources,
  removeCustomSource,
  unregisterModuleFromCategories,
} from '@/lib/db'
import {
  BUILTIN_QUESTIONS_VERSION,
  getBuiltinModuleFiles,
  importCustomQuestions,
  isJSONFile,
  isMDFile,
  loadAllBuiltinModulesParallel,
  parseJSONSafe,
} from '@/lib/questionLoader'
import type { CategoryEntry } from '@/lib/db'

const router = useRouter()

// ─── Types ─────────────────────────────────────────────────
interface ImportResult {
  source: string
  loaded: number
  errors: { index: number; message: string }[]
  warnings: string[]
}

type Tab = 'file' | 'paste'

// ─── State ─────────────────────────────────────────────────
const tab = ref<Tab>('file')
const loading = ref(false)
const results = ref<ImportResult[]>([])
const customSources = ref<string[]>([])
const fileCategory = ref('')

// Paste panel state
const pasteText = ref('')
const pasteSource = ref('')
const pasteCategory = ref('')
const pasteError = ref('')

// Builtin library state
const builtinCount = ref<number | null>(null)
const builtinFileCount = ref<number | null>(null)
const builtinLoading = ref(false)
const builtinMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null)

// ─── Init ──────────────────────────────────────────────────
onMounted(async () => {
  getCustomSources().then((s) => { customSources.value = s })
  refreshBuiltinStats()
  getBuiltinModuleFiles().then((files) => { builtinFileCount.value = files.length })
})

async function refreshBuiltinStats() {
  const questions = await getAllQuestions()
  builtinCount.value = questions.filter((q) => !q.id.startsWith('custom_')).length
}

// ─── Builtin Library ───────────────────────────────────────
async function handleLoadBuiltin() {
  builtinLoading.value = true
  builtinMessage.value = null
  const force = Boolean(builtinCount.value && builtinCount.value > 0)

  try {
    const loadResults = await loadAllBuiltinModulesParallel(force)
    const loaded = loadResults.reduce((sum, r) => sum + r.loaded, 0)
    const failed = loadResults.filter((r) =>
      r.errors.some((e) => e.index === -1 && r.loaded === 0),
    )
    invalidateQuestionsCache()
    await refreshBuiltinStats()

    if (failed.length > 0) {
      builtinMessage.value = {
        type: 'error',
        text: `有 ${failed.length} 个内置题库文件加载失败，请检查网络或刷新重试。`,
      }
    } else {
      builtinMessage.value = {
        type: 'success',
        text: force
          ? `已重刷内置题库，写入 ${loaded.toLocaleString()} 道题。`
          : `已加载内置题库，写入 ${loaded.toLocaleString()} 道题。`,
      }
    }
  } catch (err) {
    builtinMessage.value = {
      type: 'error',
      text: `内置题库加载失败：${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    builtinLoading.value = false
  }
}

// ─── Import handler ────────────────────────────────────────
async function handleImport(data: unknown, sourceName: string, categoryName: string) {
  loading.value = true
  try {
    const result = await importCustomQuestions(data, sourceName, categoryName || undefined)
    results.value = [result, ...results.value]

    if (result.loaded > 0) {
      const updated = await getCustomSources()
      customSources.value = updated
      invalidateQuestionsCache()
    }
  } finally {
    loading.value = false
  }
}

// ─── File drop handler ─────────────────────────────────────
async function handleFiles(files: File[], category: string) {
  loading.value = true
  for (const file of files) {
    const text = await file.text()

    if (isMDFile(file)) {
      results.value = [{
        source: file.name,
        loaded: 0,
        errors: [{ index: -1, message: 'Markdown 文件导入暂不支持，请使用 JSON 格式或复制内容到粘贴面板' }],
        warnings: [],
      }, ...results.value]
      continue
    }

    // Handle .json files
    const parsed = parseJSONSafe(text)
    if (!parsed.ok) {
      results.value = [{
        source: file.name,
        loaded: 0,
        errors: [{ index: -1, message: `JSON 解析失败：${parsed.error}` }],
        warnings: [],
      }, ...results.value]
      continue
    }
    await handleImport(parsed.data, file.name.replace(/\.json$/i, ''), category)
  }
  loading.value = false
}

// ─── Paste handler ─────────────────────────────────────────
function handlePaste() {
  if (!pasteText.value.trim()) {
    pasteError.value = '请粘贴 JSON 内容'
    return
  }
  if (!pasteSource.value.trim()) {
    pasteError.value = '请填写来源名称'
    return
  }
  const parsed = parseJSONSafe(pasteText.value.trim())
  if (!parsed.ok) {
    pasteError.value = `JSON 格式错误：${parsed.error}`
    return
  }
  pasteError.value = ''
  handleImport(parsed.data, pasteSource.value.trim(), pasteCategory.value.trim())
}

// ─── Remove source ─────────────────────────────────────────
async function handleRemoveSource(source: string) {
  if (!confirm(`确定要删除来源「${source}」的所有题目吗？此操作不可撤销。`)) return
  const all = await getAllQuestions()
  const affectedModules = [
    ...new Set(
      all
        .filter((q) => q.source === `custom_${source}` || q.source === source)
        .map((q) => q.module),
    ),
  ]
  await deleteQuestionsBySource(source)
  await removeCustomSource(source)
  const remaining = await getActiveModules()
  for (const mod of affectedModules) {
    if (!remaining.includes(mod)) {
      await unregisterModuleFromCategories(mod)
    }
  }
  const updated = await getCustomSources()
  customSources.value = updated
  invalidateQuestionsCache()
}

// ─── Drop Zone state ───────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragging.value = false
  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => isJSONFile(f) || isMDFile(f))
  if (files.length > 0) handleFiles(files, fileCategory.value)
}

function onFileChange(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? []).filter((f) => isJSONFile(f) || isMDFile(f))
  if (files.length > 0) handleFiles(files, fileCategory.value)
  ;(e.target as HTMLInputElement).value = ''
}

// ─── Categories Display ────────────────────────────────────
const catMap = ref<Record<string, CategoryEntry> | null>(null)
onMounted(() => {
  getCategoryMap().then((m) => { catMap.value = m })
})

const categoryEntries = computed(() => {
  if (!catMap.value || Object.keys(catMap.value).length === 0) return []
  return Object.values(catMap.value).sort((a, b) => {
    if (a.builtin !== b.builtin) return a.builtin ? -1 : 1
    return a.name.localeCompare(b.name)
  })
})

// ─── Schema Guide ──────────────────────────────────────────
const SCHEMA_EXAMPLE = `[
  {
    "id": "unique-id-001",
    "module": "React",
    "difficulty": 2,
    "question": "解释 React Hooks 的规则",
    "answer": "## Hooks 规则\\n\\n只在**顶层**调用 Hook...",
    "tags": ["hooks", "规则"],
    "source": "高频"
  }
]`

const MODULE_VALUES = [
  'JS基础', 'React', '性能优化', '网络', 'CSS', 'TypeScript', '手写题', '项目深挖',
]

const schemaExpanded = ref(false)

const schemaFields = [
  ['id', 'string', '必填', '唯一标识符'],
  ['module', 'enum', '必填', MODULE_VALUES.join(' | ')],
  ['difficulty', '1 | 2 | 3', '必填', '初级 | 中级 | 高级'],
  ['question', 'string', '必填', '题目内容'],
  ['answer', 'string (Markdown)', '必填', '参考答案，支持 Markdown'],
  ['tags', 'string[]', '必填', '标签数组（可为空数组）'],
  ['source', 'string', '可选', '来源标注，如"高频" "字节"'],
]
</script>

<template>
  <div class="page-container" style="max-width: 760px; display: flex; flex-direction: column; gap: 28px">
    <!-- Header -->
    <div class="animate-fade-in">
      <h1 style="font-size: 20px; font-weight: 700; color: var(--text); letter-spacing: -0.015em; margin-bottom: 4px">
        导入题目
      </h1>
      <p style="font-size: 13px; color: var(--text-3)">
        支持拖拽 JSON 文件或粘贴 JSON 内容，让 AI 按格式生成后直接导入
      </p>
    </div>

    <!-- Builtin Library Card -->
    <div class="card animate-fade-in stagger-1 builtin-library-card" style="padding: 18px; display: flex; align-items: center; justify-content: space-between; gap: 16px">
      <div style="display: flex; align-items: flex-start; gap: 12px; min-width: 0">
        <span style="width: 34px; height: 34px; border-radius: 10px; background: var(--primary-light); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        </span>
        <div style="min-width: 0">
          <p style="font-size: 14px; font-weight: 600; color: var(--text)">内置题库</p>
          <p style="font-size: 12px; color: var(--text-3); line-height: 1.6; margin-top: 3px">
            {{ builtinCount === null ? '正在读取本地题库状态…' : `本地已有 ${builtinCount!.toLocaleString()} 道内置题，覆盖 ${builtinFileCount ?? 0} 个题库文件。` }}
          </p>
          <p style="font-size: 11px; color: var(--text-3); margin-top: 4px">
            题库版本：{{ BUILTIN_QUESTIONS_VERSION }}
          </p>
          <p
            v-if="builtinMessage"
            :style="{ fontSize: '12px', color: builtinMessage.type === 'error' ? 'var(--danger)' : 'var(--success)', marginTop: '8px', lineHeight: 1.5 }"
          >
            {{ builtinMessage.text }}
          </p>
        </div>
      </div>
      <button
        type="button"
        class="btn"
        :class="builtinCount && builtinCount > 0 ? 'btn-secondary' : 'btn-primary'"
        :disabled="builtinLoading"
        @click="handleLoadBuiltin"
        style="height: 32px; padding: 6px 16px; border-radius: 10px; font-size: 13px; font-weight: 500; white-space: nowrap"
      >
        {{ builtinLoading ? '加载中…' : builtinCount && builtinCount > 0 ? '重刷内置题库' : '加载内置题库' }}
      </button>
    </div>

    <!-- Import Card -->
    <div class="card animate-fade-in stagger-1" style="padding: 20px; display: flex; flex-direction: column; gap: 16px">
      <!-- Tab switcher -->
      <div style="display: flex; gap: 4px; padding: 4px; background: var(--surface-2); border-radius: 10px; width: fit-content">
        <button
          v-for="t in ([{ key: 'file', label: '文件导入' }, { key: 'paste', label: '粘贴 JSON' }] as const)"
          :key="t.key"
          type="button"
          @click="tab = t.key"
          :style="{
            padding: '5px 16px',
            borderRadius: '7px',
            fontSize: '13px',
            fontWeight: 500,
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.15s',
            background: tab === t.key ? 'var(--surface)' : 'transparent',
            color: tab === t.key ? 'var(--text)' : 'var(--text-2)',
            boxShadow: tab === t.key ? 'var(--shadow-sm)' : 'none',
          }"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- Tab: File Import -->
      <div v-if="tab === 'file'" style="display: flex; flex-direction: column; gap: 12px">
        <!-- Category input -->
        <div>
          <label for="import-file-category" style="display: block; font-size: 12px; font-weight: 500; color: var(--text-2); margin-bottom: 6px">
            分类名称
            <span style="margin-left: 6px; font-size: 11px; color: var(--text-3); font-weight: 400">（留空则自动从文件名推断，如"Go"、"Java"）</span>
          </label>
          <input
            id="import-file-category"
            v-model="fileCategory"
            type="text"
            placeholder="例如：Go、Java、系统设计…"
            class="input-base"
            style="border-radius: 10px"
          />
        </div>

        <!-- Drop area -->
        <button
          type="button"
          :disabled="loading"
          @click="fileInput?.click()"
          :style="{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '14px',
            minHeight: '180px',
            width: '100%',
            borderRadius: '14px',
            border: '2px dashed',
            borderColor: dragging ? 'var(--primary)' : 'var(--border)',
            background: dragging ? 'var(--primary-light)' : 'transparent',
            transform: dragging ? 'scale(1.01)' : 'scale(1)',
            transition: 'all 0.2s',
            cursor: loading ? 'default' : 'pointer',
            userSelect: 'none',
            opacity: loading ? 0.6 : 1,
          }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop="onDrop"
        >
          <input
            ref="fileInput"
            type="file"
            accept=".json,application/json,.md,.markdown,text/markdown"
            multiple
            style="display: none"
            @change="onFileChange"
          />

          <template v-if="loading">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 8px">
              <div style="width: 36px; height: 36px; border: 3px solid var(--border); border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s linear infinite" />
              <p style="font-size: 13px; color: var(--text-2)">导入中…</p>
            </div>
          </template>
          <template v-else>
            <div
              :style="{
                width: '52px',
                height: '52px',
                borderRadius: '14px',
                background: dragging ? 'var(--primary)' : 'var(--surface-3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s',
              }"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" :stroke="dragging ? 'white' : 'var(--text-3)'" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </div>
            <div style="text-align: center">
              <p style="font-size: 14px; font-weight: 500; color: var(--text)">
                {{ dragging ? '松开以导入' : '拖拽文件到此处' }}
              </p>
              <p style="font-size: 12px; color: var(--text-3); margin-top: 4px">或点击选择文件（支持多选）</p>
            </div>
            <div style="display: flex; gap: 6px">
              <span v-for="ext in ['.json', '.md']" :key="ext" style="font-size: 11px; padding: 2px 8px; border-radius: 5px; border: 1px solid var(--border-subtle); color: var(--text-3); font-family: var(--font-mono)">
                {{ ext }}
              </span>
            </div>
          </template>
        </button>
      </div>

      <!-- Tab: Paste JSON -->
      <div v-else style="display: flex; flex-direction: column; gap: 14px">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px" class="paste-fields-grid">
          <div>
            <label for="import-paste-source" style="display: block; font-size: 12px; font-weight: 500; color: var(--text-2); margin-bottom: 6px">
              来源名称 <span style="color: var(--danger)">*</span>
            </label>
            <input
              id="import-paste-source"
              v-model="pasteSource"
              type="text"
              placeholder="例如：字节跳动、我的项目专题…"
              class="input-base"
              style="border-radius: 10px"
            />
          </div>
          <div>
            <label for="import-paste-category" style="display: block; font-size: 12px; font-weight: 500; color: var(--text-2); margin-bottom: 6px">
              分类名称
              <span style="margin-left: 5px; font-size: 11px; color: var(--text-3); font-weight: 400">（可选）</span>
            </label>
            <input
              id="import-paste-category"
              v-model="pasteCategory"
              type="text"
              placeholder="例如：Go、Java、系统设计…"
              class="input-base"
              style="border-radius: 10px"
            />
          </div>
        </div>

        <div>
          <label for="import-paste-json" style="display: block; font-size: 12px; font-weight: 500; color: var(--text-2); margin-bottom: 6px">
            JSON 内容 <span style="color: var(--danger)">*</span>
          </label>
          <textarea
            id="import-paste-json"
            v-model="pasteText"
            placeholder="粘贴题目 JSON 数组，参考下方『JSON 格式说明』的示例格式"
            rows="10"
            class="input-base"
            style="border-radius: 10px; font-family: var(--font-mono); font-size: var(--control-font-size); background: var(--surface-2); resize: vertical; min-height: 180px"
          />
        </div>

        <p v-if="pasteError" style="font-size: 12px; color: var(--danger); display: flex; align-items: center; gap: 6px">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {{ pasteError }}
        </p>

        <button
          type="button"
          class="btn btn-primary"
          :disabled="loading"
          @click="handlePaste"
          style="height: 40px; border-radius: 11px; font-size: 14px; font-weight: 600; width: 100%"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {{ loading ? '导入中…' : '导入题目' }}
        </button>
      </div>
    </div>

    <!-- Results -->
    <div v-if="results.length > 0" class="animate-fade-in" style="display: flex; flex-direction: column; gap: 10px">
      <div style="display: flex; align-items: center; justify-content: space-between">
        <p style="font-size: 11px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em">导入结果</p>
        <button type="button" @click="results = []" style="font-size: 12px; color: var(--text-3); background: none; border: none; cursor: pointer; padding: 0">清除</button>
      </div>

      <!-- Result Toast -->
      <div
        v-for="(r, i) in results"
        :key="i"
        class="animate-fade-in"
        :style="{
          borderRadius: '14px',
          border: '1px solid',
          borderColor: r.loaded > 0 ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)',
          background: r.loaded > 0 ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }"
      >
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px">
          <div style="display: flex; align-items: center; gap: 10px">
            <div
              :style="{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                background: r.loaded > 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }"
            >
              <svg v-if="r.loaded > 0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
            <div>
              <p :style="{ fontSize: '13px', fontWeight: 600, color: r.loaded > 0 ? '#10b981' : '#ef4444' }">
                {{ r.loaded > 0 ? `成功导入 ${r.loaded} 道题` : '导入失败，没有有效题目' }}
              </p>
              <p style="font-size: 12px; color: var(--text-3); margin-top: 2px">来源：{{ r.source }}</p>
            </div>
          </div>
          <button type="button" @click="results = results.filter((_, j) => j !== i)" style="color: var(--text-3); background: none; border: none; cursor: pointer; flex-shrink: 0; padding: 2px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div v-if="r.warnings.length > 0" style="display: flex; flex-direction: column; gap: 4px">
          <p style="font-size: 12px; font-weight: 600; color: var(--warning)">警告（{{ r.warnings.length }}）</p>
          <div style="max-height: 80px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px">
            <p v-for="w in r.warnings" :key="w" style="font-size: 12px; color: var(--text-2)">{{ w }}</p>
          </div>
        </div>

        <div v-if="r.errors.length > 0" style="display: flex; flex-direction: column; gap: 4px">
          <p style="font-size: 12px; font-weight: 600; color: var(--danger)">无效题目（{{ r.errors.length }} 条）</p>
          <div style="max-height: 100px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; font-family: var(--font-mono)">
            <p v-for="e in r.errors.slice(0, 5)" :key="`${e.index}-${e.message}`" style="font-size: 11px; color: var(--text-3)">
              [{{ e.index === -1 ? '格式' : `第${e.index + 1}条` }}] {{ e.message }}
            </p>
            <p v-if="r.errors.length > 5" style="font-size: 11px; color: var(--text-3)">还有 {{ r.errors.length - 5 }} 个错误</p>
          </div>
        </div>
      </div>

      <!-- Action buttons -->
      <div v-if="results.some(r => r.loaded > 0)" style="display: flex; gap: 8px; padding-top: 4px">
        <button class="btn btn-primary btn-sm" @click="router.push('/questions')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          查看题库
        </button>
        <button class="btn btn-secondary btn-sm" @click="router.push('/practice')">开始练习</button>
      </div>
    </div>

    <!-- Schema Guide -->
    <div class="animate-fade-in stagger-2">
      <div style="border-radius: 12px; border: 1px solid var(--border-subtle); overflow: hidden">
        <button
          type="button"
          @click="schemaExpanded = !schemaExpanded"
          class="schema-toggle"
          style="width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--surface-2); border: none; cursor: pointer; text-align: left; transition: background 0.15s"
        >
          <span style="font-size: 13px; font-weight: 500; color: var(--text)">JSON 格式说明</span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :style="{ color: 'var(--text-3)', transform: schemaExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <div v-if="schemaExpanded" class="animate-fade-in" style="padding: 16px; display: flex; flex-direction: column; gap: 16px; border-top: 1px solid var(--border-subtle)">
          <!-- Field table -->
          <table style="width: 100%; border-collapse: collapse; font-size: 12px">
            <thead style="background: var(--surface-2)">
              <tr>
                <th v-for="h in ['字段', '类型', '必填', '说明']" :key="h" style="padding: 8px 12px; text-align: left; font-weight: 600; color: var(--text-2); white-space: nowrap">{{ h }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="([field, type, required, desc], rowI) in schemaFields"
                :key="field"
                :style="{ borderTop: rowI === 0 ? 'none' : '1px solid var(--border-subtle)' }"
              >
                <td style="padding: 7px 12px; font-family: var(--font-mono); color: var(--primary); white-space: nowrap">{{ field }}</td>
                <td style="padding: 7px 12px; font-family: var(--font-mono); color: var(--text-2); white-space: nowrap">{{ type }}</td>
                <td :style="{ padding: '7px 12px', color: required === '必填' ? 'var(--success)' : 'var(--text-3)', whiteSpace: 'nowrap', fontSize: '11px', fontWeight: 500 }">{{ required }}</td>
                <td style="padding: 7px 12px; color: var(--text-2); font-size: 11px">{{ desc }}</td>
              </tr>
            </tbody>
          </table>

          <!-- Example -->
          <div>
            <p style="font-size: 11px; font-weight: 500; color: var(--text-2); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em">示例</p>
            <pre style="font-size: 11px; font-family: var(--font-mono); background: var(--surface-2); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 12px 14px; overflow-x: auto; color: var(--text); line-height: 1.6; margin: 0">{{ SCHEMA_EXAMPLE }}</pre>
          </div>
        </div>
      </div>
    </div>

    <!-- Category Overview -->
    <div class="animate-fade-in stagger-3" style="display: flex; flex-direction: column; gap: 10px">
      <p style="font-size: 11px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em">分类总览</p>
      <div v-if="categoryEntries.length > 0" style="display: flex; flex-direction: column; gap: 8px">
        <div
          v-for="cat in categoryEntries"
          :key="cat.name"
          style="display: flex; align-items: center; gap: 10px; padding: 9px 14px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border-subtle)"
        >
          <span style="font-size: 13px; font-weight: 600; color: var(--text); min-width: 60px; flex-shrink: 0">{{ cat.name }}</span>
          <div style="display: flex; flex-wrap: wrap; gap: 5px; flex: 1; min-width: 0">
            <span
              v-for="m in cat.modules"
              :key="m"
              style="font-size: 11px; padding: 2px 8px; border-radius: 5px; background: var(--surface-3); color: var(--text-2); border: 1px solid var(--border-subtle); white-space: nowrap"
            >{{ m }}</span>
            <span v-if="cat.modules.length === 0" style="font-size: 11px; color: var(--text-3)">暂无模块</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Custom Sources Manager -->
    <div class="animate-fade-in stagger-3" style="display: flex; flex-direction: column; gap: 10px">
      <div style="display: flex; align-items: center; justify-content: space-between">
        <p style="font-size: 11px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em">已导入的自定义来源</p>
        <span v-if="customSources.length > 0" style="font-size: 12px; color: var(--text-3)">{{ customSources.length }} 个来源</span>
      </div>

      <div v-if="customSources.length === 0" style="padding: 28px 16px; text-align: center; color: var(--text-3); font-size: 13px">
        暂无自定义来源，导入题目后会在这里显示
      </div>
      <div v-else style="display: flex; flex-direction: column; gap: 6px">
        <div
          v-for="source in customSources"
          :key="source"
          style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border-subtle)"
        >
          <span style="font-size: 13px; font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0">{{ source }}</span>
          <button
            type="button"
            @click="handleRemoveSource(source)"
            style="flex-shrink: 0; display: flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 7px; font-size: 12px; color: var(--danger); border: 1px solid rgba(239,68,68,0.2); background: transparent; cursor: pointer; transition: all 0.15s"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
            删除
          </button>
        </div>
      </div>
    </div>

    <!-- AI Tip card -->
    <div class="animate-fade-in stagger-4">
      <div class="card" style="padding: 14px 16px; display: flex; align-items: flex-start; gap: 12px; border-color: rgba(var(--primary-rgb), 0.15); background: var(--primary-light)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: 1px">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="8" y1="8" x2="16" y2="8" />
          <line x1="8" y1="16" x2="12" y2="16" />
        </svg>
        <div style="display: flex; flex-direction: column; gap: 4px">
          <p style="font-size: 13px; font-weight: 600; color: var(--text)">用 AI 生成题目</p>
          <p style="font-size: 12px; color: var(--text-2); line-height: 1.6">
            复制本页的 JSON 格式说明，配合项目提示词让 AI 生成题目。生成完成后粘贴到「粘贴 JSON」区域即可一键导入，ID 重复时会自动加前缀避免冲突。
          </p>
          <button
            type="button"
            @click="router.push('/prompt')"
            style="display: inline-flex; align-items: center; gap: 5px; margin-top: 2px; font-size: 12px; font-weight: 500; color: var(--primary); background: none; border: none; cursor: pointer; padding: 0"
          >
            查看 AI 出题 Prompt
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
.btn:disabled { opacity: 0.5; cursor: default; }
.btn-sm { font-size: 12px; height: 28px; padding: 6px 12px; }
.btn-primary {
  background: var(--primary);
  border-color: var(--primary);
  color: white;
  box-shadow: var(--shadow-md);
}
.btn-primary:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); }
.btn-secondary {
  background: var(--surface);
  border-color: var(--border);
  color: var(--text);
}
.btn-secondary:hover:not(:disabled) { background: var(--surface-2); }

.schema-toggle:hover {
  background: var(--surface-3);
}

@media (max-width: 600px) {
  .paste-fields-grid {
    grid-template-columns: 1fr !important;
  }
  .builtin-library-card {
    flex-direction: column !important;
    align-items: stretch !important;
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
