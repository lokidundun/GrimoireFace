<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'

// ─── Constants ─────────────────────────────────────────────────────────────────

const BUILTIN_MODULE_VALUES = [
  'JS基础', 'React', 'Vue', '性能优化', '网络', 'CSS', 'TypeScript', '手写题', '项目深挖',
]

const AI_AGENT_MODULE_VALUES = [
  'LLM基础', 'Prompt工程', 'Agent架构', 'RAG与知识库', '工具调用与工作流', '评测与线上优化',
]

const MODULE_SUGGESTIONS = [
  ...BUILTIN_MODULE_VALUES, ...AI_AGENT_MODULE_VALUES,
  'Golang', 'Java', 'Python', 'Rust', 'Node.js', '数据库', '算法', '系统设计', 'DevOps', 'Android', 'iOS',
]

// ─── MD → JSON Converter ───────────────────────────────────────────────────────

function mdToQuestions(md: string): { questions: Record<string, unknown>[]; errors: string[] } {
  const questions: Record<string, unknown>[] = []
  const errors: string[] = []

  const blocks = md
    .split(/\n(?:---|\*\*\*)\n/)
    .map((b) => b.trim())
    .filter(Boolean)

  const diffMap: Record<string, number> = {
    '初级': 1, '入门': 1, 'easy': 1, '1': 1,
    '中级': 2, '中等': 2, 'medium': 2, '2': 2,
    '高级': 3, '进阶': 3, 'hard': 3, '3': 3,
  }

  const moduleAlias: Record<string, string> = {
    'js': 'JS基础', 'javascript': 'JS基础', 'js基础': 'JS基础',
    'react': 'React', 'vue': 'Vue', 'css': 'CSS',
    'ts': 'TypeScript', 'typescript': 'TypeScript',
    '网络': '网络', 'network': '网络', 'http': '网络',
    '性能': '性能优化', 'performance': '性能优化', '性能优化': '性能优化',
    '手写': '手写题', 'algorithm': '手写题', '手写题': '手写题',
    '项目': '项目深挖', 'project': '项目深挖', '项目深挖': '项目深挖',
    'llm': 'LLM基础', 'llm基础': 'LLM基础',
    'prompt': 'Prompt工程', 'prompt工程': 'Prompt工程',
    'agent': 'Agent架构', 'agent架构': 'Agent架构',
    'rag': 'RAG与知识库', 'rag与知识库': 'RAG与知识库',
    'tool': '工具调用与工作流', 'tools': '工具调用与工作流', '工具调用': '工具调用与工作流', '工具调用与工作流': '工具调用与工作流',
    'eval': '评测与线上优化', 'evaluation': '评测与线上优化', '评测优化': '评测与线上优化', '评测与线上优化': '评测与线上优化',
  }

  const idCounters: Record<string, number> = {}

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi]
    if (!block) continue

    const qMatch = block.match(/^##\s+(?:Q:\s*|【.*?】\s*|\d+[.、]\s*)?(.+)/m)
    if (!qMatch) {
      const q2 = block.match(/^###?\s+(.+)/m)
      if (!q2) {
        errors.push(`第 ${bi + 1} 块：未找到题目标题（需以 ## 开头）`)
        continue
      }
    }
    const questionText = (qMatch ?? block.match(/^###?\s+(.+)/m))![1]
      .trim()
      .replace(/^\*+|\*+$/g, '')
      .trim()

    const getField = (key: string) => {
      const re = new RegExp(`\\*\\*${key}\\*\\*[:：]\\s*(.+)`, 'i')
      return block.match(re)?.[1]?.trim() ?? ''
    }

    const rawModule = getField('模块') || getField('module')
    const rawDiff = getField('难度') || getField('difficulty')
    const rawTags = getField('标签') || getField('tags')
    const rawSource = getField('来源') || getField('source')
    const rawId = getField('ID') || getField('id')

    const moduleKey = (rawModule || '').toLowerCase().replace(/\s/g, '')
    const resolvedModule = moduleAlias[moduleKey] ?? rawModule
    if (!resolvedModule) {
      errors.push(`第 ${bi + 1} 块「${questionText.slice(0, 20)}…」：缺少模块字段`)
      continue
    }

    const diffKey = (rawDiff || '').toLowerCase().trim()
    const difficulty = diffMap[rawDiff] ?? diffMap[diffKey] ?? 2

    const tags = rawTags
      ? rawTags.split(/[,，、]/).map((t) => t.trim()).filter(Boolean)
      : []

    let id = rawId
    if (!id) {
      const prefix = resolvedModule
        .toLowerCase()
        .replace('js基础', 'js').replace('性能优化', 'perf').replace('手写题', 'code')
        .replace('项目深挖', 'proj').replace('llm基础', 'llm').replace('prompt工程', 'prompt')
        .replace('agent架构', 'agent').replace('rag与知识库', 'rag')
        .replace('工具调用与工作流', 'tools').replace('评测与线上优化', 'eval')
        .replace(/[^a-z]/g, '').slice(0, 6)
      idCounters[prefix] = (idCounters[prefix] ?? 0) + 1
      id = `${prefix}-${String(idCounters[prefix]).padStart(3, '0')}`
    }

    const answerRaw = block
      .replace(/^##\s+.+/m, '')
      .replace(/^###?\s+.+/m, '')
      .replace(/^\*\*(?:模块|module|难度|difficulty|标签|tags|来源|source|ID|id)\*\*[:：].+$/gim, '')
      .trim()

    if (!answerRaw) {
      errors.push(`第 ${bi + 1} 块「${questionText.slice(0, 20)}…」：答案为空`)
      continue
    }

    questions.push({
      id,
      module: resolvedModule,
      difficulty,
      question: questionText,
      answer: answerRaw,
      tags,
      ...(rawSource ? { source: rawSource } : {}),
    })
  }

  return { questions, errors }
}

// ─── Prompt Builders ───────────────────────────────────────────────────────────

function buildBasePrompt(module: string, count: number, difficulty: string, extra = ''): string {
  return `你是一位资深面试官，精通 ${module} 技术体系。请生成 ${count} 道关于「${module}」的面试题。

## 难度分布
${difficulty}

## 质量要求
- 每道题必须是**真实面试中出现过的考点**，不要编造生僻问题
- 答案要**完整、准确、有深度**，覆盖核心知识点、边界情况和最佳实践
- 答案自由使用 Markdown：代码块、表格、列表、小标题随意用，写得清晰即可
- 代码示例要**可运行、注释清晰**
- 难度梯度合理：初级考基础概念，中级考原理与应用，高级考底层实现与优化

## 内容覆盖
${extra || `覆盖 ${module} 模块的核心知识点，包括基础概念、实际应用、常见陷阱和最佳实践。`}

## 输出格式

**每道题用 \`---\` 分隔，严格按下方模板输出，不要有任何额外说明文字。**

---
## <题目内容，一句话>
**模块**: ${module}
**难度**: 初级 | 中级 | 高级  ← 三选一
**标签**: 标签1, 标签2, 标签3
**来源**: 高频  ← 可选，高频考点填"高频"，大厂题填公司名，否则省略此行

<答案正文，完整 Markdown，可包含代码块、列表、表格等>

---
## <下一题题目>
**模块**: ${module}
...

---

## 示例（仅供格式参考，请生成新内容）

---
## 请解释 JavaScript 中的事件循环机制
**模块**: JS基础
**难度**: 中级
**标签**: 事件循环, 宏任务, 微任务
**来源**: 高频

## 核心概念

JavaScript 是单线程语言，事件循环（Event Loop）是其处理异步操作的核心机制。

### 执行顺序

1. 执行同步代码（调用栈）
2. 清空微任务队列（Promise.then、queueMicrotask）
3. 执行一个宏任务（setTimeout、setInterval、I/O）
4. 重复步骤 2-3

\`\`\`js
console.log('1');
setTimeout(() => console.log('2'), 0);
Promise.resolve().then(() => console.log('3'));
console.log('4');
// 输出：1 4 3 2
\`\`\`

---

现在请生成 ${count} 道题目：`
}

function buildAIAgentPrompt(modules: string[], defaultModule = 'LLM基础', count = 20): string {
  return [
    '你是一位资深 AI Agent 面试官，熟悉大模型应用开发、Prompt Engineering、RAG、Tool Calling、Workflow Orchestration、Agent Evaluation 以及 AI Agent 落地工程实践。请为"AI Agent 岗位"生成高质量中文面试题。',
    '',
    '## 目标岗位',
    '面向以下候选人：',
    '- AI Agent 工程师',
    '- LLM Application Engineer',
    '- AI 产品研发工程师',
    '- RAG / Agent 平台工程师',
    '- 具备应用层大模型落地能力的全栈 / 后端 / AI 工程师',
    '',
    '## 工作方式',
    '- 由于题库规模较大，请**每次只生成一个模块**',
    '- 先输出 **Markdown**',
    '- 等我确认后，我再使用转换器转成 JSON',
    '- 不要一次性生成多个模块，避免内容过长和格式中断',
    '',
    '## 本次可选模块',
    ...modules.map((m) => `- ${m}`),
    '',
    '## 默认任务',
    `如果我没有额外指定，就先从 **${defaultModule}** 模块开始，生成 ${count} 道题。`,
    '',
    '## 难度分布',
    '- 初级：25%',
    '- 中级：50%',
    '- 高级：25%',
    '',
    '## 总体要求',
    '- 题目必须贴近真实面试，不要编造空泛概念题',
    '- 优先考察"理解 + 设计 + 实战 + 排障 + trade-off"',
    '- 不要只问定义，尽量问：',
    '  - 为什么这样设计',
    '  - 什么时候失效',
    '  - 怎么优化',
    '  - 如何定位问题',
    '  - 如何做工程化权衡',
    '- 答案必须完整、准确、结构化，适合面试复习',
    '- 如果有代码示例，优先使用 Python 或 TypeScript',
    '- 不要输出 JSON，只输出 Markdown',
    '',
    '## 各模块考察重点',
    '',
    '### 1. LLM基础',
    '- Transformer / token / context window / temperature / top_p / system prompt',
    '- 幻觉产生原因',
    '- 指令跟随与推理能力差异',
    '- 长上下文的局限',
    '- 模型选型与成本/延迟权衡',
    '',
    '### 2. Prompt工程',
    '- system / user / tool prompt 的职责边界',
    '- prompt 模板设计',
    '- few-shot / structured output / self-consistency',
    '- prompt 注入与越权',
    '- 提示词调优方法论',
    '',
    '### 3. Agent架构',
    '- 单 Agent vs 多 Agent',
    '- Planning / Memory / Reflection / Routing',
    '- ReAct、Plan-and-Execute、Supervisor 等模式',
    '- 状态管理、可恢复性、幂等性',
    '- Agent 失败场景与兜底策略',
    '',
    '### 4. RAG与知识库',
    '- chunk 切分策略',
    '- embedding 与 rerank',
    '- hybrid search',
    '- query rewrite / multi-query / retrieval routing',
    '- 召回率、准确率、上下文污染、知识过期',
    '',
    '### 5. 工具调用与工作流',
    '- function calling / tool calling 设计',
    '- 参数校验、权限控制、超时重试',
    '- workflow 与 agent 的边界',
    '- 外部 API、数据库、搜索引擎、代码执行沙箱的接入',
    '- 可观测性、日志、审计链路',
    '',
    '### 6. 评测与线上优化',
    '- 离线评测与在线评测',
    '- task success rate / latency / token cost / hallucination rate / citation accuracy',
    '- A/B 测试',
    '- failure case 分类',
    '- guardrail、安全、风控、回滚机制',
    '',
    '## 输出格式要求',
    '你必须严格按以下 Markdown 格式输出，每道题之间用三个短横线（---）分隔，不要输出任何额外说明：',
    '',
    '---',
    '## <题目内容，一句话>',
    '**模块**: <从上述 6 个模块中选择 1 个>',
    '**难度**: 初级 | 中级 | 高级',
    '**标签**: 标签1, 标签2, 标签3',
    '**来源**: 高频',
    '',
    '<答案正文，使用完整 Markdown，建议包含：',
    '1. 一句话核心结论',
    '2. 关键原理 / 设计思路',
    '3. 工程实践或示例',
    '4. 常见误区 / 追问点',
    '>',
    '',
    '---',
    '',
    `现在请仅生成一个模块的题目；如果没有额外指定模块，就从 **${defaultModule}** 开始生成 ${count} 道题。`,
  ].join('\n')
}

// ─── Presets ───────────────────────────────────────────────────────────────────

interface PromptPreset {
  id: string
  icon: string
  title: string
  description: string
  prompt: string
}

const PRESETS: PromptPreset[] = [
  {
    id: 'full',
    icon: 'database',
    title: '全量题库生成（推荐）',
    description: '分模块批量生成，覆盖所有方向，生成后用转换器一键转 JSON',
    prompt: `你是一位资深面试官，精通前端技术体系。请为面试刷题系统生成完整题库。

## 任务

分 8 个模块，每个模块生成 60-75 道题，总计约 500-600 道题。

## 模块列表
${BUILTIN_MODULE_VALUES.map((m) => `- ${m}`).join('\n')}

## 难度分布（每个模块内）
- 初级（难度：初级）：占 30%，约 18-22 道
- 中级（难度：中级）：占 50%，约 30-38 道
- 高级（难度：高级）：占 20%，约 12-15 道

## 质量要求
1. **真实性**：所有题目必须是真实面试中出现过的考点
2. **深度**：答案完整、准确，覆盖核心知识点、边界情况和最佳实践
3. **代码**：中高级题目必须包含可运行的代码示例（Markdown 代码块）
4. **多样性**：避免同类题目重复，覆盖每个模块的不同子主题
5. **高频标注**：高频考点的来源填"高频"，大厂题填公司名

## 输出格式

**每道题用 \`---\` 分隔，严格按模板输出，不要有任何额外说明。**

---
## <题目内容>
**模块**: <模块名，从上方列表选>
**难度**: 初级 | 中级 | 高级
**标签**: 标签1, 标签2
**来源**: 高频  ← 可选

<完整答案，自由使用 Markdown：代码块、列表、小标题随意用>

---

由于数量较多，请分模块分批次生成，每次专注一个模块。现在从 **JS基础** 模块开始生成 65 道题：`,
  },
  {
    id: 'module',
    icon: 'list',
    title: '单模块深度生成',
    description: '针对某一模块生成 60-80 道高质量题目，生成后转换器一键转 JSON',
    prompt: buildBasePrompt(
      'JS基础', 70,
      '- 初级：20 道，覆盖基础概念\n- 中级：35 道，覆盖原理与应用\n- 高级：15 道，覆盖底层实现与优化',
      `覆盖以下子主题：
- 变量声明（var/let/const）、作用域、变量提升、TDZ
- 数据类型、类型检测、类型转换（隐式与显式）
- 原型与原型链、继承（原型继承、class 继承）
- this 绑定规则（默认、隐式、显式、new、箭头函数）
- 闭包（原理、应用场景、内存泄漏）
- 事件循环（宏任务、微任务、执行栈）
- Promise（状态、链式调用、错误处理）
- async/await（语法糖、错误处理、并发）
- ES6+（解构、扩展运算符、迭代器、生成器、Symbol、Proxy、Reflect）
- 模块化（CommonJS vs ESM）
- 内存管理（垃圾回收、内存泄漏场景）
- 正则表达式常见用法`,
    ),
  },
  {
    id: 'project',
    icon: 'briefcase',
    title: '项目专题生成',
    description: '根据你的项目技术栈，生成针对性的项目深挖题',
    prompt: `你是一位资深面试官。我将描述我参与的项目，请根据项目技术栈和架构，生成 30 道「项目深挖」类型的面试题。

## 我的项目描述

[在此粘贴你的项目介绍，例如：]
> 参与开发了一个大型电商平台，前端使用 React 18 + TypeScript + Vite，状态管理使用 Zustand。
> 核心功能：商品列表虚拟滚动、购物车实时同步、订单支付流程、后台管理系统。
> 遇到的挑战：首页白屏时间过长（后来通过 SSR 优化到 1.2s）、大量 API 并发的竞态条件问题。

## 生成要求

1. **紧扣项目**：题目必须与项目技术栈强相关
2. **深度追问**：模拟"为什么这样做""遇到什么问题""如何解决"的思路
3. **难度分布**：中级 10 道 / 高级 15 道 / 挑战 5 道
4. **答案要点**：提供面试时的回答要点和亮点

## 输出格式

**每道题用 \`---\` 分隔，严格按模板输出：**

---
## <题目内容>
**模块**: 项目深挖
**难度**: 中级 | 高级
**标签**: 标签1, 标签2
**来源**: 项目深挖

<完整答案>

---

请根据我上面提供的项目信息生成题目：`,
  },
  {
    id: 'company',
    icon: 'building',
    title: '大厂真题还原',
    description: '还原字节、阿里、腾讯等大厂的高频面试题，生成后转换器转 JSON',
    prompt: `你是一位曾在多家大型互联网公司参与面试的资深工程师。请还原真实面试题，生成 60 道高质量面试题。

## 覆盖公司
- 字节跳动（15道）：算法思维、JS 底层原理、大量手写题
- 阿里巴巴/蚂蚁（12道）：工程化、架构设计、稳定性
- 腾讯（12道）：基础扎实、TCP/IP 网络
- 美团（10道）：业务场景、性能优化
- 滴滴（11道）：移动端、跨端开发

## 要求
- 来源字段填写公司名，如"字节"、"阿里"、"腾讯"
- 难度以中高级为主（中级 40%，高级 60%）
- 均匀分布在：JS基础、React、性能优化、网络、CSS、TypeScript、手写题、项目深挖

## 输出格式

**每道题用 \`---\` 分隔，严格按模板输出：**

---
## <题目内容>
**模块**: <模块名>
**难度**: 中级 | 高级
**标签**: 标签1, 标签2
**来源**: 字节 | 阿里 | 腾讯 | 美团 | 滴滴

<完整答案>

---

开始生成：`,
  },
  {
    id: 'algorithm',
    icon: 'code',
    title: '手写题专项',
    description: '生成 50 道高质量手写代码题，含详细实现，生成后转换器转 JSON',
    prompt: buildBasePrompt(
      '手写题', 50,
      '- 初级：10 道，基础 API 实现\n- 中级：25 道，经典工具函数\n- 高级：15 道，复杂数据结构与设计模式',
      `覆盖以下手写题类型：

**工具函数（15道）**
- 防抖（debounce）、节流（throttle）
- 深拷贝（deepClone，处理循环引用、特殊类型）
- 深比较（isEqual）
- 数组去重、扁平化（flat）
- 柯里化（curry）、函数组合（compose/pipe）
- 睡眠函数（sleep）、重试函数（retry）

**原生 API 实现（15道）**
- call、apply、bind
- new 操作符
- instanceof
- Object.create、Object.assign
- Promise（完整实现，含 all/race/allSettled/any）
- Array 方法（map、filter、reduce、flat、forEach）
- JSON.stringify / JSON.parse

**数据结构与算法（10道）**
- LRU 缓存
- 发布订阅（EventEmitter）
- 观察者模式
- 链表操作
- 二叉树遍历

**框架相关（10道）**
- 虚拟 DOM 和 Diff 算法（简版）
- 简版 React（支持函数组件 + useState）
- 简版 Vue 响应式（ref/reactive）
- 前端路由（hash/history 模式）
- 简版 Vuex/Redux

每道手写题的答案必须包含：
1. 完整可运行的代码实现
2. 关键逻辑注释
3. 测试用例
4. 边界情况处理说明`,
    ),
  },
  {
    id: 'ai-agent',
    icon: 'bot',
    title: 'AI Agent 岗位题库生成',
    description: '先输出 Markdown，再用内置转换器转 JSON，适合大批量分模块生成',
    prompt: buildAIAgentPrompt(AI_AGENT_MODULE_VALUES),
  },
]

// ─── Tips ──────────────────────────────────────────────────────────────────────

interface TipItem {
  icon: string
  title: string
  desc: string
}

const TIPS: TipItem[] = [
  { icon: 'clock', title: '分批次生成效果更好', desc: '每次让 AI 专注一个模块，质量比一次性生成所有题目要高很多。建议每次生成 50-80 道题。' },
  { icon: 'refresh', title: '多次生成合并使用', desc: '同一模块可以多次生成，每次用不同 AI 或不同角度，然后合并成更完整的题库。注意 ID 不要重复。' },
  { icon: 'edit', title: '可以让 AI 修改答案', desc: '对某道题的答案不满意，可以直接让 AI 补充、修正，然后手动更新对应 JSON 条目。' },
  { icon: 'target', title: '标注 source 字段', desc: '建议让 AI 将高频题标注 source: "高频"，大厂题标注公司名，方便在题库中快速筛选。' },
  { icon: 'monitor', title: '推荐模型', desc: 'GPT-4o、Claude 3.5/3.7 Sonnet、Gemini 1.5 Pro 的输出质量较好，且能严格遵循 JSON 格式。' },
  { icon: 'warning', title: '验证 JSON 有效性', desc: '粘贴前可先用 jsonlint.com 验证格式，避免导入失败。GrimoireFace 导入页也会自动检测并报告格式错误。' },
]

// ─── State ─────────────────────────────────────────────────────────────────────

const activeTab = ref<'presets' | 'custom'>('presets')
const selectedPreset = ref('full')
const customPrompt = ref<string | null>(null)
const rightTab = ref<'preview' | 'converter'>('preview')

const currentPreset = computed(() => PRESETS.find((p) => p.id === selectedPreset.value))
const displayPrompt = computed(() => activeTab.value === 'custom' ? customPrompt.value : (currentPreset.value?.prompt ?? ''))

// Copy state
const copyBtnCopied = ref(false)
function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    copyBtnCopied.value = true
    setTimeout(() => { copyBtnCopied.value = false }, 2000)
  } catch { /* ignore */ }
}

// Custom builder state
const customModule = ref('JS基础')
const customModuleDropdownOpen = ref(false)
const customCount = ref(60)
const customDiffPreset = ref('standard')
const customExtraContext = ref('')
const moduleInputRef = ref<HTMLInputElement | null>(null)
const moduleDropdownRef = ref<HTMLDivElement | null>(null)

const diffOptions: Record<string, string> = {
  standard: '初级 30% / 中级 50% / 高级 20%（标准）',
  beginner: '初级 60% / 中级 35% / 高级 5%（入门）',
  advanced: '初级 10% / 中级 40% / 高级 50%（进阶）',
  mid: '初级 0% / 中级 60% / 高级 40%（中高级）',
}

const diffDetail: Record<string, string> = {
  standard: `- 初级（difficulty: 1）：${Math.round(60 * 0.3)} 道\n- 中级（difficulty: 2）：${Math.round(60 * 0.5)} 道\n- 高级（difficulty: 3）：${Math.round(60 * 0.2)} 道`,
  beginner: `- 初级（difficulty: 1）：${Math.round(60 * 0.6)} 道\n- 中级（difficulty: 2）：${Math.round(60 * 0.35)} 道\n- 高级（difficulty: 3）：${Math.round(60 * 0.05)} 道`,
  advanced: `- 初级（difficulty: 1）：${Math.round(60 * 0.1)} 道\n- 中级（difficulty: 2）：${Math.round(60 * 0.4)} 道\n- 高级（difficulty: 3）：${Math.round(60 * 0.5)} 道`,
  mid: `- 初级（difficulty: 1）：0 道\n- 中级（difficulty: 2）：${Math.round(60 * 0.6)} 道\n- 高级（difficulty: 3）：${Math.round(60 * 0.4)} 道`,
}

const filteredModules = computed(() =>
  MODULE_SUGGESTIONS.filter((m) => m.toLowerCase().includes(customModule.value.toLowerCase())),
)

function handleCustomGenerate() {
  const count = customCount.value
  const detail = diffDetail[customDiffPreset.value]
    .replace(/（difficulty: \d）/g, '')
    .replace(/difficulty: \d,\s*/g, '')
  const prompt = buildBasePrompt(customModule.value, count, detail, customExtraContext.value)
  customPrompt.value = prompt
}

// Click outside to close dropdown
function handleOutsideClick(e: MouseEvent) {
  if (!customModuleDropdownOpen.value) return
  if (
    !moduleInputRef.value?.contains(e.target as Node) &&
    !moduleDropdownRef.value?.contains(e.target as Node)
  ) {
    customModuleDropdownOpen.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', handleOutsideClick))
onUnmounted(() => document.removeEventListener('mousedown', handleOutsideClick))

// MD Converter state
const mdInput = ref('')
const mdResult = ref<{ json: string; count: number; errors: string[] } | null>(null)
const mdCopied = ref(false)
const mdFileInputRef = ref<HTMLInputElement | null>(null)

function handleMdFileImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    const text = ev.target?.result
    if (typeof text === 'string') {
      mdInput.value = text
      mdResult.value = null
      mdCopied.value = false
    }
  }
  reader.readAsText(file, 'utf-8')
  ;(e.target as HTMLInputElement).value = ''
}

function handleConvert() {
  if (!mdInput.value.trim()) return
  const { questions, errors } = mdToQuestions(mdInput.value)
  mdResult.value = {
    json: JSON.stringify(questions, null, 2),
    count: questions.length,
    errors,
  }
  mdCopied.value = false
}

function handleMdCopy() {
  if (!mdResult.value) return
  navigator.clipboard.writeText(mdResult.value.json).then(() => {
    mdCopied.value = true
    setTimeout(() => { mdCopied.value = false }, 2000)
  })
}

function handleMdDownload() {
  if (!mdResult.value) return
  const blob = new Blob([mdResult.value.json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `questions-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="page-container prompt-page">
    <!-- Header -->
    <RouterLink to="/tools" class="back-link" style="margin-bottom:16px">← 返回工具</RouterLink>
    <div style="margin-bottom: 24px">
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px">
        <div>
          <h1 style="font-size: 20px; font-weight: 700; color: var(--text); letter-spacing: -0.02em; margin-bottom: 6px">
            AI 出题 Prompt
          </h1>
          <p style="font-size: 13px; color: var(--text-2)">
            复制提示词，交给 AI 生成符合格式的题目，然后粘贴到「导入题目」页面
          </p>
        </div>
        <span class="badge badge-primary" style="flex-shrink: 0; margin-top: 4px">推荐总量：500-600 题</span>
      </div>
    </div>

    <!-- Two-column layout -->
    <div class="prompt-layout">
      <!-- Left: Preset selector -->
      <div class="left-panel">
        <!-- Tab switcher -->
        <div class="tab-bar">
          <button
            type="button"
            class="tab-btn"
            :class="{ active: activeTab === 'presets' }"
            @click="activeTab = 'presets'"
          >预设 Prompt</button>
          <button
            type="button"
            class="tab-btn"
            :class="{ active: activeTab === 'custom' }"
            @click="activeTab = 'custom'"
          >自定义构建</button>
        </div>

        <!-- Presets list -->
        <div v-if="activeTab === 'presets'" class="presets-list">
          <button
            v-for="preset in PRESETS"
            :key="preset.id"
            type="button"
            class="preset-card"
            :class="{ selected: selectedPreset === preset.id }"
            @click="selectedPreset = preset.id"
          >
            <span class="preset-icon" :class="{ 'icon-selected': selectedPreset === preset.id }">
              <!-- database -->
              <svg v-if="preset.icon === 'database'" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
              <!-- list -->
              <svg v-else-if="preset.icon === 'list'" viewBox="0 0 24 24" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              <!-- briefcase -->
              <svg v-else-if="preset.icon === 'briefcase'" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
              <!-- building -->
              <svg v-else-if="preset.icon === 'building'" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M16 2v20"/><path d="M8 6h2"/><path d="M8 10h2"/><path d="M8 14h2"/><path d="M18 6h.01"/><path d="M18 10h.01"/><path d="M18 14h.01"/></svg>
              <!-- code -->
              <svg v-else-if="preset.icon === 'code'" viewBox="0 0 24 24" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              <!-- bot -->
              <svg v-else-if="preset.icon === 'bot'" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><path d="M8 16h.01"/><path d="M16 16h.01"/><path d="M7 3h10"/></svg>
            </span>
            <span class="preset-content">
              <strong>{{ preset.title }}</strong>
              <span>{{ preset.description }}</span>
            </span>
            <span v-if="selectedPreset === preset.id" class="preset-check">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
          </button>
        </div>

        <!-- Custom builder -->
        <div v-else class="card" style="padding: 16px">
          <div class="custom-builder">
            <div class="custom-row">
              <!-- Module -->
              <div class="custom-field" style="position: relative">
                <label for="prompt-builder-module" style="display:block;font-size:11px;font-weight:500;color:var(--text-2);margin-bottom:6px">
                  模块<span style="margin-left:5px;font-size:10px;color:var(--text-3);font-weight:400">（可自由输入，如 Golang、Java）</span>
                </label>
                <div style="position:relative">
                  <input
                    id="prompt-builder-module"
                    ref="moduleInputRef"
                    v-model="customModule"
                    type="text"
                    placeholder="输入或选择模块名…"
                    class="custom-input"
                    :class="{ focused: customModuleDropdownOpen }"
                    @focus="customModuleDropdownOpen = true"
                    @input="customModuleDropdownOpen = true"
                  />
                  <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round"
                    class="dropdown-chevron"
                    :class="{ open: customModuleDropdownOpen }"
                  ><polyline points="6 9 12 15 18 9"/></svg>

                  <div
                    v-if="customModuleDropdownOpen && filteredModules.length > 0"
                    ref="moduleDropdownRef"
                    class="module-dropdown"
                  >
                    <button
                      v-for="m in filteredModules"
                      :key="m"
                      type="button"
                      class="module-dropdown-item"
                      :class="{ active: m === customModule }"
                      @mousedown.prevent="customModule = m; customModuleDropdownOpen = false"
                    >{{ m }}</button>
                  </div>
                </div>
              </div>

              <!-- Count -->
              <div class="custom-field">
                <label for="prompt-builder-count" style="display:block;font-size:11px;font-weight:500;color:var(--text-2);margin-bottom:6px">
                  题目数量：<span style="color:var(--primary);font-weight:600">{{ customCount }} 道</span>
                </label>
                <input
                  id="prompt-builder-count"
                  v-model.number="customCount"
                  type="range"
                  min="20" max="100" step="5"
                  class="count-slider"
                />
                <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-3);margin-top:2px">
                  <span>20</span><span>60</span><span>100</span>
                </div>
              </div>
            </div>

            <!-- Difficulty -->
            <div>
              <div style="display:block;font-size:11px;font-weight:500;color:var(--text-2);margin-bottom:8px">难度分布</div>
              <div class="diff-grid">
                <button
                  v-for="(label, key) in diffOptions"
                  :key="key"
                  type="button"
                  class="diff-btn"
                  :class="{ active: customDiffPreset === key }"
                  @click="customDiffPreset = key"
                >{{ label }}</button>
              </div>
            </div>

            <!-- Extra context -->
            <div>
              <label for="prompt-builder-extra" style="display:block;font-size:11px;font-weight:500;color:var(--text-2);margin-bottom:6px">补充说明（可选）</label>
              <textarea
                id="prompt-builder-extra"
                v-model="customExtraContext"
                placeholder="例如：重点覆盖 React Hooks 原理，包含大量代码题；或：针对 2024 年面试热点…"
                rows="3"
                class="extra-textarea"
              />
            </div>

            <button type="button" class="generate-btn" @click="handleCustomGenerate">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              生成自定义 Prompt
            </button>
          </div>
        </div>
      </div>

      <!-- Right: Preview / Converter -->
      <div class="right-panel">
        <!-- Right tab switcher -->
        <div class="tab-bar" style="margin-bottom: 12px">
          <button
            type="button"
            class="tab-btn"
            :class="{ active: rightTab === 'preview' }"
            @click="rightTab = 'preview'"
          >Prompt 预览</button>
          <button
            type="button"
            class="tab-btn"
            :class="{ active: rightTab === 'converter' }"
            @click="rightTab = 'converter'"
          >MD → JSON 转换器</button>
        </div>

        <!-- Converter tab -->
        <div v-if="rightTab === 'converter'" class="converter-panel">
          <div class="converter-header">
            <div>
              <p style="font-size:13px;font-weight:600;color:var(--text)">Markdown → JSON 转换器</p>
              <p style="font-size:12px;color:var(--text-3);margin-top:2px">将 AI 输出的 Markdown 题目粘贴或导入文件，转换后复制 JSON 导入题库</p>
            </div>
          </div>

          <div class="converter-cols">
            <!-- Input -->
            <div class="converter-col">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <span style="font-size:12px;font-weight:500;color:var(--text-2)">AI 输出（Markdown）</span>
                <div style="display:flex;align-items:center;gap:6px">
                  <input
                    ref="mdFileInputRef"
                    type="file"
                    accept=".md,.markdown,text/markdown"
                    style="display:none"
                    @change="handleMdFileImport"
                  />
                  <button type="button" class="import-md-btn" @click="mdFileInputRef?.click()">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                    导入 .md
                  </button>
                  <button v-if="mdInput" type="button" class="clear-btn" @click="mdInput = ''; mdResult = null">清空</button>
                </div>
              </div>
              <textarea
                v-model="mdInput"
                placeholder="粘贴 AI 生成的 Markdown，格式如：

---
## 请解释闭包的概念
**模块**: JS基础
**难度**: 中级
**标签**: 闭包, 作用域

闭包是指函数能够访问其词法作用域外部变量的特性...

---
## 下一道题..."
                class="md-textarea"
              />
              <button
                type="button"
                class="convert-btn"
                :disabled="!mdInput.trim()"
                @click="handleConvert"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                转换为 JSON
              </button>
            </div>

            <!-- Output -->
            <div class="converter-col">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <span style="font-size:12px;font-weight:500;color:var(--text-2)">
                  JSON 结果
                  <span v-if="mdResult" class="result-count">{{ mdResult.count }} 道题</span>
                </span>
                <div v-if="mdResult" style="display:flex;gap:6px">
                  <button type="button" class="md-copy-btn" :class="{ copied: mdCopied }" @click="handleMdCopy">
                    {{ mdCopied ? '✓ 已复制' : '复制 JSON' }}
                  </button>
                  <button type="button" class="md-download-btn" @click="handleMdDownload">下载</button>
                </div>
              </div>

              <template v-if="mdResult">
                <div v-if="mdResult.errors.length > 0" class="convert-errors">
                  <p style="font-weight:600;margin-bottom:4px">⚠️ {{ mdResult.errors.length }} 个解析警告</p>
                  <p v-for="e in mdResult.errors" :key="e" style="opacity:0.85;line-height:1.5">{{ e }}</p>
                </div>
                <pre class="json-output">{{ mdResult.json }}</pre>
                <a href="/import" class="goto-import-btn">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  前往导入题库
                </a>
              </template>
              <div v-else class="json-empty">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                <p style="font-size:12px">在左侧粘贴 AI 输出后点击「转换为 JSON」</p>
              </div>
            </div>
          </div>

          <!-- Format guide -->
          <div class="format-guide">
            <p style="font-weight:600;color:var(--text);margin-bottom:6px">📋 Markdown 格式说明</p>
            <div class="format-guide-grid">
              <span>• 每题以 <code>---</code> 分隔</span>
              <span>• 题目以 <code>## 题目内容</code> 开头</span>
              <span>• <strong>模块</strong> 字段自动映射（js/react/css/ts/网络/性能/手写/项目）</span>
              <span>• <strong>难度</strong> 支持：初级/中级/高级</span>
              <span>• <strong>标签</strong> 用逗号或顿号分隔</span>
              <span>• <strong>来源</strong> 可选，如"高频"、"字节"</span>
              <span>• ID 未填时自动生成（模块前缀-序号）</span>
              <span>• 答案为 meta 字段之后的所有 Markdown 内容</span>
            </div>
          </div>
        </div>

        <!-- Preview tab -->
        <div v-else class="preview-panel">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:13px;font-weight:600;color:var(--text)">
                {{ activeTab === 'custom' ? (customPrompt ? '自定义 Prompt' : '请在左侧配置并生成') : currentPreset?.title }}
              </span>
              <span v-if="displayPrompt" class="char-count">{{ displayPrompt.length }} 字符</span>
            </div>
          </div>

          <div v-if="displayPrompt" class="prompt-preview-wrap">
            <pre class="prompt-preview">{{ displayPrompt }}</pre>
            <div class="floating-copy">
              <button type="button" class="copy-btn" :class="{ copied: copyBtnCopied }" @click="copyText(displayPrompt!)">
                <template v-if="copyBtnCopied">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  已复制
                </template>
                <template v-else>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  复制
                </template>
              </button>
            </div>
          </div>
          <div v-else class="preview-empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-3);margin:0 auto 12px;opacity:0.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <p style="font-size:13px;color:var(--text-3)">在左侧配置参数后点击「生成自定义 Prompt」</p>
          </div>

          <!-- Usage guide -->
          <div v-if="displayPrompt" class="usage-guide">
            <p style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:10px">使用步骤</p>
            <ol class="steps-list">
              <li><span class="step-num">1</span><span>复制 Prompt，粘贴到 GPT-4o / Claude / Gemini 等 AI</span></li>
              <li><span class="step-num">2</span><span>AI 生成 Markdown 格式题目（比 JSON 更稳定，少出错）</span></li>
              <li><span class="step-num">3</span><span>复制 AI 输出，切换到「MD → JSON 转换器」粘贴转换</span></li>
              <li><span class="step-num">4</span><span>复制转换后的 JSON，前往「导入题目」页面一键导入</span></li>
            </ol>
          </div>
        </div>
      </div>
    </div>

    <!-- Tips -->
    <div style="margin-top: 32px">
      <p class="section-label">使用技巧</p>
      <div class="tips-grid">
        <div v-for="tip in TIPS" :key="tip.title" class="card tip-card">
          <span class="tip-icon">
            <!-- clock -->
            <svg v-if="tip.icon === 'clock'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <!-- refresh -->
            <svg v-else-if="tip.icon === 'refresh'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/></svg>
            <!-- edit -->
            <svg v-else-if="tip.icon === 'edit'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <!-- target -->
            <svg v-else-if="tip.icon === 'target'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <!-- monitor -->
            <svg v-else-if="tip.icon === 'monitor'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            <!-- warning -->
            <svg v-else-if="tip.icon === 'warning'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </span>
          <div>
            <p class="tip-title">{{ tip.title }}</p>
            <p class="tip-desc">{{ tip.desc }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Recommended scale -->
    <div style="margin-top: 20px">
      <div class="card" style="padding: 20px">
        <h2 style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:16px">推荐题库规模</h2>
        <div style="overflow-x:auto">
          <table class="scale-table">
            <thead>
              <tr>
                <th>目标</th><th>题目数量</th><th>生成策略</th><th>预计用时</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="[target, count, strategy, time] in [
                ['快速入门', '100-200 题', '全量生成 Prompt 运行一次', '15 分钟'],
                ['覆盖全面', '500-600 题', '按模块分批生成，每模块 60-75 题', '1-2 小时'],
                ['深度备战', '800-1000 题', '全量 + 大厂真题 + 手写题专项', '3-4 小时'],
                ['超全题库', '1500+ 题', '多 AI 多轮次生成 + 去重合并', '1 天'],
              ]" :key="target as string">
                <td class="scale-target">{{ target }}</td>
                <td><span class="scale-count">{{ count }}</span></td>
                <td class="scale-strategy">{{ strategy }}</td>
                <td class="scale-time">{{ time }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p style="font-size:12px;color:var(--text-3);margin-top:12px;line-height:1.6">
          推荐从「覆盖全面」开始，500-600 题已足够覆盖 95% 的面试考点。超过 800 题后边际收益递减，建议重点放在薄弱点的深度理解。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.prompt-page {
  max-width: 1100px;
}

/* Badge */
.badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.5;
}
.badge-primary {
  background: var(--primary-light);
  color: var(--primary);
  border: 1px solid rgba(var(--primary-rgb), 0.2);
}

/* Tab bar */
.tab-bar {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--surface-2);
  border-radius: 12px;
}
.tab-btn {
  flex: 1;
  padding: 6px 12px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-2);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s;
}
.tab-btn.active {
  font-weight: 500;
  color: var(--text);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}

/* Layout */
.prompt-layout {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  gap: 20px;
  align-items: start;
}

.right-panel {
  position: sticky;
  top: calc(var(--navbar-h) + 20px);
}

/* Preset cards */
.presets-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.preset-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  text-align: left;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  cursor: pointer;
  box-shadow: var(--shadow-xs);
  color: var(--text);
  font-family: inherit;
}
.preset-card:hover {
  border-color: var(--border);
  background: var(--surface-2);
}
.preset-card.selected {
  border-color: rgba(var(--primary-rgb), 0.5);
  background: var(--primary-light);
  box-shadow: none;
}
.preset-icon {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--surface-3);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-3);
  transition: background 0.15s, color 0.15s;
}
.preset-icon svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.preset-icon.icon-selected {
  background: rgba(var(--primary-rgb), 0.12);
  color: var(--primary);
}
.preset-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.preset-content strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  transition: color 0.15s;
}
.preset-card.selected .preset-content strong {
  color: var(--primary);
}
.preset-content > span:last-child {
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.5;
}
.preset-check {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}

/* Card */
.card {
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  background: var(--surface);
}

/* Custom builder */
.custom-builder {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.custom-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.custom-field {
  display: flex;
  flex-direction: column;
}
.custom-input {
  width: 100%;
  padding: 7px 30px 7px 10px;
  border-radius: 10px;
  font-size: var(--control-font-size);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: none;
  color: var(--text);
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.custom-input.focused {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-light);
}
.dropdown-chevron {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  transition: transform 0.15s;
  pointer-events: none;
}
.dropdown-chevron.open {
  transform: translateY(-50%) rotate(180deg);
}
.module-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 200;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.12));
  overflow: hidden;
  max-height: 220px;
  overflow-y: auto;
}
.module-dropdown-item {
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.1s;
  font-family: inherit;
}
.module-dropdown-item:hover {
  background: var(--surface-2);
}
.module-dropdown-item.active {
  color: var(--primary);
  background: var(--primary-light);
}

.count-slider {
  width: 100%;
  accent-color: var(--primary);
  cursor: pointer;
  margin-top: 4px;
}

.diff-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.diff-btn {
  padding: 7px 10px;
  border-radius: 9px;
  font-size: 11px;
  text-align: left;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-2);
  font-weight: 400;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.diff-btn.active {
  border-color: rgba(var(--primary-rgb), 0.5);
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 500;
}

.extra-textarea {
  width: 100%;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: var(--control-font-size);
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  resize: none;
  outline: none;
  font-family: var(--font-sans);
  line-height: 1.6;
}

.generate-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 0;
  border-radius: 9px;
  border: none;
  background: var(--primary);
  color: white;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
  font-family: inherit;
}
.generate-btn:hover {
  opacity: 0.9;
}

/* Preview */
.prompt-preview-wrap {
  position: relative;
}
.prompt-preview {
  font-size: 12px;
  font-family: var(--font-mono);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  padding: 16px;
  overflow: auto;
  max-height: 60dvh;
  color: var(--text);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
.floating-copy {
  position: absolute;
  top: 10px;
  right: 10px;
}
.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  cursor: pointer;
  transition: all 0.18s;
  white-space: nowrap;
  font-family: inherit;
}
.copy-btn.copied {
  border-color: rgba(16,185,129,0.3);
  background: rgba(16,185,129,0.08);
  color: var(--success);
}

.char-count {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--surface-3);
  color: var(--text-3);
  border: 1px solid var(--border-subtle);
}

.preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  background: var(--surface);
}

/* Usage guide */
.usage-guide {
  padding: 14px 16px;
  border: 1px solid rgba(var(--primary-rgb), 0.2);
  border-radius: 14px;
  background: var(--primary-light);
  margin-top: 10px;
}
.steps-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
}
.steps-list li {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--text-2);
  list-style: none;
  line-height: 1.6;
}
.step-num {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  margin-top: 1px;
}

/* Converter */
.converter-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.converter-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  align-items: start;
}
.import-md-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--primary);
  background: none;
  border: 1px solid rgba(var(--primary-rgb), 0.3);
  border-radius: 6px;
  cursor: pointer;
  padding: 3px 8px;
  transition: all 0.15s;
  font-family: inherit;
}
.import-md-btn:hover {
  background: var(--primary-light);
}
.clear-btn {
  font-size: 11px;
  color: var(--text-3);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  font-family: inherit;
}
.md-textarea {
  width: 100%;
  min-height: 360px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: var(--control-font-size);
  font-family: var(--font-mono);
  line-height: 1.6;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}
.md-textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-light);
}
.convert-btn {
  padding: 9px 0;
  border-radius: 9px;
  border: none;
  background: var(--primary);
  color: white;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: inherit;
}
.convert-btn:disabled {
  background: var(--surface-3);
  color: var(--text-3);
  cursor: default;
}
.result-count {
  margin-left: 8px;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--success-light);
  color: var(--success);
  border: 1px solid rgba(16,185,129,0.2);
}
.md-copy-btn {
  font-size: 11px;
  color: var(--primary);
  background: var(--primary-light);
  border: none;
  border-radius: 5px;
  padding: 3px 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
  font-family: inherit;
}
.md-copy-btn.copied {
  color: var(--success);
  background: var(--success-light);
}
.md-download-btn {
  font-size: 11px;
  color: var(--text-2);
  background: var(--surface-3);
  border: none;
  border-radius: 5px;
  padding: 3px 8px;
  cursor: pointer;
  font-family: inherit;
}
.convert-errors {
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--warning-light);
  border: 1px solid rgba(245,158,11,0.25);
  font-size: 11px;
  color: #92400e;
  margin-bottom: 8px;
}
.json-output {
  min-height: 360px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--surface-2);
  color: var(--text);
  font-size: 11px;
  font-family: var(--font-mono);
  line-height: 1.6;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0 0 8px 0;
}
.goto-import-btn {
  padding: 9px 0;
  border-radius: 9px;
  background: var(--success);
  color: white;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: opacity 0.15s;
}
.goto-import-btn:hover {
  opacity: 0.88;
}
.json-empty {
  min-height: 360px;
  border-radius: 10px;
  border: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-3);
  padding: 24px;
  text-align: center;
}

.format-guide {
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.6;
}
.format-guide-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 24px;
}
.format-guide-grid code {
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--surface-3);
}

/* Section label */
.section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 12px;
}

/* Tips */
.tips-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.tip-card {
  padding: 14px 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.tip-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--surface-3);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-2);
}
.tip-icon svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.tip-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}
.tip-desc {
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.6;
}

/* Scale table */
.scale-table {
  width: 100%;
  border-collapse: collapse;
}
.scale-table th {
  text-align: left;
  padding-bottom: 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  padding-right: 16px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.scale-table td {
  padding: 10px 16px 10px 0;
}
.scale-table tr {
  border-bottom: 1px solid var(--border-subtle);
}
.scale-target {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.scale-count {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 5px;
  background: var(--primary-light);
  color: var(--primary);
  border: 1px solid rgba(var(--primary-rgb),0.2);
  white-space: nowrap;
}
.scale-strategy {
  font-size: 12px;
  color: var(--text-2);
}
.scale-time {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  padding-right: 0;
}

/* Responsive */
@media (max-width: 768px) {
  .prompt-layout {
    grid-template-columns: 1fr;
  }
  .tips-grid {
    grid-template-columns: 1fr 1fr;
  }
  .converter-cols {
    grid-template-columns: 1fr;
  }
  .format-guide-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 480px) {
  .tips-grid {
    grid-template-columns: 1fr;
  }
}
</style>
