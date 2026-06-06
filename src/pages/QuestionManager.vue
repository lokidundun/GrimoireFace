<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import type { Question, Difficulty } from '@/types'
import { getAllQuestions, putQuestion, deleteQuestionById, questionExists, getAllStudyRecords } from '@/lib/db'
import { invalidateQuestionsCache } from '@/composables/useQuestions'

const questions = ref<Question[]>([])
const records = ref<Record<string, { status: string }>>({})
const loading = ref(false)
const searchQuery = ref('')
const selectedModule = ref('')
const selectedDifficulty = ref<'' | Difficulty>('')
const showModal = ref(false)
const editingQuestion = ref<Question | null>(null)
const deleteConfirmId = ref<string | null>(null)
const selectedIds = ref<Set<string>>(new Set())

// Module dropdown state
const moduleDropdownOpen = ref(false)
const moduleSearchQuery = ref('')
const moduleDropdownRef = ref<HTMLDivElement | null>(null)

const filteredModules = computed(() => {
  const query = moduleSearchQuery.value.trim().toLowerCase()
  if (!query) return modules.value
  return modules.value.filter((m) => m.toLowerCase().includes(query))
})

const selectedCount = computed(() => selectedIds.value.size)
const isAllPageSelected = computed(() =>
  pagedQuestions.value.length > 0 && pagedQuestions.value.every((q) => selectedIds.value.has(q.id)),
)

const form = ref({
  id: '',
  module: '',
  difficulty: 1 as Difficulty,
  question: '',
  answer: '',
  tags: '',
  source: '',
})

const modules = computed(() => {
  const set = new Set(questions.value.map((q) => q.module))
  return [...set].sort()
})

const filteredQuestions = computed(() => {
  let result = questions.value
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    result = result.filter(
      (item) =>
        item.question.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q) ||
        item.module.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }
  if (selectedModule.value) {
    result = result.filter((item) => item.module === selectedModule.value)
  }
  if (selectedDifficulty.value !== '') {
    result = result.filter((item) => item.difficulty === selectedDifficulty.value)
  }
  return result
})

// ─── Pagination ────────────────────────────────────────────────────────────────

const page = ref(1)
const pageSize = ref(20)

const totalPages = computed(() => Math.max(1, Math.ceil(filteredQuestions.value.length / pageSize.value)))

const pagedQuestions = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredQuestions.value.slice(start, start + pageSize.value)
})

watch([searchQuery, selectedModule, selectedDifficulty], () => {
  page.value = 1
  selectedIds.value = new Set()
})

watch(page, () => {
  selectedIds.value = new Set()
})

async function load() {
  loading.value = true
  try {
    questions.value = await getAllQuestions()
    const allRecords = await getAllStudyRecords()
    const map: Record<string, { status: string }> = {}
    for (const r of allRecords) {
      map[r.questionId] = { status: r.status }
    }
    records.value = map
  } finally {
    loading.value = false
  }
}

onMounted(load)

// Click outside to close module dropdown
function onDocumentClick(e: MouseEvent) {
  if (moduleDropdownRef.value && !moduleDropdownRef.value.contains(e.target as Node)) {
    moduleDropdownOpen.value = false
  }
}

function openModuleDropdown() {
  moduleDropdownOpen.value = true
  moduleSearchQuery.value = form.value.module
}

watch(moduleDropdownOpen, (open) => {
  if (open) {
    nextTick(() => document.addEventListener('click', onDocumentClick))
  } else {
    document.removeEventListener('click', onDocumentClick)
  }
})

function selectModule(mod: string) {
  form.value.module = mod
  moduleDropdownOpen.value = false
  moduleSearchQuery.value = ''
}

function openAdd() {
  editingQuestion.value = null
  form.value = {
    id: 'custom_' + Date.now(),
    module: selectedModule.value || '',
    difficulty: 1,
    question: '',
    answer: '',
    tags: '',
    source: 'manual',
  }
  showModal.value = true
}

function openEdit(q: Question) {
  editingQuestion.value = q
  form.value = {
    id: q.id,
    module: q.module,
    difficulty: q.difficulty,
    question: q.question,
    answer: q.answer,
    tags: q.tags.join(', '),
    source: q.source || '',
  }
  showModal.value = true
}

async function handleSave() {
  const tags = form.value.tags
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean)

  const q: Question = {
    id: form.value.id.trim(),
    module: form.value.module.trim(),
    difficulty: form.value.difficulty,
    question: form.value.question.trim(),
    answer: form.value.answer.trim(),
    tags,
    source: form.value.source.trim() || 'manual',
  }

  if (!q.id) {
    alert('ID 不能为空')
    return
  }
  if (!q.module) {
    alert('模块不能为空')
    return
  }
  if (!q.question) {
    alert('题干不能为空')
    return
  }

  if (!editingQuestion.value) {
    const exists = await questionExists(q.id)
    if (exists) {
      alert('该 ID 已存在')
      return
    }
  }

  await putQuestion(q)
  invalidateQuestionsCache()
  await load()
  showModal.value = false
}

async function handleDelete(id: string) {
  await deleteQuestionById(id)
  invalidateQuestionsCache()
  await load()
  deleteConfirmId.value = null
  selectedIds.value.delete(id)
}

function toggleSelect(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function toggleSelectAll() {
  const next = new Set(selectedIds.value)
  if (isAllPageSelected.value) {
    for (const q of pagedQuestions.value) next.delete(q.id)
  } else {
    for (const q of pagedQuestions.value) next.add(q.id)
  }
  selectedIds.value = next
}

async function handleBatchDelete() {
  if (selectedIds.value.size === 0) return
  if (!confirm(`确定要删除选中的 ${selectedIds.value.size} 道题吗？此操作不可恢复。`)) return
  for (const id of selectedIds.value) {
    await deleteQuestionById(id)
  }
  invalidateQuestionsCache()
  selectedIds.value = new Set()
  await load()
}

function difficultyLabel(d: Difficulty) {
  return ['入门', '进阶', '困难'][d - 1]
}

function difficultyColor(d: Difficulty) {
  return ['var(--success)', 'var(--warning)', 'var(--danger)'][d - 1]
}
</script>

<template>
  <div class="page">
    <div class="page-inner">
      <!-- Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; flex-wrap: wrap; gap: 12px">
        <div>
          <h1 style="font-size: 22px; font-weight: 600; color: var(--text); margin: 0 0 4px">题目管理</h1>
          <p style="font-size: 13px; color: var(--text-3); margin: 0">共 {{ questions.length }} 道题，当前显示 {{ filteredQuestions.length }} 道</p>
        </div>
        <div style="display: flex; gap: 8px"
        >
          <RouterLink
            to="/import"
            style="padding: 8px 16px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); font-size: 14px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 6px; text-decoration: none"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            批量导入
          </RouterLink>
          <button
            type="button"
            @click="openAdd"
            style="padding: 8px 16px; border-radius: 10px; border: none; background: var(--primary); color: white; font-size: 14px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 6px"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            添加题目
          </button>
        </div>
      </div>

      <!-- Filters -->
      <div style="display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索题干、答案、模块或标签..."
          style="flex: 1; min-width: 200px; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 13px; outline: none"
        />
        <select
          v-model="selectedModule"
          style="padding: 8px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 13px; outline: none; cursor: pointer"
        >
          <option value="">全部模块</option>
          <option v-for="m in modules" :key="m" :value="m">{{ m }}</option>
        </select>
        <select
          v-model="selectedDifficulty"
          style="padding: 8px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 13px; outline: none; cursor: pointer"
        >
          <option value="">全部难度</option>
          <option :value="1">入门</option>
          <option :value="2">进阶</option>
          <option :value="3">困难</option>
        </select>
      </div>

      <!-- Table -->
      <div class="card" style="overflow: hidden; padding: 0">
        <div v-if="loading" style="padding: 40px; text-align: center; color: var(--text-3)">加载中...</div>
        <div v-else-if="filteredQuestions.length === 0" style="padding: 40px; text-align: center; color: var(--text-3)">
          暂无题目
        </div>
        <template v-else>
          <!-- Batch toolbar -->
          <div v-if="selectedCount > 0" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--border-subtle); background: var(--primary-light)">
            <span style="font-size: 13px; font-weight: 500; color: var(--primary)">已选中 {{ selectedCount }} 道</span>
            <button
              type="button"
              @click="handleBatchDelete"
              style="padding: 5px 12px; border-radius: 6px; border: none; background: var(--danger); color: white; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 4px"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              批量删除
            </button>
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-subtle)">
                <th style="text-align: center; padding: 12px 8px; font-weight: 600; color: var(--text-2); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; width: 40px">
                  <input
                    type="checkbox"
                    :checked="isAllPageSelected"
                    @change="toggleSelectAll"
                    style="width: 14px; height: 14px; cursor: pointer; accent-color: var(--primary)"
                  />
                </th>
                <th style="text-align: left; padding: 12px 16px; font-weight: 600; color: var(--text-2); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap">模块</th>
                <th style="text-align: left; padding: 12px 16px; font-weight: 600; color: var(--text-2); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em">题干</th>
                <th style="text-align: center; padding: 12px 16px; font-weight: 600; color: var(--text-2); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap">难度</th>
                <th style="text-align: left; padding: 12px 16px; font-weight: 600; color: var(--text-2); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap">标签</th>
                <th style="text-align: center; padding: 12px 16px; font-weight: 600; color: var(--text-2); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap">状态</th>
                <th style="text-align: right; padding: 12px 16px; font-weight: 600; color: var(--text-2); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="q in pagedQuestions"
                :key="q.id"
                style="border-bottom: 1px solid var(--border-subtle); transition: background 0.1s"
              :style="{ background: deleteConfirmId === q.id ? 'var(--danger-light)' : 'transparent' }"
              @mouseenter="$event.currentTarget.style.background = 'var(--surface-2)'"
              @mouseleave="$event.currentTarget.style.background = deleteConfirmId === q.id ? 'var(--danger-light)' : 'transparent'"
            >
              <td style="padding: 12px 8px; text-align: center">
                <input
                  type="checkbox"
                  :checked="selectedIds.has(q.id)"
                  @change="toggleSelect(q.id)"
                  style="width: 14px; height: 14px; cursor: pointer; accent-color: var(--primary)"
                />
              </td>
              <td style="padding: 12px 16px; white-space: nowrap; color: var(--text); font-weight: 500">{{ q.module }}</td>
              <td style="padding: 12px 16px; color: var(--text); max-width: 300px">
                <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ q.question }}</div>
              </td>
              <td style="padding: 12px 16px; text-align: center">
                <span :style="{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '99px', background: difficultyColor(q.difficulty) + '20', color: difficultyColor(q.difficulty) }">
                  {{ difficultyLabel(q.difficulty) }}
                </span>
              </td>
              <td style="padding: 12px 16px; white-space: nowrap">
                <span
                  v-for="tag in q.tags.slice(0, 3)"
                  :key="tag"
                  style="font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--surface-3); color: var(--text-3); margin-right: 4px"
                >
                  {{ tag }}
                </span>
                <span v-if="q.tags.length > 3" style="font-size: 11px; color: var(--text-3)">+{{ q.tags.length - 3 }}</span>
              </td>
              <td style="padding: 12px 16px; text-align: center">
                <span v-if="records[q.id]?.status === 'mastered'" style="font-size: 11px; color: var(--success); font-weight: 500">已掌握</span>
                <span v-else-if="records[q.id]?.status === 'review'" style="font-size: 11px; color: var(--warning); font-weight: 500">需复习</span>
                <span v-else style="font-size: 11px; color: var(--text-3)">未学习</span>
              </td>
              <td style="padding: 12px 16px; text-align: right; white-space: nowrap">
                <template v-if="deleteConfirmId === q.id">
                  <span style="font-size: 12px; color: var(--danger); margin-right: 8px">确认删除？</span>
                  <button type="button" @click="handleDelete(q.id)" style="padding: 4px 10px; border-radius: 6px; border: none; background: var(--danger); color: white; font-size: 12px; cursor: pointer; margin-right: 4px">删除</button>
                  <button type="button" @click="deleteConfirmId = null" style="padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text-2); font-size: 12px; cursor: pointer">取消</button>
                </template>
                <template v-else>
                  <button type="button" @click="openEdit(q)" style="padding: 4px 10px; border-radius: 6px; border: none; background: transparent; color: var(--primary); font-size: 12px; cursor: pointer; margin-right: 4px">编辑</button>
                  <button type="button" @click="deleteConfirmId = q.id" style="padding: 4px 10px; border-radius: 6px; border: none; background: transparent; color: var(--danger); font-size: 12px; cursor: pointer">删除</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        </template>

        <!-- Pagination -->
        <div
          v-if="totalPages > 1 || filteredQuestions.length > 10"
          style="display: flex; align-items: center; justify-content: space-between; padding: 16px; gap: 12px; flex-wrap: wrap; border-top: 1px solid var(--border-subtle)"
        >
          <!-- Page size selector -->
          <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-3)">
            <span style="white-space: nowrap">每页</span>
            <input
              type="number"
              :value="pageSize"
              @change="pageSize = Math.max(5, Math.min(200, Math.round(parseInt(($event.target as HTMLInputElement).value, 10) || 20))); page = 1"
              min="5"
              max="200"
              style="width: 48px; padding: 3px 6px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 12px; text-align: center; outline: none; font-variant-numeric: tabular-nums"
            />
            <span style="white-space: nowrap">道</span>
          </div>

          <!-- Page navigation -->
          <div style="display: flex; align-items: center; gap: 4px">
            <button
              type="button"
              :disabled="page <= 1"
              @click="page = 1"
              style="padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); font-size: 12px; cursor: pointer; transition: all 0.12s"
              :style="{ opacity: page <= 1 ? 0.4 : 1, pointerEvents: page <= 1 ? 'none' : 'auto' }"
              title="首页"
            >
              «
            </button>
            <button
              type="button"
              :disabled="page <= 1"
              @click="page--"
              style="padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); font-size: 12px; cursor: pointer; transition: all 0.12s"
              :style="{ opacity: page <= 1 ? 0.4 : 1, pointerEvents: page <= 1 ? 'none' : 'auto' }"
            >
              ← 上一页
            </button>

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
              >
                {{ pg }}
              </button>
              <span
                v-else-if="pg === page - 3 || pg === page + 3"
                style="font-size: 12px; color: var(--text-3); padding: 0 2px"
              >
                …
              </span>
            </template>

            <button
              type="button"
              :disabled="page >= totalPages"
              @click="page++"
              style="padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); font-size: 12px; cursor: pointer; transition: all 0.12s"
              :style="{ opacity: page >= totalPages ? 0.4 : 1, pointerEvents: page >= totalPages ? 'none' : 'auto' }"
            >
              下一页 →
            </button>
            <button
              type="button"
              :disabled="page >= totalPages"
              @click="page = totalPages"
              style="padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); font-size: 12px; cursor: pointer; transition: all 0.12s"
              :style="{ opacity: page >= totalPages ? 0.4 : 1, pointerEvents: page >= totalPages ? 'none' : 'auto' }"
              title="末页"
            >
              »
            </button>
          </div>

          <!-- Summary -->
          <span style="font-size: 11px; color: var(--text-3); white-space: nowrap">
            第 {{ filteredQuestions.length === 0 ? 0 : page }}/{{ totalPages }} 页，共 {{ filteredQuestions.length }} 道
          </span>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center" style="background: rgba(0,0,0,0.4); backdrop-filter: blur(4px)" @click.self="showModal = false">
          <div class="card" style="width: 100%; max-width: 600px; max-height: 90vh; overflow-y: auto; margin: 20px; padding: 24px">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px">
              <h2 style="font-size: 18px; font-weight: 600; color: var(--text); margin: 0">{{ editingQuestion ? '编辑题目' : '添加题目' }}</h2>
              <button type="button" @click="showModal = false" style="width: 28px; height: 28px; border-radius: 8px; border: none; background: transparent; color: var(--text-3); cursor: pointer; display: flex; align-items: center; justify-content: center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div style="display: flex; flex-direction: column; gap: 14px">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
                <div>
                  <label style="display: block; font-size: 12px; font-weight: 500; color: var(--text-2); margin-bottom: 4px">ID <span style="color: var(--danger)">*</span></label>
                  <input v-model="form.id" type="text" :disabled="!!editingQuestion" style="width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 13px; outline: none; box-sizing: border-box" placeholder="唯一标识" />
                </div>
                <div ref="moduleDropdownRef" style="position: relative">
                  <label style="display: block; font-size: 12px; font-weight: 500; color: var(--text-2); margin-bottom: 4px">模块 <span style="color: var(--danger)">*</span></label>
                  <input
                    :value="form.module"
                    @focus="openModuleDropdown"
                    @input="form.module = ($event.target as HTMLInputElement).value; moduleSearchQuery = form.module"
                    @keydown.enter.prevent="moduleDropdownOpen = false; moduleSearchQuery = ''"
                    type="text"
                    style="width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 13px; outline: none; box-sizing: border-box"
                    placeholder="如：Go基础（支持搜索现有模块）"
                  />
                  <div
                    v-if="moduleDropdownOpen"
                    style="
                      position: absolute;
                      top: calc(100% + 4px);
                      left: 0;
                      right: 0;
                      z-index: 50;
                      max-height: 200px;
                      overflow-y: auto;
                      background: var(--surface);
                      border: 1px solid var(--border);
                      border-radius: 8px;
                      box-shadow: var(--shadow-md);
                    "
                  >
                    <div
                      v-if="filteredModules.length === 0"
                      style="padding: 8px 10px; font-size: 12px; color: var(--text-3)"
                    >
                      无匹配模块，按回车使用 "{{ form.module }}"
                    </div>
                    <button
                      v-for="mod in filteredModules"
                      :key="mod"
                      type="button"
                      @click="selectModule(mod)"
                      style="
                        display: block;
                        width: 100%;
                        padding: 7px 10px;
                        text-align: left;
                        border: none;
                        background: transparent;
                        color: var(--text);
                        font-size: 13px;
                        cursor: pointer;
                        transition: background 0.1s;
                      "
                      @mouseenter="($event.target as HTMLElement).style.background = 'var(--surface-2)'"
                      @mouseleave="($event.target as HTMLElement).style.background = 'transparent'"
                    >
                      {{ mod }}
                    </button>
                  </div>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px">
                <div>
                  <label style="display: block; font-size: 12px; font-weight: 500; color: var(--text-2); margin-bottom: 4px">难度 <span style="color: var(--danger)">*</span></label>
                  <select v-model="form.difficulty" style="width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 13px; outline: none; box-sizing: border-box; cursor: pointer">
                    <option :value="1">入门</option>
                    <option :value="2">进阶</option>
                    <option :value="3">困难</option>
                  </select>
                </div>
                <div>
                  <label style="display: block; font-size: 12px; font-weight: 500; color: var(--text-2); margin-bottom: 4px">标签</label>
                  <input v-model="form.tags" type="text" style="width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 13px; outline: none; box-sizing: border-box" placeholder="逗号分隔，如：数组, 指针" />
                </div>
              </div>

              <div>
                <label style="display: block; font-size: 12px; font-weight: 500; color: var(--text-2); margin-bottom: 4px">题干 <span style="color: var(--danger)">*</span></label>
                <textarea v-model="form.question" rows="4" style="width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 13px; outline: none; box-sizing: border-box; resize: vertical; font-family: inherit" placeholder="输入题目内容，支持 Markdown"></textarea>
              </div>

              <div>
                <label style="display: block; font-size: 12px; font-weight: 500; color: var(--text-2); margin-bottom: 4px">答案</label>
                <textarea v-model="form.answer" rows="6" style="width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 13px; outline: none; box-sizing: border-box; resize: vertical; font-family: inherit" placeholder="输入答案内容，支持 Markdown"></textarea>
              </div>

              <div>
                <label style="display: block; font-size: 12px; font-weight: 500; color: var(--text-2); margin-bottom: 4px">来源</label>
                <input v-model="form.source" type="text" style="width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 13px; outline: none; box-sizing: border-box" placeholder="如：manual 或自定义来源" />
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border-subtle)">
              <button type="button" @click="showModal = false" style="padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--text-2); font-size: 13px; cursor: pointer">取消</button>
              <button type="button" @click="handleSave" style="padding: 8px 16px; border-radius: 8px; border: none; background: var(--primary); color: white; font-size: 13px; font-weight: 500; cursor: pointer">保存</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.page {
  padding-top: calc(var(--navbar-h) + 20px);
  padding-bottom: 40px;
}
.page-inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 20px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .page-inner {
    padding: 0 12px;
  }
}
</style>
