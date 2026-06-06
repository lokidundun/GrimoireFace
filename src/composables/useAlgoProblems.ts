import { ref, computed, watch, type MaybeRefOrGetter, toValue } from 'vue'
import type { AlgoProblem, Difficulty, Module } from '@/types'
import { getAllAlgoProblems, putAlgoProblem } from '@/lib/db'

export type AlgoSortKey = 'default' | 'difficulty-asc' | 'difficulty-desc' | 'module'

let _allProblems: AlgoProblem[] = []
let _loaded = false
let _loading = false
const _waiters: Array<() => void> = []

const BUILTIN_TWO_SUM: AlgoProblem = {
  id: 'builtin_two_sum',
  title: '两数之和',
  module: '数组',
  difficulty: 1,
  description:
    '给定一个整数数组 `nums` 和一个整数目标值 `target`，请你在该数组中找出 **和为目标值** 的两个整数，并返回它们的下标（从 0 开始）。\\n\\n你可以假设每种输入只会对应一个答案，且同一个元素不能使用两遍。\\n\\n你可以按任意顺序输出答案。',
  inputDesc:
    '第一行包含两个整数 `n` 和 `target`，分别表示数组长度和目标值。\\n第二行包含 `n` 个整数，表示数组 `nums`。',
  outputDesc: '输出两个整数，以空格分隔，表示和为目标值的两个元素的下标。',
  samples: [
    {
      input: '4 9\\n2 7 11 15\\n',
      output: '0 1\\n',
      explanation: '因为 nums[0] + nums[1] = 2 + 7 = 9，所以返回下标 0 和 1。',
    },
  ],
  testCases: [
    { input: '4 9\\n2 7 11 15\\n', output: '0 1\\n', isPublic: true },
    { input: '3 6\\n3 2 4\\n', output: '1 2\\n', isPublic: false },
    { input: '2 6\\n3 3\\n', output: '0 1\\n', isPublic: false },
  ],
  hints: ['考虑使用哈希表（对象/Map）来存储已经遍历过的数值及其下标。', '遍历数组时，用 target 减去当前值，看看差值是否已经在哈希表中。'],
  tags: ['数组', '哈希表'],
  source: 'builtin',
  timeLimit: 1000,
  memoryLimit: 64,
}

async function ensureLoaded(): Promise<AlgoProblem[]> {
  if (_loaded) return _allProblems

  if (_loading) {
    return new Promise<AlgoProblem[]>((resolve) => {
      _waiters.push(() => resolve(_allProblems))
    })
  }

  _loading = true
  _allProblems = await getAllAlgoProblems()

  if (_allProblems.length === 0) {
    await putAlgoProblem(BUILTIN_TWO_SUM)
    _allProblems = [BUILTIN_TWO_SUM]
  }

  _loaded = true
  _loading = false
  _waiters.forEach((fn) => fn())
  _waiters.length = 0
  return _allProblems
}

export function invalidateAlgoCache() {
  _loaded = false
  _allProblems = []
}

export interface AlgoFilterState {
  modules: Module[]
  difficulties: Difficulty[]
  search: string
  tags: string[]
}

export function useAlgoProblems(
  filter?: MaybeRefOrGetter<AlgoFilterState | undefined>,
  sort?: MaybeRefOrGetter<AlgoSortKey>,
) {
  const problems = ref<AlgoProblem[]>([])
  const loading = ref(true)
  const error = ref<string | null>(null)

  async function reload() {
    loading.value = true
    error.value = null
    try {
      await ensureLoaded()
      problems.value = applyFilters(_allProblems, toValue(filter))
      applySort(problems.value, toValue(sort))
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  reload()

  watch(
    () => [toValue(filter), toValue(sort)],
    () => {
      problems.value = applyFilters(_allProblems, toValue(filter))
      applySort(problems.value, toValue(sort))
    },
    { deep: true },
  )

  const modules = computed(() => [...new Set(_allProblems.map((p) => p.module))].sort())
  const tags = computed(() =>
    [...new Set(_allProblems.flatMap((p) => p.tags))].sort(),
  )

  return {
    problems,
    loading,
    error,
    reload,
    modules,
    tags,
    getProblemById: (id: string) => _allProblems.find((p) => p.id === id),
    getProblemsByModule: (module: string) => _allProblems.filter((p) => p.module === module),
  }
}

function applyFilters(
  all: AlgoProblem[],
  filter: AlgoFilterState | undefined,
): AlgoProblem[] {
  if (!filter) return [...all]

  return all.filter((p) => {
    if (filter.modules.length > 0 && !filter.modules.includes(p.module)) return false
    if (filter.difficulties.length > 0 && !filter.difficulties.includes(p.difficulty)) return false
    if (filter.tags.length > 0 && !filter.tags.some((t) => (p.tags || []).includes(t))) return false
    if (filter.search) {
      const s = filter.search.toLowerCase()
      const inTitle = p.title.toLowerCase().includes(s)
      const inDesc = p.description.toLowerCase().includes(s)
      const inModule = p.module.toLowerCase().includes(s)
      const inTags = (p.tags || []).some((t) => t.toLowerCase().includes(s))
      if (!inTitle && !inDesc && !inModule && !inTags) return false
    }
    return true
  })
}

function applySort(list: AlgoProblem[], sort: AlgoSortKey | undefined) {
  if (!sort || sort === 'default') return

  if (sort === 'difficulty-asc') {
    list.sort((a, b) => a.difficulty - b.difficulty)
  } else if (sort === 'difficulty-desc') {
    list.sort((a, b) => b.difficulty - a.difficulty)
  } else if (sort === 'module') {
    list.sort((a, b) => a.module.localeCompare(b.module) || a.title.localeCompare(b.title))
  }
}
