import type { AlgoProblem } from '../types'
import { bulkPutAlgoProblems, getAllAlgoProblems, addCustomSource, algoProblemExists } from './db'
import { registerModuleInCategory } from './db'

export interface AlgoImportResult {
  imported: number
  updated: number
  errors: string[]
}

export function normalizeAlgoProblemsForImport(data: unknown): AlgoProblem[] {
  if (!data || typeof data !== 'object') return []

  const obj = data as Record<string, unknown>
  const raw = Array.isArray(obj) ? obj : obj.problems ?? obj.data ?? []
  if (!Array.isArray(raw)) return []

  return raw
    .map((item): AlgoProblem | null => {
      if (!item || typeof item !== 'object') return null
      const q = item as Record<string, unknown>

      const id = String(q.id ?? '').trim()
      if (!id) return null

      const difficulty = Number(q.difficulty ?? 1)
      if (![1, 2, 3].includes(difficulty)) return null

      const samples = Array.isArray(q.samples)
        ? q.samples
            .filter((s: unknown) => s && typeof s === 'object')
            .map((s: Record<string, unknown>) => ({
              input: String(s.input ?? ''),
              output: String(s.output ?? ''),
              explanation: s.explanation ? String(s.explanation) : undefined,
            }))
        : []

      const testCases = Array.isArray(q.testCases)
        ? q.testCases
            .filter((t: unknown) => t && typeof t === 'object')
            .map((t: Record<string, unknown>) => ({
              input: String(t.input ?? ''),
              output: String(t.output ?? ''),
              isPublic: t.isPublic === false ? false : true,
            }))
        : [...samples.map((s) => ({ ...s, isPublic: true }))]

      return {
        id,
        title: String(q.title ?? id),
        module: String(q.module ?? '未分类'),
        difficulty: difficulty as 1 | 2 | 3,
        description: String(q.description ?? ''),
        inputDesc: String(q.inputDesc ?? q.inputDescription ?? ''),
        outputDesc: String(q.outputDesc ?? q.outputDescription ?? ''),
        samples,
        testCases,
        hints: Array.isArray(q.hints) ? q.hints.filter((h: unknown): h is string => typeof h === 'string') : [],
        tags: Array.isArray(q.tags) ? q.tags.filter((t: unknown): t is string => typeof t === 'string') : [],
        source: q.source ? String(q.source) : undefined,
        timeLimit: q.timeLimit ? Number(q.timeLimit) : undefined,
        memoryLimit: q.memoryLimit ? Number(q.memoryLimit) : undefined,
      }
    })
    .filter((p): p is AlgoProblem => p !== null)
}

export async function importAlgoProblems(
  data: unknown,
  sourceName: string,
  categoryName?: string,
): Promise<AlgoImportResult> {
  const problems = normalizeAlgoProblemsForImport(data)
  const result: AlgoImportResult = { imported: 0, updated: 0, errors: [] }

  const stamped = problems.map((p) => {
    const newId = p.id.startsWith('custom_') ? p.id : `custom_${sourceName}_${p.id}`
    return { ...p, id: newId, source: sourceName }
  })

  // Check for ID collisions
  const existing = await getAllAlgoProblems()
  const existingIds = new Set(existing.map((q) => q.id))
  for (const p of stamped) {
    if (existingIds.has(p.id)) {
      result.updated++
    }
  }

  if (stamped.length === 0) {
    result.errors.push('没有有效的题目数据')
    return result
  }

  await bulkPutAlgoProblems(stamped)
  result.imported = stamped.length

  // Register modules in category
  const modules = [...new Set(stamped.map((p) => p.module))]
  for (const m of modules) {
    await registerModuleInCategory(categoryName ?? sourceName, m)
  }

  await addCustomSource(sourceName)
  return result
}

export async function validateAlgoProblems(data: unknown): Promise<{ valid: boolean; errors: string[] }> {
  const problems = normalizeAlgoProblemsForImport(data)
  const errors: string[] = []

  if (problems.length === 0) {
    errors.push('没有找到有效的算法题数据')
    return { valid: false, errors }
  }

  for (const p of problems) {
    if (!p.id) errors.push('有题目缺少 id')
    if (!p.title) errors.push(`题目 ${p.id} 缺少 title`)
    if (!p.description) errors.push(`题目 ${p.id} 缺少 description`)
    if (p.testCases.length === 0) errors.push(`题目 ${p.id} 没有测试用例`)
  }

  return { valid: errors.length === 0, errors }
}
