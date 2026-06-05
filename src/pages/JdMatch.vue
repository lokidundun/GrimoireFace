<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useAIStore } from "@/stores/useAIStore";
import MarkdownRenderer from "@/components/ui/MarkdownRenderer.vue";
import SettingsDrawer from "@/components/layout/SettingsDrawer.vue";
import { useBufferedText } from "@/composables/useBufferedText";
import {
  type ChatCompletionMessage,
  requestChatCompletionStream,
} from "@/lib/aiClient";
import {
  deleteJdMatchReport,
  getAllJdMatchReports,
  putJdMatchReport,
} from "@/lib/db";
import { parseResumeFile } from "@/lib/resumeParser";
import type { JdMatchReport } from "@/types";

// ─── Constants ─────────────────────────────────────────────────────

const DEFAULT_ROLE = "前端工程师";
const REPORT_SECTION_TITLES = new Set([
  "总体判断",
  "匹配点",
  "风险点",
  "缺失关键词",
  "可能追问",
  "准备建议",
]);

function formatDateTime(timestamp?: number): string {
  if (!timestamp) return "未保存";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function extractGeneratedTitle(markdown: string, roleTitle: string): string {
  const titleLine = markdown.split("\n").find(isGeneratedTitleLine);
  const title = titleLine ? normalizeGeneratedTitle(titleLine) : "";
  if (title) return title.slice(0, 32);
  return `${roleTitle || DEFAULT_ROLE} · JD 诊断`;
}

function stripGeneratedTitle(markdown: string): string {
  const lines = markdown.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (
    firstContentIndex === -1 ||
    !isGeneratedTitleLine(lines[firstContentIndex])
  ) {
    return markdown.trim();
  }
  return [
    ...lines.slice(0, firstContentIndex),
    ...lines.slice(firstContentIndex + 1),
  ]
    .join("\n")
    .trim();
}

function isGeneratedTitleLine(line: string): boolean {
  const trimmed = line.trim();
  const cleaned = normalizeGeneratedTitle(trimmed);
  if (!cleaned) return false;
  if (/^#{0,6}\s*\*{0,2}标题[:：]/.test(trimmed)) return true;
  return /^#{1,6}\s+/.test(trimmed) && !REPORT_SECTION_TITLES.has(cleaned);
}

function normalizeGeneratedTitle(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*+|\*+$/g, "")
    .replace(/^标题[:：]\s*/, "")
    .replace(/[*#`]/g, "")
    .trim();
}

function buildJdMatchMessages(input: {
  roleTitle: string;
  jdText: string;
  resumeText: string;
}): ChatCompletionMessage[] {
  return [
    {
      role: "system",
      content: `你是 GrimoireFace 的中文技术招聘顾问，负责做简历与岗位 JD 的面试前匹配诊断。
要求：
- 只基于用户提供的 JD 和简历判断，不要编造候选人经历。
- 结论要具体，可直接用于准备面试。
- 语气克制、专业，不要写客套话。
- 风险点要指出面试中可能被质疑的原因。
- 追问要像真实面试官会问的问题。`,
    },
    {
      role: "user",
      content: `请诊断下面候选人与目标岗位的匹配度。

目标岗位：${input.roleTitle || DEFAULT_ROLE}

请用 Markdown 输出，并严格包含这些部分：
标题：用 12 个字以内生成本次诊断标题

## 总体判断
给出 1 段结论，并给出 0-100 的匹配分。

## 匹配点
列出 4-6 条，说明 JD 需求与简历证据如何对应。

## 风险点
列出 3-5 条，说明哪些地方可能被面试官追问或质疑。

## 缺失关键词
列出简历里缺少或不够突出的 JD 关键词，并说明是否需要补充。

## 可能追问
列出 6-8 个真实面试追问，优先围绕项目真实性、技术深度、岗位关键要求。

## 准备建议
给出 3-5 条下一步准备动作。

<JD>
${input.jdText}
</JD>

<简历>
${input.resumeText}
</简历>`,
    },
  ];
}

// ─── State ────────────────────────────────────────────────────────

const { config } = useAIStore();

const fileRef = ref<HTMLInputElement | null>(null);
const roleTitle = ref(DEFAULT_ROLE);
const jdText = ref("");
const resumeText = ref("");
const resumeFileName = ref<string | null>(null);
const resumeMessage = ref<string | null>(null);
const report = ref("");
const savedReports = ref<JdMatchReport[]>([]);
const activeReportId = ref<string | null>(null);
const { text: streamingText, appendText, resetText } = useBufferedText();
const error = ref<string | null>(null);
const settingsOpen = ref(false);
const parsingResume = ref(false);
const analyzing = ref(false);

const aiReady = computed(
  () => config.enabled && config.apiKey.trim().length > 0
);
const displayReport = computed(() => streamingText.value || report.value);

// ─── Lifecycle ─────────────────────────────────────────────────────

onMounted(async () => {
  const loaded = await getAllJdMatchReports();
  savedReports.value = loaded;
});

// ─── Actions ───────────────────────────────────────────────────────

async function handleResumeFile(file: File) {
  parsingResume.value = true;
  resumeMessage.value = null;
  error.value = null;
  try {
    const parsed = await parseResumeFile(file);
    resumeText.value = parsed.text;
    resumeFileName.value = parsed.fileName;
    resumeMessage.value = parsed.warning ?? `已解析 ${parsed.fileName}`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "简历解析失败";
  } finally {
    parsingResume.value = false;
    if (fileRef.value) fileRef.value.value = "";
  }
}

async function handleAnalyze() {
  if (!aiReady.value) {
    error.value = "请先在设置中启用 AI 并配置 API Key";
    return;
  }
  if (!jdText.value.trim()) {
    error.value = "请粘贴岗位 JD";
    return;
  }
  if (!resumeText.value.trim()) {
    error.value = "请上传或粘贴简历文本";
    return;
  }

  analyzing.value = true;
  error.value = null;
  report.value = "";
  resetText("");

  try {
    const result = await requestChatCompletionStream({
      config: {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        temperature: Math.min(0.7, Math.max(0.2, config.temperature)),
        maxTokens: 2400,
      },
      messages: buildJdMatchMessages({
        roleTitle: roleTitle.value.trim() || DEFAULT_ROLE,
        jdText: jdText.value.trim(),
        resumeText: resumeText.value.trim(),
      }),
      onDelta: appendText,
    });
    const markdown = stripGeneratedTitle(result);
    const now = Date.now();
    const nextReport: JdMatchReport = {
      id: crypto.randomUUID(),
      title: extractGeneratedTitle(
        result,
        roleTitle.value.trim() || DEFAULT_ROLE
      ),
      roleTitle: roleTitle.value.trim() || DEFAULT_ROLE,
      jdText: jdText.value.trim(),
      resumeText: resumeText.value.trim(),
      resumeFileName: resumeFileName.value ?? undefined,
      markdown,
      model: config.model,
      createdAt: now,
      updatedAt: now,
    };

    await putJdMatchReport(nextReport);
    savedReports.value = [nextReport, ...savedReports.value].sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
    activeReportId.value = nextReport.id;
    report.value = markdown;
    resetText("");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "生成诊断失败";
  } finally {
    analyzing.value = false;
  }
}

function handleSelectReport(item: JdMatchReport) {
  roleTitle.value = item.roleTitle;
  jdText.value = item.jdText;
  resumeText.value = item.resumeText;
  resumeFileName.value = item.resumeFileName ?? null;
  resumeMessage.value = null;
  report.value = item.markdown;
  resetText("");
  error.value = null;
  activeReportId.value = item.id;
}

async function handleDeleteReport(id: string) {
  await deleteJdMatchReport(id);
  savedReports.value = savedReports.value.filter((item) => item.id !== id);
  if (activeReportId.value === id) {
    activeReportId.value = null;
    report.value = "";
  }
}

function handleNewDiagnosis() {
  roleTitle.value = DEFAULT_ROLE;
  jdText.value = "";
  resumeText.value = "";
  resumeFileName.value = null;
  resumeMessage.value = null;
  report.value = "";
  resetText("");
  error.value = null;
  activeReportId.value = null;
}

async function handleCopyReport() {
  if (!displayReport.value) return;
  await navigator.clipboard.writeText(displayReport.value);
}
</script>

<template>
  <div class="page-container jd-match-page">
    <div class="animate-fade-in" style="margin-bottom: 28px">
      <h1
        style="
          font-size: 20px;
          font-weight: 700;
          color: var(--text);
          letter-spacing: -0.015em;
          margin-bottom: 4px;
        "
      >
        简历 JD 诊断
      </h1>
      <p style="font-size: 13px; color: var(--text-3)">
        对照目标岗位，找出简历里的匹配点、风险点和可能追问
      </p>
    </div>

    <div v-if="error" class="jd-alert">{{ error }}</div>

    <div class="jd-layout">
      <!-- Sidebar -->
      <aside class="jd-sidebar">
        <section class="jd-panel">
          <div class="jd-panel-header">
            <h2>诊断材料</h2>
            <span
              class="ai-tool-badge"
              :class="
                aiReady ? 'ai-tool-badge-success' : 'ai-tool-badge-warning'
              "
              >{{ aiReady ? config.model : "AI 未配置" }}</span
            >
          </div>

          <div class="jd-form">
            <label>
              <span>目标岗位</span>
              <input v-model="roleTitle" placeholder="例如：前端工程师" />
            </label>

            <div class="jd-field">
              <span>岗位 JD</span>
              <textarea
                v-model="jdText"
                placeholder="粘贴岗位职责、任职要求、技术栈关键词..."
                class="jd-textarea"
              />
            </div>

            <div>
              <div class="jd-file-row">
                <span>简历</span>
                <small>{{ resumeFileName ?? "支持 PDF、DOCX、TXT、MD" }}</small>
              </div>
              <input
                ref="fileRef"
                type="file"
                accept=".pdf,.docx,.txt,.md,text/plain,text/markdown,application/pdf"
                style="display: none"
                @change="(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleResumeFile(f) }"
              />
              <div class="jd-actions-row">
                <button
                  type="button"
                  class="jd-btn jd-btn-secondary-sm"
                  :disabled="parsingResume"
                  @click="fileRef?.click()"
                >
                  <svg
                    v-if="parsingResume"
                    class="jd-spinner"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      stroke-width="3"
                      opacity="0.2"
                    />
                    <path
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"
                      opacity="0.8"
                    />
                  </svg>
                  上传解析
                </button>
                <button
                  v-if="resumeText"
                  type="button"
                  class="jd-btn jd-btn-ghost-sm"
                  @click="
                    resumeText = '';
                    resumeFileName = null;
                    resumeMessage = null;
                  "
                >
                  清空
                </button>
              </div>
              <p v-if="resumeMessage" class="jd-resume-message">
                {{ resumeMessage }}
              </p>
              <textarea
                v-model="resumeText"
                placeholder="也可以直接粘贴简历文本..."
                class="jd-textarea"
              />
            </div>

            <div class="jd-submit-row">
              <button
                type="button"
                class="jd-btn jd-btn-ghost"
                @click="handleNewDiagnosis"
              >
                新诊断
              </button>
              <button
                v-if="!aiReady"
                type="button"
                class="jd-btn jd-btn-secondary"
                @click="settingsOpen = true"
              >
                配置 AI
              </button>
              <button
                type="button"
                class="jd-btn jd-btn-primary"
                :disabled="!jdText.trim() || !resumeText.trim() || analyzing"
                @click="handleAnalyze"
              >
                <svg
                  v-if="analyzing"
                  class="jd-spinner"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="3"
                    opacity="0.2"
                  />
                  <path
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"
                    opacity="0.8"
                  />
                </svg>
                生成诊断
              </button>
            </div>
          </div>
        </section>

        <section class="jd-panel">
          <div class="jd-panel-header">
            <h2>历史记录</h2>
            <span>{{ savedReports.length }}</span>
          </div>

          <div class="jd-history-list">
            <p v-if="savedReports.length === 0" class="jd-history-empty">
              暂无诊断记录
            </p>
            <div
              v-for="item in savedReports"
              :key="item.id"
              class="jd-history-item"
              :data-active="activeReportId === item.id"
            >
              <button
                type="button"
                :disabled="analyzing"
                @click="handleSelectReport(item)"
              >
                <strong>{{ item.title }}</strong>
                <span
                  >{{ item.roleTitle }} ·
                  {{ formatDateTime(item.updatedAt) }}</span
                >
              </button>
              <button
                type="button"
                :aria-label="`删除 ${item.title}`"
                :disabled="analyzing"
                @click="handleDeleteReport(item.id)"
              >
                删除
              </button>
            </div>
          </div>
        </section>
      </aside>

      <!-- Report -->
      <section class="jd-panel jd-report-panel">
        <div class="jd-panel-header">
          <h2>诊断结果</h2>
          <button
            v-if="displayReport"
            type="button"
            class="jd-btn jd-btn-ghost-sm"
            @click="handleCopyReport"
          >
            复制
          </button>
        </div>

        <output
          v-if="analyzing && !streamingText"
          class="jd-busy"
          aria-live="polite"
        >
          <svg class="jd-spinner" viewBox="0 0 24 24" fill="none">
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="3"
              opacity="0.2"
            />
            <path
              fill="currentColor"
              d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"
              opacity="0.8"
            />
          </svg>
          <span>正在分析简历与 JD...</span>
        </output>

        <MarkdownRenderer
          v-if="displayReport"
          :content="displayReport"
          class="jd-markdown"
        />

        <div v-if="!displayReport && !analyzing" class="jd-empty">
          <h2>等待诊断</h2>
          <p>填入 JD 和简历后生成匹配报告。</p>
        </div>
      </section>
    </div>

    <SettingsDrawer :open="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>

<style scoped>
.jd-match-page {
  max-width: 1100px;
}

.jd-layout {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.jd-sidebar {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.jd-panel {
  min-width: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  padding: 16px;
}

.jd-report-panel {
  min-height: 620px;
}

.jd-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.jd-panel-header h2 {
  font-size: 15px;
  line-height: 1.3;
  font-weight: 700;
  color: var(--text);
}

.jd-panel-header span {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-3);
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
  flex-shrink: 0;
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
.jd-form {
  display: grid;
  gap: 14px;
}

.jd-form label,
.jd-field {
  display: grid;
  gap: 7px;
}

.jd-form label > span,
.jd-field > span,
.jd-file-row > span {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.jd-form input {
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

.jd-textarea {
  width: 100%;
  min-height: 140px;
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

.jd-file-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.jd-file-row small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-3);
}

.jd-actions-row,
.jd-submit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.jd-actions-row {
  margin-bottom: 8px;
}

.jd-submit-row {
  justify-content: flex-end;
  border-top: 1px solid var(--border-subtle);
  padding-top: 14px;
}

.jd-resume-message {
  margin-bottom: 8px;
  font-size: 11px;
  color: var(--text-3);
}

/* Buttons */
.jd-btn {
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

.jd-btn:disabled {
  opacity: 0.5;
  pointer-events: none;
}

.jd-btn-primary {
  font-size: 14px;
  height: 36px;
  padding: 8px 16px;
  background: var(--primary);
  border-color: var(--primary);
  color: white;
  box-shadow: var(--shadow-md);
}

.jd-btn-primary:hover {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
}

.jd-btn-secondary {
  font-size: 14px;
  height: 36px;
  padding: 8px 16px;
  background: var(--surface);
  border-color: var(--border);
  color: var(--text);
}

.jd-btn-secondary:hover {
  background: var(--surface-2);
}

.jd-btn-secondary-sm {
  font-size: 12px;
  height: 28px;
  padding: 6px 12px;
  background: var(--surface);
  border-color: var(--border);
  color: var(--text);
}

.jd-btn-secondary-sm:hover {
  background: var(--surface-2);
}

.jd-btn-ghost {
  font-size: 14px;
  height: 36px;
  padding: 8px 16px;
  background: transparent;
  border-color: transparent;
  color: var(--text-2);
}

.jd-btn-ghost:hover {
  background: var(--surface-2);
  color: var(--text);
}

.jd-btn-ghost-sm {
  font-size: 12px;
  height: 28px;
  padding: 6px 12px;
  background: transparent;
  border-color: transparent;
  color: var(--text-2);
}

.jd-btn-ghost-sm:hover {
  background: var(--surface-2);
  color: var(--text);
}

/* Spinner */
.jd-spinner {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  animation: jd-spin 1s linear infinite;
}

@keyframes jd-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Alert */
.jd-alert {
  border: 1px solid rgba(239, 68, 68, 0.22);
  background: var(--danger-light);
  color: var(--danger);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  margin-bottom: 16px;
}

/* Busy */
.jd-busy {
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

/* Empty */
.jd-empty {
  min-height: 420px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
  color: var(--text-3);
}

.jd-empty h2 {
  font-size: 18px;
  color: var(--text);
}

.jd-empty p {
  font-size: 13px;
}

/* Markdown */
.jd-markdown :deep(*) {
  font-size: 14px;
  color: var(--text);
  overflow-wrap: anywhere;
}

/* History */
.jd-history-list {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.jd-history-empty {
  font-size: 12px;
  color: var(--text-3);
}

.jd-history-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-2);
  padding: 9px;
}

.jd-history-item[data-active="true"] {
  border-color: rgba(var(--primary-rgb), 0.32);
  background: var(--primary-light);
}

.jd-history-item button {
  border: none;
  background: transparent;
  cursor: pointer;
}

.jd-history-item button:first-child {
  min-width: 0;
  text-align: left;
  color: var(--text);
}

.jd-history-item button:last-child {
  color: var(--text-3);
  font-size: 11px;
  padding: 4px;
}

.jd-history-item strong,
.jd-history-item span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.jd-history-item strong {
  font-size: 12px;
  color: var(--text);
}

.jd-history-item span {
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-3);
}

@media (max-width: 920px) {
  .jd-layout {
    grid-template-columns: 1fr;
  }

  .jd-report-panel {
    min-height: 420px;
  }
}
</style>
