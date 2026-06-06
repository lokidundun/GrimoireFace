<script setup lang="ts">
import { ref, watch, onUnmounted, nextTick, computed } from "vue";
import { invalidateQuestionsCache } from "@/composables/useQuestions";
import {
  type BuiltinCategory,
  type CategoryMap,
  DEFAULT_CATEGORY_MAP,
  exportAllData,
  getAllJdMatchReports,
  getAllMockInterviews,
  getAllQuestionAnswerAnnotations,
  getAllQuestionAnswerOverrides,
  getAllQuestionFlags,
  getAllQuestionNotes,
  getAllQuestions,
  getAllStudyRecords,
  getBuiltinCategories,
  getCategoryMap,
  META_KEYS,
  resetDatabase,
  saveBuiltinCategories,
  saveCategoryMap,
  setMeta,
  getCustomSources,
  bulkPutQuestions,
  bulkPutStudyRecords,
  bulkPutQuestionNotes,
  bulkPutQuestionAnswerAnnotations,
  bulkPutQuestionAnswerOverrides,
  bulkPutQuestionFlags,
  bulkPutMockInterviews,
  bulkPutJdMatchReports,
  moveModuleToCategory,
  reorderCategories,
  deleteCategory,
  renameCategory,
} from "@/lib/db";
import {
  deleteBackupGist,
  pullFromGist,
  pushToGist,
  type SyncResult,
} from "@/lib/gistSync";
import {
  countMergedAISessions,
  mergeCategoryMaps,
  parseImportPreview,
  type ImportPreview,
  type ImportImpactItem,
} from "@/lib/localBackup";
import { buildChatCompletionsUrl } from "@/lib/aiClient";
import {
  importBuiltinCategoryFile,
  loadAllBuiltinModulesParallel,
} from "@/lib/questionLoader";
import {
  AI_PROVIDER_PRESETS,
  type AIConfig,
  type AIProviderId,
  DEFAULT_AI_CONFIG,
  getAIProviderPreset,
  useAIStore,
} from "@/stores/useAIStore";
import { useAuthStore } from "@/stores/useAuthStore";
import {
  DAILY_GOAL_DEFAULT,
  DAILY_GOAL_MAX,
  DAILY_GOAL_MIN,
  type StudyMode,
  useStudyStore,
} from "@/stores/useStudyStore";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const aiStore = useAIStore();
const studyStore = useStudyStore();
const authStore = useAuthStore();

type Tab = "auth" | "model" | "ai" | "study" | "data" | "sync";
const tab = ref<Tab>("auth");

const localConfig = ref<AIConfig>({ ...aiStore.config });
const isDirty = ref(false);
const saved = ref(false);

// ─── Auth tab state ───────────────────────────────────────────────────────────
const apiKeyInputs = ref<Record<string, string>>({});
const showApiKeyInput = ref<Record<string, boolean>>({});
const providerSearchQuery = ref("");
const toast = ref<{
  message: string;
  type: "success" | "error" | "info";
} | null>(null);
const confirmReset = ref<"records" | "all" | null>(null);
const dataStats = ref<{
  questions: number;
  records: number;
  notes: number;
  answerAnnotations: number;
  answerOverrides: number;
  starred: number;
  aiSessions: number;
  mockInterviews: number;
  jdMatchReports: number;
} | null>(null);
const importing = ref(false);
const importPreview = ref<ImportPreview | null>(null);
const exporting = ref(false);
const testing = ref(false);
const testResult = ref<{ ok: boolean; message: string } | null>(null);
const syncPushing = ref(false);
const syncPulling = ref(false);
const syncDeleting = ref(false);
const lastSyncResult = ref<{
  ok: boolean;
  message: string;
  at?: string;
} | null>(null);
const autoSynced = ref(false);
const categoryMap = ref<CategoryMap>({ ...DEFAULT_CATEGORY_MAP });

// ─── Category management state ────────────────────────────────────────────────
const expandedCategories = ref<Set<string>>(new Set());
const editingCategory = ref<string | null>(null);
const editName = ref("");
const addingCategory = ref(false);
const newCategoryName = ref("");
const allModules = ref<string[]>([]);

// ─── Built-in category management state ───────────────────────────────────────
const builtinCategories = ref<BuiltinCategory[]>([]);
const expandedBuiltinCategories = ref<Set<string>>(new Set());
const editingBuiltinCategory = ref<string | null>(null);
const editBuiltinName = ref("");
const editBuiltinFiles = ref<string[]>([]);
const addingBuiltinCategory = ref(false);
const newBuiltinCategoryName = ref("");
const newBuiltinCategoryFiles = ref("");
const builtinReloading = ref(false);

const importRef = ref<HTMLInputElement | null>(null);
const drawerRef = ref<HTMLDivElement | null>(null);
let lastFocusedEl: HTMLElement | null = null;

// Load category map when drawer opens
watch(
  () => props.open,
  (open) => {
    if (open) {
      getCategoryMap().then((m) => {
        categoryMap.value = m;
      });
      getBuiltinCategories().then((c) => {
        builtinCategories.value = c;
      });
      localConfig.value = { ...aiStore.config };
      isDirty.value = false;
      saved.value = false;
    }
  }
);

// Load data stats when data tab opens
watch([() => props.open, tab], () => {
  if (!props.open || tab.value !== "data") return;
  Promise.all([
    getAllQuestions(),
    getAllStudyRecords(),
    getAllQuestionNotes(),
    getAllQuestionAnswerAnnotations(),
    getAllQuestionAnswerOverrides(),
    getAllQuestionFlags(),
    getAllMockInterviews(),
    getAllJdMatchReports(),
  ]).then(
    ([
      questions,
      records,
      notes,
      annotations,
      overrides,
      flags,
      interviews,
      jdReports,
    ]) => {
      dataStats.value = {
        questions: questions.length,
        records: records.length,
        notes: notes.length,
        answerAnnotations: annotations.length,
        answerOverrides: overrides.length,
        starred: flags.filter((f) => f.starred).length,
        aiSessions: Object.keys(aiStore.sessions).length,
        mockInterviews: interviews.length,
        jdMatchReports: jdReports.length,
      };
    }
  );
});

// Auto-pull from Gist once per session
watch(
  [() => props.open, () => authStore.isLoggedIn, () => authStore.token],
  () => {
    if (
      !props.open ||
      !authStore.isLoggedIn ||
      !authStore.token ||
      autoSynced.value
    )
      return;
    autoSynced.value = true;
    (async () => {
      try {
        const result = await pullFromGist(
          authStore.token!,
          Object.values(aiStore.sessions)
        );
        if (result === null) return;
        if (result.ok) {
          invalidateQuestionsCache();
          if (result.aiSessions?.length)
            aiStore.upsertSessions(result.aiSessions);
          lastSyncResult.value = {
            ok: true,
            message: `已自动同步 ${result.recordCount ?? 0} 条记录`,
            at: result.exportedAt,
          };
        } else {
          lastSyncResult.value = {
            ok: false,
            message: `同步失败：${result.error ?? "未知错误"}`,
          };
        }
      } catch (err) {
        lastSyncResult.value = {
          ok: false,
          message: `同步失败：${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    })();
  }
);

// Keyboard & scroll lock
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    lastFocusedEl =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    nextTick(() => {
      drawerRef.value?.focus({ preventScroll: true } as any);
    });

    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") emit("close");
    }
    window.addEventListener("keydown", onEsc);

    onUnmounted(() => {
      window.removeEventListener("keydown", onEsc);
      document.body.style.overflow = prevOverflow;
      if (lastFocusedEl?.isConnected)
        lastFocusedEl.focus({ preventScroll: true } as any);
    });
  }
);

function showToast(
  message: string,
  type: "success" | "error" | "info" = "success"
) {
  toast.value = { message, type };
  setTimeout(() => {
    toast.value = null;
  }, 2800);
}

// ─── Auth Tab Actions ─────────────────────────────────────────────────────────

function toggleApiKeyInput(providerId: string) {
  showApiKeyInput.value = {
    ...showApiKeyInput.value,
    [providerId]: !showApiKeyInput.value[providerId],
  };
}

function submitApiKey(providerId: AIProviderId) {
  const key = apiKeyInputs.value[providerId];
  if (key?.trim()) {
    aiStore.setProviderApiKey(providerId, key.trim());
    apiKeyInputs.value = { ...apiKeyInputs.value, [providerId]: "" };
    showApiKeyInput.value = { ...showApiKeyInput.value, [providerId]: false };
    // 如果 AI 未启用，自动启用
    if (!aiStore.config.enabled) {
      aiStore.updateConfig({ enabled: true });
      localConfig.value = { ...localConfig.value, enabled: true };
    }
    showToast(`${getAIProviderPreset(providerId).shortLabel} API Key 已保存`);
  }
}

function handleRemoveAuth(providerId: AIProviderId) {
  aiStore.removeProviderAuth(providerId);
  showToast(`${getAIProviderPreset(providerId).shortLabel} 认证已删除`);
}

const filteredProviders = computed(() => {
  const query = providerSearchQuery.value.toLowerCase().trim();
  const list = AI_PROVIDER_PRESETS.filter((p) => p.id !== "custom");
  if (!query) return list;
  return list.filter(
    (p) =>
      p.label.toLowerCase().includes(query) ||
      p.id.toLowerCase().includes(query) ||
      p.shortLabel.toLowerCase().includes(query)
  );
});

// ─── Model Tab Actions ────────────────────────────────────────────────────────

function handleSelectModel(providerId: AIProviderId, modelValue: string) {
  aiStore.updateConfig({ provider: providerId, model: modelValue });
  showToast(
    `已切换到 ${getAIProviderPreset(providerId).shortLabel} · ${modelValue}`
  );
}

// ─── AI Config Tab Actions (system prompt, enabled) ───────────────────────────

function patch(partial: Partial<AIConfig>) {
  const next = { ...localConfig.value, ...partial };
  localConfig.value = next;
  isDirty.value = true;
  saved.value = false;
}

function handleSaveAIConfig() {
  aiStore.updateConfig({
    systemPrompt: localConfig.value.systemPrompt,
    enabled: localConfig.value.enabled,
    baseUrl: localConfig.value.baseUrl,
    model: localConfig.value.model,
  });
  isDirty.value = false;
  saved.value = true;
  showToast("设置已保存 ✓");
  setTimeout(() => {
    saved.value = false;
  }, 2000);
}

function handleResetAIConfig() {
  localConfig.value = { ...DEFAULT_AI_CONFIG };
  aiStore.resetConfig();
  isDirty.value = false;
  showToast("已恢复默认设置");
}

async function handleTest() {
  const provider = aiStore.config.provider;
  const apiKey = aiStore
    .getProviderApiKey(provider)
    .replace(/[^\x20-\x7E]/g, "");
  const preset = getAIProviderPreset(provider);
  if (!apiKey) {
    testResult.value = {
      ok: false,
      message: `请先在设置中为 ${preset.label} 配置 API Key`,
    };
    return;
  }

  const baseUrl =
    provider === "custom" ? aiStore.config.baseUrl : preset.baseUrl;
  if (provider === "custom" && !baseUrl.trim()) {
    testResult.value = {
      ok: false,
      message: "自定义接口需要填写 Base URL",
    };
    return;
  }

  testing.value = true;
  testResult.value = null;
  try {
    const response = await fetch(buildChatCompletionsUrl(baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: aiStore.config.model,
        messages: [{ role: "user", content: "Hi, reply with exactly: OK" }],
        max_tokens: 10,
        stream: false,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      let errMsg = `HTTP ${response.status}`;
      try {
        errMsg = JSON.parse(errText)?.error?.message ?? errMsg;
      } catch {}
      testResult.value = { ok: false, message: errMsg };
    } else {
      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content ?? "（无内容）";
      testResult.value = {
        ok: true,
        message: `连接成功！模型回复：${reply.slice(0, 60)}`,
      };
    }
  } catch (err) {
    testResult.value = {
      ok: false,
      message: err instanceof Error ? err.message : "网络错误",
    };
  } finally {
    testing.value = false;
  }
}

// ─── Data actions ───────────────────────────────────────────────────────────────

async function handleExport() {
  exporting.value = true;
  try {
    const data = await exportAllData();
    const aiSessions = Object.values(aiStore.sessions);
    const backup = { ...data, aiSessions };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grimoireface-backup-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(
      `已导出 ${data.questions.length} 题、${data.studyRecords.length} 条记录、${data.questionNotes.length} 条笔记`
    );
  } catch {
    showToast("导出失败，请重试", "error");
  } finally {
    exporting.value = false;
  }
}

function countImportImpact<T>(
  incoming: T[],
  existingIds: Set<string>,
  getId: (item: T) => string
): ImportImpactItem {
  return incoming.reduce<ImportImpactItem>(
    (acc, item) => {
      if (existingIds.has(getId(item))) acc.overwritten++;
      else acc.created++;
      return acc;
    },
    { created: 0, overwritten: 0 }
  );
}

async function withImportImpact(
  preview: ImportPreview
): Promise<ImportPreview> {
  const [
    questions,
    records,
    notes,
    annotations,
    overrides,
    flags,
    interviews,
    jdReports,
  ] = await Promise.all([
    getAllQuestions(),
    getAllStudyRecords(),
    getAllQuestionNotes(),
    getAllQuestionAnswerAnnotations(),
    getAllQuestionAnswerOverrides(),
    getAllQuestionFlags(),
    getAllMockInterviews(),
    getAllJdMatchReports(),
  ]);
  return {
    ...preview,
    impact: {
      questions: countImportImpact(
        preview.questions,
        new Set(questions.map((q) => q.id)),
        (q) => q.id
      ),
      studyRecords: countImportImpact(
        preview.studyRecords,
        new Set(records.map((r) => r.questionId)),
        (r) => r.questionId
      ),
      questionNotes: countImportImpact(
        preview.questionNotes,
        new Set(notes.map((n) => n.questionId)),
        (n) => n.questionId
      ),
      questionAnswerAnnotations: countImportImpact(
        preview.questionAnswerAnnotations,
        new Set(annotations.map((a) => a.id)),
        (a) => a.id
      ),
      questionAnswerOverrides: countImportImpact(
        preview.questionAnswerOverrides,
        new Set(overrides.map((o) => o.questionId)),
        (o) => o.questionId
      ),
      questionFlags: countImportImpact(
        preview.questionFlags,
        new Set(flags.map((f) => f.questionId)),
        (f) => f.questionId
      ),
      aiSessions: countImportImpact(
        preview.aiSessions,
        new Set(Object.keys(aiStore.sessions)),
        (s) => s.questionId
      ),
      mockInterviews: countImportImpact(
        preview.mockInterviews,
        new Set(interviews.map((s) => s.id)),
        (s) => s.id
      ),
      jdMatchReports: countImportImpact(
        preview.jdMatchReports,
        new Set(jdReports.map((r) => r.id)),
        (r) => r.id
      ),
    },
  };
}

async function handleImport(file: File) {
  importing.value = true;
  importPreview.value = null;
  try {
    const text = await file.text();
    const preview = parseImportPreview(file.name, text);
    importPreview.value = await withImportImpact(preview);
    showToast("已解析备份，请确认后导入", "info");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "文件解析失败", "error");
  } finally {
    importing.value = false;
    if (importRef.value) importRef.value.value = "";
  }
}

async function handleConfirmImport() {
  if (!importPreview.value) return;
  importing.value = true;
  try {
    const p = importPreview.value;
    if (p.questions.length > 0) {
      await bulkPutQuestions(p.questions);
      invalidateQuestionsCache();
    }
    if (p.customSources.length > 0) {
      const currentSources = await getCustomSources();
      await setMeta(META_KEYS.CUSTOM_SOURCES, [
        ...new Set([...currentSources, ...p.customSources]),
      ]);
    }
    if (Object.keys(p.customCategories).length > 0) {
      const currentMap = await getCategoryMap();
      await saveCategoryMap(mergeCategoryMaps(currentMap, p.customCategories));
    }
    if (p.studyRecords.length > 0) await bulkPutStudyRecords(p.studyRecords);
    if (p.questionNotes.length > 0) await bulkPutQuestionNotes(p.questionNotes);
    if (p.questionAnswerAnnotations.length > 0)
      await bulkPutQuestionAnswerAnnotations(p.questionAnswerAnnotations);
    if (p.questionAnswerOverrides.length > 0)
      await bulkPutQuestionAnswerOverrides(p.questionAnswerOverrides);
    if (p.questionFlags.length > 0) await bulkPutQuestionFlags(p.questionFlags);
    if (p.aiSessions.length > 0) aiStore.upsertSessions(p.aiSessions);
    if (p.mockInterviews.length > 0)
      await bulkPutMockInterviews(p.mockInterviews);
    if (p.jdMatchReports.length > 0)
      await bulkPutJdMatchReports(p.jdMatchReports);

    const starredCount = p.questionFlags.filter((f) => f.starred).length;
    showToast(
      `导入成功：${p.questions.length} 题、${p.studyRecords.length} 条记录、${p.questionNotes.length} 条笔记、${starredCount} 个重点题、${p.aiSessions.length} 个 AI 会话`
    );
    importPreview.value = null;

    const [
      questions,
      records,
      notes,
      annotations,
      overrides,
      flags,
      interviews,
      jdReports,
    ] = await Promise.all([
      getAllQuestions(),
      getAllStudyRecords(),
      getAllQuestionNotes(),
      getAllQuestionAnswerAnnotations(),
      getAllQuestionAnswerOverrides(),
      getAllQuestionFlags(),
      getAllMockInterviews(),
      getAllJdMatchReports(),
    ]);
    dataStats.value = {
      questions: questions.length,
      records: records.length,
      notes: notes.length,
      answerAnnotations: annotations.length,
      answerOverrides: overrides.length,
      starred: flags.filter((f) => f.starred).length,
      aiSessions: countMergedAISessions(aiStore.sessions, p.aiSessions),
      mockInterviews: interviews.length,
      jdMatchReports: jdReports.length,
    };
  } catch (err) {
    showToast(err instanceof Error ? err.message : "导入失败，请重试", "error");
  } finally {
    importing.value = false;
  }
}

async function handleResetConfirm() {
  if (!confirmReset.value) return;
  try {
    if (confirmReset.value === "records") {
      await studyStore.resetAll();
      if (dataStats.value) dataStats.value = { ...dataStats.value, records: 0 };
      showToast("学习记录已清空");
    } else {
      await resetDatabase();
      await studyStore.resetAll();
      aiStore.clearAllSessions();
      dataStats.value = {
        questions: 0,
        records: 0,
        notes: 0,
        answerAnnotations: 0,
        answerOverrides: 0,
        starred: 0,
        aiSessions: 0,
        mockInterviews: 0,
        jdMatchReports: 0,
      };
      showToast("所有数据已重置");
    }
  } catch {
    showToast("操作失败，请重试", "error");
  } finally {
    confirmReset.value = null;
  }
}

// ─── Sync actions ───────────────────────────────────────────────────────────────

function formatSyncSummary(result: SyncResult): string {
  const parts = [
    result.mergedRemoteRecordCount
      ? `${result.mergedRemoteRecordCount.toLocaleString()} 条学习记录`
      : null,
    result.mergedRemoteNoteCount
      ? `${result.mergedRemoteNoteCount.toLocaleString()} 条笔记`
      : null,
    result.mergedRemoteQuestionFlagCount
      ? `${result.mergedRemoteQuestionFlagCount.toLocaleString()} 个重点标记`
      : null,
    result.mergedRemoteAISessionCount
      ? `${result.mergedRemoteAISessionCount.toLocaleString()} 个 AI 会话`
      : null,
    result.mergedRemoteQuestionCount
      ? `${result.mergedRemoteQuestionCount.toLocaleString()} 道自定义题`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? `，并保留云端较新的 ${parts.join("、")}` : "";
}

async function handleSyncPush() {
  if (!authStore.token) return;
  syncPushing.value = true;
  try {
    const result = await pushToGist(
      authStore.token,
      Object.values(aiStore.sessions)
    );
    if (result.ok) {
      lastSyncResult.value = {
        ok: true,
        message: `已上传 ${result.recordCount ?? 0} 条记录、${
          result.questionCount ?? 0
        } 道题、${result.noteCount ?? 0} 条笔记${formatSyncSummary(result)}`,
        at: result.exportedAt,
      };
      showToast("同步上传成功");
    } else {
      lastSyncResult.value = {
        ok: false,
        message: result.error ?? "同步上传失败",
      };
      showToast(result.error ?? "同步上传失败", "error");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastSyncResult.value = { ok: false, message: msg };
    showToast(msg, "error");
  } finally {
    syncPushing.value = false;
  }
}

async function handleSyncPull() {
  if (!authStore.token) return;
  syncPulling.value = true;
  try {
    const result = await pullFromGist(
      authStore.token,
      Object.values(aiStore.sessions)
    );
    if (result === null) {
      showToast("没有找到云端备份", "info");
      return;
    }
    if (result.ok) {
      invalidateQuestionsCache();
      if (result.aiSessions?.length) aiStore.upsertSessions(result.aiSessions);
      lastSyncResult.value = {
        ok: true,
        message: `已拉取 ${result.recordCount ?? 0} 条记录、${
          result.questionCount ?? 0
        } 道题、${result.noteCount ?? 0} 条笔记${formatSyncSummary(result)}`,
        at: result.exportedAt,
      };
      showToast("同步拉取成功");
    } else {
      lastSyncResult.value = {
        ok: false,
        message: result.error ?? "同步拉取失败",
      };
      showToast(result.error ?? "同步拉取失败", "error");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastSyncResult.value = { ok: false, message: msg };
    showToast(msg, "error");
  } finally {
    syncPulling.value = false;
  }
}

async function handleSyncDelete() {
  if (!authStore.token) return;
  syncDeleting.value = true;
  try {
    const result = await deleteBackupGist(authStore.token);
    if (result.ok) {
      lastSyncResult.value = null;
      showToast("云端备份已删除");
    } else {
      showToast(result.error ?? "删除失败", "error");
    }
  } catch (err) {
    showToast(err instanceof Error ? err.message : "删除失败", "error");
  } finally {
    syncDeleting.value = false;
  }
}

function formatBackupTime(value?: string): string {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ─── Category management helpers ──────────────────────────────────────────────

async function refreshCategoryMap() {
  const map = await getCategoryMap();
  categoryMap.value = map;
}

async function loadAllModules() {
  const questions = await getAllQuestions();
  allModules.value = [...new Set(questions.map((q) => q.module))];
}

function toggleExpand(name: string) {
  const next = new Set(expandedCategories.value);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }
  expandedCategories.value = next;
}

async function handleAddCategory() {
  const name = newCategoryName.value.trim();
  if (!name) {
    showToast("请输入分类名称", "error");
    return;
  }
  const map = await getCategoryMap();
  if (map[name]) {
    showToast("分类名称已存在", "error");
    return;
  }
  map[name] = {
    name,
    modules: [],
    builtin: false,
    order: Object.keys(map).length,
  };
  await saveCategoryMap(map);
  categoryMap.value = map;
  addingCategory.value = false;
  newCategoryName.value = "";
  showToast(`分类「${name}」已添加`);
}

function handleStartEdit(name: string) {
  editingCategory.value = name;
  editName.value = name;
}

function handleCancelEdit() {
  editingCategory.value = null;
  editName.value = "";
}

async function handleConfirmEdit(oldName: string) {
  const newName = editName.value.trim();
  if (!newName) {
    showToast("分类名称不能为空", "error");
    return;
  }
  if (newName === oldName) {
    editingCategory.value = null;
    return;
  }
  try {
    await renameCategory(oldName, newName);
    // Sync hidden categories key if needed
    if (studyStore.hiddenCategories.has(oldName)) {
      const next = new Set(studyStore.hiddenCategories);
      next.delete(oldName);
      next.add(newName);
      studyStore.hiddenCategories = next;
    }
    // Update expanded state
    if (expandedCategories.value.has(oldName)) {
      const next = new Set(expandedCategories.value);
      next.delete(oldName);
      next.add(newName);
      expandedCategories.value = next;
    }
    await refreshCategoryMap();
    editingCategory.value = null;
    editName.value = "";
    showToast("分类已重命名");
  } catch {
    showToast("重命名失败", "error");
  }
}

async function handleDeleteCategory(name: string) {
  const entry = categoryMap.value[name];
  if (!entry) return;
  if (entry.modules.length > 0) {
    showToast("请先移出该分类下的所有模块", "error");
    return;
  }
  if (!confirm(`确定要删除分类「${name}」吗？`)) return;
  try {
    await deleteCategory(name);
    // Remove from hidden categories if present
    if (studyStore.hiddenCategories.has(name)) {
      studyStore.hiddenCategories.delete(name);
    }
    // Remove from expanded state
    expandedCategories.value.delete(name);
    await refreshCategoryMap();
    showToast("分类已删除");
  } catch {
    showToast("删除失败", "error");
  }
}

async function handleMoveCategoryUp(name: string) {
  const entries = categoryEntries.value;
  const idx = entries.findIndex((e) => e.name === name);
  if (idx <= 0) return;
  const newOrder = [...entries];
  const temp = newOrder[idx];
  newOrder[idx] = newOrder[idx - 1];
  newOrder[idx - 1] = temp;
  try {
    await reorderCategories(newOrder.map((e) => e.name));
    await refreshCategoryMap();
    showToast("顺序已调整");
  } catch {
    showToast("调整失败", "error");
  }
}

async function handleMoveCategoryDown(name: string) {
  const entries = categoryEntries.value;
  const idx = entries.findIndex((e) => e.name === name);
  if (idx === -1 || idx >= entries.length - 1) return;
  const newOrder = [...entries];
  const temp = newOrder[idx];
  newOrder[idx] = newOrder[idx + 1];
  newOrder[idx + 1] = temp;
  try {
    await reorderCategories(newOrder.map((e) => e.name));
    await refreshCategoryMap();
    showToast("顺序已调整");
  } catch {
    showToast("调整失败", "error");
  }
}

async function handleMoveModule(
  moduleName: string,
  fromCategory: string,
  toCategory: string
) {
  if (fromCategory === toCategory) return;
  try {
    await moveModuleToCategory(moduleName, fromCategory, toCategory);
    invalidateQuestionsCache();
    await refreshCategoryMap();
    await loadAllModules();
    showToast(`模块「${moduleName}」已移动到「${toCategory}」`);
  } catch {
    showToast("移动失败", "error");
  }
}

// ─── Built-in category management helpers ─────────────────────────────────────

async function refreshBuiltinCategories() {
  builtinCategories.value = await getBuiltinCategories();
}

function toggleExpandBuiltin(name: string) {
  const next = new Set(expandedBuiltinCategories.value);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }
  expandedBuiltinCategories.value = next;
}

async function handleAddBuiltinCategory() {
  const name = newBuiltinCategoryName.value.trim();
  const files = newBuiltinCategoryFiles.value
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  if (!name) {
    showToast("请输入分类名称", "error");
    return;
  }
  const current = await getBuiltinCategories();
  if (current.some((c) => c.category === name)) {
    showToast("分类名称已存在", "error");
    return;
  }
  await saveBuiltinCategories([...current, { category: name, files }]);
  // Sync to categoryMap so the empty category shows up in Practice page
  const map = await getCategoryMap();
  if (!map[name]) {
    map[name] = {
      name,
      modules: [],
      builtin: false,
      order: Object.keys(map).length,
    };
    await saveCategoryMap(map);
  }
  await refreshBuiltinCategories();
  addingBuiltinCategory.value = false;
  newBuiltinCategoryName.value = "";
  newBuiltinCategoryFiles.value = "";
  showToast(`分类「${name}」已添加，可上传 JSON 文件或配置远程路径`);
}

function handleStartEditBuiltinCategory(name: string) {
  const cat = builtinCategories.value.find((c) => c.category === name);
  if (!cat) return;
  editingBuiltinCategory.value = name;
  editBuiltinName.value = name;
  editBuiltinFiles.value = [...cat.files];
}

function handleCancelEditBuiltinCategory() {
  editingBuiltinCategory.value = null;
  editBuiltinName.value = "";
  editBuiltinFiles.value = [];
}

async function handleConfirmEditBuiltinCategory(oldName: string) {
  const name = editBuiltinName.value.trim();
  const files = editBuiltinFiles.value.map((f) => f.trim()).filter(Boolean);
  if (!name) {
    showToast("分类名称不能为空", "error");
    return;
  }
  const current = await getBuiltinCategories();
  const idx = current.findIndex((c) => c.category === oldName);
  if (idx === -1) {
    showToast("分类不存在", "error");
    return;
  }
  if (name !== oldName && current.some((c) => c.category === name)) {
    showToast("新名称已存在", "error");
    return;
  }
  current[idx] = { category: name, files };
  await saveBuiltinCategories([...current]);
  // Sync name change to categoryMap
  if (name !== oldName) {
    const map = await getCategoryMap();
    if (map[oldName]) {
      map[name] = { ...map[oldName], name };
      delete map[oldName];
      await saveCategoryMap(map);
    }
  }
  await refreshBuiltinCategories();
  editingBuiltinCategory.value = null;
  editBuiltinName.value = "";
  editBuiltinFiles.value = [];
  showToast(`分类「${oldName}」已更新`);
}

async function handleDeleteBuiltinCategory(name: string) {
  if (!confirm(`确定删除分类「${name}」？对应的题目和分类映射将被移除。`))
    return;
  const current = await getBuiltinCategories();
  const filtered = current.filter((c) => c.category !== name);
  await saveBuiltinCategories(filtered);
  // Also remove from categoryMap
  const map = await getCategoryMap();
  if (map[name]) {
    delete map[name];
    await saveCategoryMap(map);
  }
  await refreshBuiltinCategories();
  showToast(`分类「${name}」已删除`);
}

async function handleRemoveBuiltinFile(
  categoryName: string,
  fileIndex: number
) {
  const current = await getBuiltinCategories();
  const cat = current.find((c) => c.category === categoryName);
  if (!cat) return;
  cat.files.splice(fileIndex, 1);
  if (cat.files.length === 0) {
    showToast("分类至少需要保留一个文件", "error");
    return;
  }
  await saveBuiltinCategories([...current]);
  await refreshBuiltinCategories();
  showToast("文件已移除，点击「重新加载题库」生效");
}

async function handleAddBuiltinFile(categoryName: string) {
  const newFile = prompt(
    `为「${categoryName}」添加新的 JSON 文件路径：`,
    "newcategory/file.json"
  );
  if (!newFile || !newFile.trim()) return;
  const current = await getBuiltinCategories();
  const cat = current.find((c) => c.category === categoryName);
  if (!cat) return;
  if (cat.files.includes(newFile.trim())) {
    showToast("该文件已存在", "error");
    return;
  }
  cat.files.push(newFile.trim());
  await saveBuiltinCategories([...current]);
  await refreshBuiltinCategories();
  showToast("文件已添加，点击「重新加载题库」生效");
}

async function handleUploadBuiltinFile(categoryName: string, e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const result = await importBuiltinCategoryFile(file, categoryName);
    console.log(
      "[Upload]",
      file.name,
      "loaded:",
      result.loaded,
      "errors:",
      result.errors
    );
    if (result.loaded > 0) {
      const current = await getBuiltinCategories();
      const cat = current.find((c) => c.category === categoryName);
      if (cat && !cat.files.includes(file.name)) {
        cat.files.push(file.name);
        await saveBuiltinCategories([...current]);
      }
      invalidateQuestionsCache();
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("grimoireface_category_map_updated")
        );
      }
      await refreshBuiltinCategories();
      showToast(`已导入 ${result.loaded} 道题到「${categoryName}」`);
    } else if (result.errors.length > 0) {
      showToast(`导入失败：${result.errors[0].message}`, "error");
    } else {
      showToast("文件中没有有效题目，请检查 JSON 格式", "error");
    }
  } catch (err) {
    console.error("[Upload] error:", err);
    showToast(
      `导入失败：${err instanceof Error ? err.message : String(err)}`,
      "error"
    );
  } finally {
    input.value = "";
  }
}

async function handleReloadBuiltinQuestions() {
  builtinReloading.value = true;
  try {
    await loadAllBuiltinModulesParallel(true);
    invalidateQuestionsCache();
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("grimoireface_category_map_updated")
      );
    }
    showToast("题库已重新加载");
  } catch {
    showToast("加载失败", "error");
  } finally {
    builtinReloading.value = false;
  }
}

// ─── Computed ───────────────────────────────────────────────────────────────────

const studyModeOptions: { value: StudyMode; label: string; desc: string }[] = [
  {
    value: "answer-first",
    label: "先作答",
    desc: "先自己作答，再对照答案和解析",
  },
  {
    value: "answer-later",
    label: "直接看答案",
    desc: "直接查看答案和 AI 解析，快速积累",
  },
];

const categoryEntries = computed(() =>
  Object.values(categoryMap.value).sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  )
);
</script>

<template>
  <template v-if="open">
    <!-- Backdrop -->
    <button
      type="button"
      aria-label="关闭设置面板"
      @click="emit('close')"
      style="
        position: fixed;
        inset: 0;
        z-index: 200;
        background: rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(2px);
        animation: fade-in 0.18s var(--ease-out) both;
        border: none;
        padding: 0;
        margin: 0;
        cursor: pointer;
      "
    />

    <!-- Drawer -->
    <div
      ref="drawerRef"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
      tabindex="-1"
      style="
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        z-index: 201;
        width: min(720px, 100vw);
        height: 100%;
        background: var(--surface);
        border-left: 1px solid var(--border-subtle);
        box-shadow: var(--shadow-xl);
        display: flex;
        flex-direction: column;
        animation: drawer-slide-in 0.22s var(--ease-out) both;
        overflow: hidden;
        outline: none;
      "
    >
      <!-- Header -->
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        "
      >
        <div style="display: flex; align-items: center; gap: 10px">
          <div
            style="
              width: 32px;
              height: 32px;
              border-radius: 9px;
              background: var(--primary-light);
              color: var(--primary);
              display: flex;
              align-items: center;
              justify-content: center;
            "
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <span style="font-size: 15px; font-weight: 600; color: var(--text)"
            >设置</span
          >
        </div>
        <button
          type="button"
          @click="emit('close')"
          aria-label="关闭设置面板"
          style="
            width: 30px;
            height: 30px;
            border-radius: 8px;
            border: none;
            background: transparent;
            color: var(--text-3);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s, color 0.15s;
          "
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <!-- Tabs -->
      <div
        role="tablist"
        aria-label="设置分类"
        style="
          display: flex;
          gap: 2px;
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        "
      >
        <button
          v-for="t in (['auth', 'model', 'ai', 'study', 'data', 'sync'] as Tab[])"
          :key="t"
          type="button"
          role="tab"
          :aria-selected="tab === t"
          @click="tab = t"
          :style="{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            flex: 1,
            padding: '7px 4px',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: tab === t ? 500 : 400,
            color: tab === t ? 'var(--primary)' : 'var(--text-2)',
            background: tab === t ? 'var(--primary-light)' : 'transparent',
            transition: 'all 0.15s',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }"
          :title="
            {
              auth: '认证管理',
              model: '模型选择',
              ai: 'AI 助手',
              study: '刷题偏好',
              data: '数据管理',
              sync: '云同步',
            }[t]
          "
        >
          <!-- Auth icon -->
          <svg
            v-if="t === 'auth'"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="flex-shrink: 0"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <!-- Model icon -->
          <svg
            v-else-if="t === 'model'"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="flex-shrink: 0"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
            />
          </svg>
          <!-- AI icon -->
          <svg
            v-else-if="t === 'ai'"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="flex-shrink: 0"
          >
            <path
              d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"
            />
            <circle cx="7.5" cy="14.5" r="1.5" />
            <circle cx="16.5" cy="14.5" r="1.5" />
          </svg>
          <!-- Study icon -->
          <svg
            v-else-if="t === 'study'"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="flex-shrink: 0"
          >
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          <!-- Data icon -->
          <svg
            v-else-if="t === 'data'"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="flex-shrink: 0"
          >
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
            <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
          </svg>
          <!-- Sync icon -->
          <svg
            v-else-if="t === 'sync'"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="flex-shrink: 0"
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path
              d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
            />
          </svg>
          <span class="settings-tab-label">{{
            {
              auth: "认证",
              model: "模型",
              ai: "AI",
              study: "刷题",
              data: "数据",
              sync: "同步",
            }[t]
          }}</span>
        </button>
      </div>

      <!-- Body -->
      <div
        style="
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        "
      >
        <!-- ─── Auth Tab ─── -->
        <template v-if="tab === 'auth'">
          <div
            style="
              display: flex;
              align-items: center;
              gap: 8px;
              margin-bottom: 4px;
            "
          >
            <div
              style="
                width: 28px;
                height: 28px;
                border-radius: 8px;
                background: var(--primary-light);
                color: var(--primary);
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
              "
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <span style="font-size: 13px; font-weight: 600; color: var(--text)"
              >认证管理</span
            >
          </div>
          <div
            style="
              display: flex;
              align-items: center;
              justify-content: space-between;
              margin: 8px 0;
              padding: 8px 10px;
              border-radius: 8px;
              background: var(--surface-2);
              border: 1px solid var(--border-subtle);
            "
          >
            <span
              style="font-size: 12px; font-weight: 500; color: var(--text-2)"
              >启用 AI 功能</span
            >
            <button
              type="button"
              @click="
                aiStore.updateConfig({ enabled: !aiStore.config.enabled });
                localConfig.value = {
                  ...localConfig.value,
                  enabled: !aiStore.config.enabled,
                };
              "
              :style="{
                width: '36px',
                height: '20px',
                borderRadius: '10px',
                border: 'none',
                background: aiStore.config.enabled
                  ? 'var(--primary)'
                  : 'var(--border)',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 0.2s',
              }"
            >
              <div
                :style="{
                  position: 'absolute',
                  top: '2px',
                  left: aiStore.config.enabled ? 'calc(100% - 18px)' : '2px',
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  background: 'white',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                  transition: 'left 0.2s var(--ease-out)',
                }"
              />
            </button>
          </div>

          <p style="font-size: 11px; color: var(--text-3); line-height: 1.5">
            为每个 AI 提供者配置 API Key，配置完成后即可在模型页选择对应模型。
          </p>

          <!-- Custom provider (always at top) -->
          <div
            style="
              padding: 12px;
              border-radius: 10px;
              background: var(--surface-2);
              border: 1px solid var(--border-subtle);
              display: flex;
              flex-direction: column;
              gap: 10px;
            "
          >
            <span style="font-size: 13px; font-weight: 600; color: var(--text)"
              >自定义兼容接口</span
            >
            <input
              :value="aiStore.config.baseUrl"
              @input="
                aiStore.updateConfig({
                  provider: 'custom',
                  baseUrl: ($event.target as HTMLInputElement).value,
                })
              "
              placeholder="Base URL，如 https://api.example.com/v1"
              style="
                width: 100%;
                padding: 8px 12px;
                border-radius: 8px;
                border: 1px solid var(--border);
                background: var(--surface);
                color: var(--text);
                font-size: 13px;
                outline: none;
                box-sizing: border-box;
              "
            />
            <input
              :value="aiStore.config.model"
              @input="
                aiStore.updateConfig({
                  provider: 'custom',
                  model: ($event.target as HTMLInputElement).value,
                })
              "
              placeholder="模型名称"
              style="
                width: 100%;
                padding: 8px 12px;
                border-radius: 8px;
                border: 1px solid var(--border);
                background: var(--surface);
                color: var(--text);
                font-size: 13px;
                outline: none;
                box-sizing: border-box;
              "
            />
            <template v-if="showApiKeyInput['custom']">
              <input
                v-model="apiKeyInputs['custom']"
                type="password"
                placeholder="API Key"
                @keyup.enter="submitApiKey('custom')"
                style="
                  width: 100%;
                  padding: 8px 12px;
                  border-radius: 8px;
                  border: 1px solid var(--border);
                  background: var(--surface);
                  color: var(--text);
                  font-size: 13px;
                  outline: none;
                  box-sizing: border-box;
                "
                autocomplete="off"
                spellcheck="false"
              />
              <div style="display: flex; gap: 8px; justify-content: flex-end">
                <button
                  type="button"
                  @click="toggleApiKeyInput('custom')"
                  style="
                    padding: 5px 10px;
                    border-radius: 7px;
                    border: 1px solid var(--border);
                    background: transparent;
                    color: var(--text-2);
                    font-size: 12px;
                    cursor: pointer;
                  "
                >
                  取消
                </button>
                <button
                  type="button"
                  @click="submitApiKey('custom')"
                  style="
                    padding: 5px 10px;
                    border-radius: 7px;
                    border: none;
                    background: var(--primary);
                    color: white;
                    font-size: 12px;
                    cursor: pointer;
                  "
                >
                  保存
                </button>
              </div>
            </template>
            <div v-else style="display: flex; gap: 8px">
              <button
                v-if="!aiStore.isProviderAuthenticated('custom')"
                type="button"
                @click="toggleApiKeyInput('custom')"
                style="
                  padding: 5px 10px;
                  border-radius: 7px;
                  border: 1px solid var(--border);
                  background: var(--surface);
                  color: var(--text-2);
                  font-size: 12px;
                  cursor: pointer;
                "
              >
                配置 API Key
              </button>
              <button
                v-else
                type="button"
                @click="handleRemoveAuth('custom')"
                style="
                  padding: 5px 10px;
                  border-radius: 7px;
                  border: 1px solid rgba(239, 68, 68, 0.2);
                  background: transparent;
                  color: var(--danger);
                  font-size: 12px;
                  cursor: pointer;
                "
              >
                删除认证
              </button>
            </div>
          </div>

          <!-- Search box -->
          <div style="position: relative">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              style="
                position: absolute;
                left: 10px;
                top: 50%;
                transform: translateY(-50%);
                color: var(--text-3);
              "
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              v-model="providerSearchQuery"
              type="text"
              placeholder="搜索供应商..."
              style="
                width: 100%;
                padding: 8px 12px 8px 32px;
                border-radius: 8px;
                border: 1px solid var(--border);
                background: var(--surface);
                color: var(--text);
                font-size: 13px;
                outline: none;
                box-sizing: border-box;
              "
            />
            <button
              v-if="providerSearchQuery"
              type="button"
              @click="providerSearchQuery = ''"
              style="
                position: absolute;
                right: 8px;
                top: 50%;
                transform: translateY(-50%);
                background: none;
                border: none;
                color: var(--text-3);
                cursor: pointer;
                padding: 2px;
                display: flex;
                align-items: center;
              "
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <!-- Provider list -->
          <div
            v-if="filteredProviders.length === 0"
            style="
              text-align: center;
              padding: 24px;
              color: var(--text-3);
              font-size: 13px;
            "
          >
            未找到匹配的供应商
          </div>
          <div
            v-for="preset in filteredProviders"
            :key="preset.id"
            style="
              padding: 12px;
              border-radius: 10px;
              background: var(--surface-2);
              border: 1px solid var(--border-subtle);
              display: flex;
              flex-direction: column;
              gap: 10px;
            "
          >
            <div
              style="
                display: flex;
                align-items: center;
                justify-content: space-between;
              "
            >
              <div style="display: flex; align-items: center; gap: 8px">
                <span
                  style="font-size: 13px; font-weight: 600; color: var(--text)"
                  >{{ preset.label }}</span
                >
                <span
                  :style="{
                    fontSize: '11px',
                    padding: '2px 7px',
                    borderRadius: '5px',
                    fontWeight: 500,
                    background: aiStore.isProviderAuthenticated(preset.id)
                      ? 'var(--success-light)'
                      : 'var(--surface-3)',
                    color: aiStore.isProviderAuthenticated(preset.id)
                      ? 'var(--success)'
                      : 'var(--text-3)',
                  }"
                  >{{
                    aiStore.isProviderAuthenticated(preset.id)
                      ? "已认证"
                      : "未认证"
                  }}</span
                >
              </div>
            </div>

            <template v-if="showApiKeyInput[preset.id]">
              <input
                v-model="apiKeyInputs[preset.id]"
                type="password"
                :placeholder="preset.apiKeyPlaceholder"
                @keyup.enter="submitApiKey(preset.id)"
                style="
                  width: 100%;
                  padding: 8px 12px;
                  border-radius: 8px;
                  border: 1px solid var(--border);
                  background: var(--surface);
                  color: var(--text);
                  font-size: 13px;
                  outline: none;
                  box-sizing: border-box;
                "
                autocomplete="off"
                spellcheck="false"
              />
              <div style="display: flex; gap: 8px; justify-content: flex-end">
                <button
                  type="button"
                  @click="toggleApiKeyInput(preset.id)"
                  style="
                    padding: 5px 10px;
                    border-radius: 7px;
                    border: 1px solid var(--border);
                    background: transparent;
                    color: var(--text-2);
                    font-size: 12px;
                    cursor: pointer;
                  "
                >
                  取消
                </button>
                <button
                  type="button"
                  @click="submitApiKey(preset.id)"
                  style="
                    padding: 5px 10px;
                    border-radius: 7px;
                    border: none;
                    background: var(--primary);
                    color: white;
                    font-size: 12px;
                    cursor: pointer;
                  "
                >
                  保存
                </button>
              </div>
            </template>
            <template v-else>
              <div style="display: flex; gap: 8px">
                <button
                  v-if="!aiStore.isProviderAuthenticated(preset.id)"
                  type="button"
                  @click="toggleApiKeyInput(preset.id)"
                  style="
                    padding: 5px 10px;
                    border-radius: 7px;
                    border: 1px solid var(--border);
                    background: var(--surface);
                    color: var(--text-2);
                    font-size: 12px;
                    cursor: pointer;
                  "
                >
                  配置 API Key
                </button>
                <button
                  v-else
                  type="button"
                  @click="handleRemoveAuth(preset.id)"
                  style="
                    padding: 5px 10px;
                    border-radius: 7px;
                    border: 1px solid rgba(239, 68, 68, 0.2);
                    background: transparent;
                    color: var(--danger);
                    font-size: 12px;
                    cursor: pointer;
                  "
                >
                  删除认证
                </button>
              </div>
            </template>
          </div>
        </template>

        <!-- ─── Model Tab ─── -->
        <template v-if="tab === 'model'">
          <div
            style="
              display: flex;
              align-items: center;
              gap: 8px;
              margin-bottom: 4px;
            "
          >
            <div
              style="
                width: 28px;
                height: 28px;
                border-radius: 8px;
                background: var(--primary-light);
                color: var(--primary);
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
              "
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path
                  d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
                />
              </svg>
            </div>
            <span style="font-size: 13px; font-weight: 600; color: var(--text)"
              >模型选择</span
            >
          </div>
          <p style="font-size: 11px; color: var(--text-3); line-height: 1.5">
            选择当前使用的 AI 模型。未认证的提供者模型不可选，请先前往认证页配置
            API Key。
          </p>

          <!-- Custom provider (always at top) -->
          <div style="display: flex; flex-direction: column; gap: 8px">
            <div style="display: flex; align-items: center; gap: 8px">
              <span
                style="font-size: 12px; font-weight: 600; color: var(--text-2)"
                >自定义兼容接口</span
              >
              <span
                :style="{
                  fontSize: '11px',
                  padding: '2px 7px',
                  borderRadius: '5px',
                  fontWeight: 500,
                  background: aiStore.isProviderAuthenticated('custom')
                    ? 'var(--success-light)'
                    : 'var(--surface-3)',
                  color: aiStore.isProviderAuthenticated('custom')
                    ? 'var(--success)'
                    : 'var(--text-3)',
                }"
                >{{
                  aiStore.isProviderAuthenticated("custom")
                    ? "已认证"
                    : "未认证"
                }}</span
              >
            </div>
            <button
              type="button"
              @click="
                aiStore.isProviderAuthenticated('custom') &&
                  handleSelectModel('custom', aiStore.config.model)
              "
              :disabled="!aiStore.isProviderAuthenticated('custom')"
              style="
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 8px 10px;
                border-radius: 8px;
                border: 1px solid var(--border);
                background: var(--surface);
                font-size: 12px;
                cursor: pointer;
                text-align: left;
                transition: all 0.12s;
              "
              :style="{
                borderColor:
                  aiStore.config.provider === 'custom'
                    ? 'var(--primary)'
                    : 'var(--border)',
                background:
                  aiStore.config.provider === 'custom'
                    ? 'var(--primary-light)'
                    : 'var(--surface)',
                color:
                  aiStore.config.provider === 'custom'
                    ? 'var(--primary)'
                    : 'var(--text-2)',
                opacity: aiStore.isProviderAuthenticated('custom') ? 1 : 0.5,
                cursor: aiStore.isProviderAuthenticated('custom')
                  ? 'pointer'
                  : 'not-allowed',
              }"
            >
              <div
                style="
                  width: 14px;
                  height: 14px;
                  border-radius: 50%;
                  border: 2px solid;
                  flex-shrink: 0;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                "
                :style="{
                  borderColor:
                    aiStore.config.provider === 'custom'
                      ? 'var(--primary)'
                      : 'var(--border)',
                }"
              >
                <div
                  v-if="aiStore.config.provider === 'custom'"
                  style="
                    width: 7px;
                    height: 7px;
                    border-radius: 50%;
                    background: var(--primary);
                  "
                />
              </div>
              <span style="font-weight: 500">{{
                aiStore.config.model || "未设置模型"
              }}</span>
            </button>
          </div>

          <div
            v-for="preset in AI_PROVIDER_PRESETS.filter(
              (p) => p.id !== 'custom'
            )"
            :key="preset.id"
            style="display: flex; flex-direction: column; gap: 8px"
          >
            <div style="display: flex; align-items: center; gap: 8px">
              <span
                style="font-size: 12px; font-weight: 600; color: var(--text-2)"
                >{{ preset.label }}</span
              >
              <span
                :style="{
                  fontSize: '11px',
                  padding: '2px 7px',
                  borderRadius: '5px',
                  fontWeight: 500,
                  background: aiStore.isProviderAuthenticated(preset.id)
                    ? 'var(--success-light)'
                    : 'var(--surface-3)',
                  color: aiStore.isProviderAuthenticated(preset.id)
                    ? 'var(--success)'
                    : 'var(--text-3)',
                }"
                >{{
                  aiStore.isProviderAuthenticated(preset.id)
                    ? "已认证"
                    : "未认证"
                }}</span
              >
            </div>
            <div
              style="
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 6px;
              "
            >
              <button
                v-for="m in preset.models"
                :key="m.value"
                type="button"
                @click="
                  aiStore.isProviderAuthenticated(preset.id) &&
                    handleSelectModel(preset.id, m.value)
                "
                :disabled="!aiStore.isProviderAuthenticated(preset.id)"
                style="
                  display: flex;
                  align-items: center;
                  gap: 6px;
                  padding: 8px 10px;
                  border-radius: 8px;
                  border: 1px solid var(--border);
                  background: var(--surface);
                  font-size: 12px;
                  cursor: pointer;
                  text-align: left;
                  transition: all 0.12s;
                "
                :style="{
                  borderColor:
                    aiStore.config.provider === preset.id &&
                    aiStore.config.model === m.value
                      ? 'var(--primary)'
                      : 'var(--border)',
                  background:
                    aiStore.config.provider === preset.id &&
                    aiStore.config.model === m.value
                      ? 'var(--primary-light)'
                      : 'var(--surface)',
                  color:
                    aiStore.config.provider === preset.id &&
                    aiStore.config.model === m.value
                      ? 'var(--primary)'
                      : 'var(--text-2)',
                  opacity: aiStore.isProviderAuthenticated(preset.id) ? 1 : 0.5,
                  cursor: aiStore.isProviderAuthenticated(preset.id)
                    ? 'pointer'
                    : 'not-allowed',
                }"
              >
                <div
                  style="
                    width: 14px;
                    height: 14px;
                    border-radius: 50%;
                    border: 2px solid;
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                  "
                  :style="{
                    borderColor:
                      aiStore.config.provider === preset.id &&
                      aiStore.config.model === m.value
                        ? 'var(--primary)'
                        : 'var(--border)',
                  }"
                >
                  <div
                    v-if="
                      aiStore.config.provider === preset.id &&
                      aiStore.config.model === m.value
                    "
                    style="
                      width: 7px;
                      height: 7px;
                      border-radius: 50%;
                      background: var(--primary);
                    "
                  />
                </div>
                <span style="font-weight: 500">{{ m.label }}</span>
              </button>
            </div>
          </div>

        </template>

        <!-- ─── AI Tab (advanced) ─── -->
        <template v-if="tab === 'ai'">
          <div
            style="
              display: flex;
              align-items: center;
              justify-content: space-between;
            "
          >
            <span style="font-size: 13px; font-weight: 600; color: var(--text)"
              >启用 AI 功能</span
            >
            <button
              type="button"
              @click="patch({ enabled: !localConfig.enabled })"
              :style="{
                width: 40,
                height: 22,
                borderRadius: 11,
                border: 'none',
                background: localConfig.enabled
                  ? 'var(--primary)'
                  : 'var(--border)',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 0.2s',
              }"
            >
              <div
                :style="{
                  position: 'absolute',
                  top: 2,
                  left: localConfig.enabled ? 20 : 2,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: 'white',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                }"
              />
            </button>
          </div>

          <!-- System Prompt -->
          <div>
            <div
              style="
                font-size: 12px;
                font-weight: 500;
                color: var(--text-2);
                margin-bottom: 5px;
              "
            >
              系统提示词
            </div>
            <textarea
              :value="localConfig.systemPrompt"
              @input="
                patch({
                  systemPrompt: ($event.target as HTMLTextAreaElement).value,
                })
              "
              placeholder="输入系统提示词..."
              rows="28"
              style="
                width: 100%;
                padding: 8px 12px;
                border-radius: 8px;
                border: 1px solid var(--border);
                background: var(--surface);
                color: var(--text);
                font-size: 12px;
                outline: none;
                resize: vertical;
                font-family: var(--font-mono);
                box-sizing: border-box;
              "
            />
          </div>

          <!-- Test result -->
          <div
            v-if="testResult"
            style="
              margin-top: 8px;
              padding: 8px 12px;
              font-size: 12px;
              line-height: 1.5;
              border-radius: 8px;
            "
            :style="{
              color: testResult.ok ? 'var(--success)' : 'var(--danger)',
              background: testResult.ok
                ? 'var(--success-light)'
                : 'var(--danger-light)',
              border: '1px solid',
              borderColor: testResult.ok ? 'var(--success)' : 'var(--danger)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '6px',
            }"
          >
            <span style="flex-shrink: 0; margin-top: 1px">{{
              testResult.ok ? "✅" : "❌"
            }}</span>
            <span style="word-break: break-all">{{ testResult.message }}</span>
          </div>

          <!-- Actions -->
          <div
            style="
              margin-top: 8px;
              display: flex;
              align-items: center;
              gap: 8px;
            "
          >
            <button
              type="button"
              @click="handleSaveAIConfig"
              :disabled="!isDirty"
              :style="{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '8px 16px',
                borderRadius: '9px',
                border: 'none',
                background: isDirty ? 'var(--primary)' : 'var(--surface-3)',
                color: isDirty ? 'white' : 'var(--text-3)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: isDirty ? 'pointer' : 'default',
                transition: 'all 0.15s',
              }"
            >
              <template v-if="saved">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                已保存
              </template>
              <template v-else>保存设置</template>
            </button>
            <button
              type="button"
              @click="handleTest"
              :disabled="testing"
              style="
                padding: 8px 12px;
                border-radius: 9px;
                border: 1px solid var(--border);
                background: transparent;
                color: var(--text-2);
                font-size: 12px;
                cursor: pointer;
                white-space: nowrap;
                transition: all 0.15s;
                display: flex;
                align-items: center;
                gap: 4px;
              "
            >
              <template v-if="testing">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  style="animation: spin 1s linear infinite"
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                测试中…
              </template>
              <template v-else>
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                测试连接
              </template>
            </button>
            <button
              type="button"
              @click="handleResetAIConfig"
              style="
                padding: 8px 12px;
                border-radius: 9px;
                border: 1px solid var(--border);
                background: transparent;
                color: var(--text-3);
                font-size: 12px;
                cursor: pointer;
                white-space: nowrap;
                transition: all 0.15s;
              "
            >
              恢复默认
            </button>
          </div>
        </template>

        <!-- ─── Study Tab ─── -->
        <template v-if="tab === 'study'">
          <div
            style="
              display: flex;
              align-items: center;
              gap: 8px;
              margin-bottom: 4px;
            "
          >
            <div
              style="
                width: 28px;
                height: 28px;
                border-radius: 8px;
                background: var(--primary-light);
                color: var(--primary);
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
              "
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <span style="font-size: 13px; font-weight: 600; color: var(--text)"
              >刷题偏好</span
            >
          </div>

          <!-- Study Mode -->
          <div style="display: flex; flex-direction: column; gap: 6px">
            <div
              style="
                font-size: 12px;
                font-weight: 500;
                color: var(--text-2);
                margin-bottom: 2px;
              "
            >
              学习模式
            </div>
            <button
              v-for="opt in studyModeOptions"
              :key="opt.value"
              type="button"
              @click="studyStore.setStudyMode(opt.value)"
              :style="{
                display: 'flex',
                alignItems: 'flex-start',
                flexDirection: 'column',
                gap: '2px',
                padding: '10px 12px',
                borderRadius: '10px',
                width: '100%',
                textAlign: 'left',
                border:
                  studyStore.studyMode === opt.value
                    ? '1px solid rgba(var(--primary-rgb), 0.4)'
                    : '1px solid var(--border-subtle)',
                background:
                  studyStore.studyMode === opt.value
                    ? 'var(--primary-light)'
                    : 'var(--surface-2)',
                cursor: 'pointer',
                transition: 'all 0.15s',
                marginBottom: '4px',
              }"
            >
              <span
                :style="{
                  fontSize: '13px',
                  fontWeight: 500,
                  color:
                    studyStore.studyMode === opt.value
                      ? 'var(--primary)'
                      : 'var(--text)',
                }"
                >{{ opt.label }}</span
              >
              <span
                style="font-size: 11px; color: var(--text-3); line-height: 1.4"
                >{{ opt.desc }}</span
              >
            </button>
          </div>

          <!-- Daily Goal -->
          <div style="display: flex; flex-direction: column; gap: 8px">
            <div
              style="
                display: flex;
                align-items: center;
                justify-content: space-between;
              "
            >
              <div
                style="font-size: 12px; font-weight: 500; color: var(--text-2)"
              >
                每日目标题数
              </div>
              <span
                style="font-size: 12px; font-weight: 600; color: var(--primary)"
                >{{ studyStore.dailyGoal }} 题 / 天</span
              >
            </div>
            <input
              type="range"
              :min="DAILY_GOAL_MIN"
              :max="DAILY_GOAL_MAX"
              :step="5"
              :value="studyStore.dailyGoal"
              @input="
                studyStore.setDailyGoal(
                  parseInt(($event.target as HTMLInputElement).value, 10)
                )
              "
              style="width: 100%; accent-color: var(--primary)"
            />
          </div>

          <!-- Streak -->
          <div
            v-if="studyStore.streak"
            style="
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 10px 12px;
              border-radius: 10px;
              background: var(--surface-2);
              border: 1px solid var(--border-subtle);
            "
          >
            <span style="font-size: 13px; color: var(--text-2)"
              >当前连续 {{ studyStore.streak }} 天</span
            >
            <button
              type="button"
              @click="studyStore.resetStreak()"
              style="
                font-size: 12px;
                color: var(--text-3);
                background: none;
                border: none;
                cursor: pointer;
                padding: 0;
                text-decoration: underline;
              "
            >
              重置
            </button>
          </div>

          <!-- Category Management -->
          <div style="display: flex; flex-direction: column; gap: 8px">
            <div
              style="
                display: flex;
                align-items: center;
                justify-content: space-between;
              "
            >
              <div
                style="font-size: 12px; font-weight: 500; color: var(--text-2)"
              >
                题库分类管理
              </div>
              <button
                type="button"
                @click="addingCategory = true"
                style="
                  font-size: 11px;
                  color: var(--primary);
                  background: none;
                  border: none;
                  cursor: pointer;
                  padding: 2px 6px;
                  display: flex;
                  align-items: center;
                  gap: 2px;
                "
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                添加分类
              </button>
            </div>

            <!-- Add category form -->
            <div
              v-if="addingCategory"
              style="
                display: flex;
                flex-direction: column;
                gap: 6px;
                padding: 10px;
                border-radius: 10px;
                background: var(--surface-2);
                border: 1px solid var(--border-subtle);
              "
            >
              <input
                v-model="newCategoryName"
                type="text"
                placeholder="输入分类名称"
                @keyup.enter="handleAddCategory"
                style="
                  width: 100%;
                  padding: 8px 12px;
                  border-radius: 8px;
                  border: 1px solid var(--border);
                  background: var(--surface);
                  color: var(--text);
                  font-size: 13px;
                  outline: none;
                  box-sizing: border-box;
                "
              />
              <div style="display: flex; gap: 8px; justify-content: flex-end">
                <button
                  type="button"
                  @click="
                    addingCategory = false;
                    newCategoryName = '';
                  "
                  style="
                    padding: 5px 10px;
                    border-radius: 7px;
                    border: 1px solid var(--border);
                    background: transparent;
                    color: var(--text-2);
                    font-size: 12px;
                    cursor: pointer;
                  "
                >
                  取消
                </button>
                <button
                  type="button"
                  @click="handleAddCategory"
                  style="
                    padding: 5px 10px;
                    border-radius: 7px;
                    border: none;
                    background: var(--primary);
                    color: white;
                    font-size: 12px;
                    cursor: pointer;
                  "
                >
                  确认
                </button>
              </div>
            </div>

            <!-- Category list -->
            <div style="display: flex; flex-direction: column; gap: 6px">
              <div
                v-for="cat in categoryEntries"
                :key="cat.name"
                style="
                  border-radius: 10px;
                  background: var(--surface-2);
                  border: 1px solid var(--border-subtle);
                  overflow: hidden;
                "
              >
                <!-- Category header -->
                <div
                  style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 12px;
                    cursor: pointer;
                  "
                  @click="toggleExpand(cat.name)"
                >
                  <div
                    style="
                      display: flex;
                      align-items: center;
                      gap: 8px;
                      flex: 1;
                      min-width: 0;
                    "
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      :style="{
                        transform: expandedCategories.has(cat.name)
                          ? 'rotate(90deg)'
                          : 'rotate(0deg)',
                        transition: 'transform 0.15s',
                        color: 'var(--text-3)',
                        flexShrink: 0,
                      }"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>

                    <!-- Name display or edit input -->
                    <template v-if="editingCategory === cat.name">
                      <input
                        v-model="editName"
                        type="text"
                        @keyup.enter="handleConfirmEdit(cat.name)"
                        @click.stop
                        style="
                          flex: 1;
                          padding: 4px 8px;
                          border-radius: 6px;
                          border: 1px solid var(--primary);
                          background: var(--surface);
                          color: var(--text);
                          font-size: 13px;
                          outline: none;
                          min-width: 0;
                        "
                      />
                    </template>
                    <template v-else>
                      <span
                        style="
                          font-size: 13px;
                          font-weight: 500;
                          color: var(--text);
                          white-space: nowrap;
                          overflow: hidden;
                          text-overflow: ellipsis;
                        "
                        >{{ cat.name }}</span
                      >
                    </template>

                    <span
                      style="
                        font-size: 11px;
                        color: var(--text-3);
                        flex-shrink: 0;
                      "
                      >{{ cat.modules.length }} 个模块</span
                    >
                  </div>

                  <!-- Actions -->
                  <div
                    style="
                      display: flex;
                      align-items: center;
                      gap: 2px;
                      flex-shrink: 0;
                    "
                  >
                    <!-- Visibility toggle -->
                    <button
                      type="button"
                      @click.stop="
                        studyStore.toggleCategoryVisibility(cat.name)
                      "
                      :style="{
                        padding: '4px 6px',
                        borderRadius: '6px',
                        border: 'none',
                        background: 'none',
                        color: studyStore.hiddenCategories.has(cat.name)
                          ? 'var(--text-3)'
                          : 'var(--primary)',
                        cursor: 'pointer',
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                      }"
                      :title="
                        studyStore.hiddenCategories.has(cat.name)
                          ? '已隐藏，点击展示'
                          : '已展示，点击隐藏'
                      "
                    >
                      <svg
                        v-if="!studyStore.hiddenCategories.has(cat.name)"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path
                          d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
                        />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      <svg
                        v-else
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path
                          d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                        />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    </button>

                    <!-- Edit -->
                    <button
                      v-if="editingCategory !== cat.name"
                      type="button"
                      @click.stop="handleStartEdit(cat.name)"
                      style="
                        padding: 4px 6px;
                        border-radius: 6px;
                        border: none;
                        background: none;
                        color: var(--text-3);
                        cursor: pointer;
                        font-size: 11px;
                      "
                      title="编辑名称"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path
                          d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
                        />
                        <path
                          d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                        />
                      </svg>
                    </button>
                    <button
                      v-if="editingCategory === cat.name"
                      type="button"
                      @click.stop="handleConfirmEdit(cat.name)"
                      style="
                        padding: 4px 6px;
                        border-radius: 6px;
                        border: none;
                        background: none;
                        color: var(--primary);
                        cursor: pointer;
                        font-size: 11px;
                      "
                      title="确认"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    <button
                      v-if="editingCategory === cat.name"
                      type="button"
                      @click.stop="handleCancelEdit"
                      style="
                        padding: 4px 6px;
                        border-radius: 6px;
                        border: none;
                        background: none;
                        color: var(--text-3);
                        cursor: pointer;
                        font-size: 11px;
                      "
                      title="取消"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>

                    <!-- Delete -->
                    <button
                      type="button"
                      @click.stop="handleDeleteCategory(cat.name)"
                      style="
                        padding: 4px 6px;
                        border-radius: 6px;
                        border: none;
                        background: none;
                        color: var(--text-3);
                        cursor: pointer;
                        font-size: 11px;
                      "
                      title="删除分类"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path
                          d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                        />
                      </svg>
                    </button>

                    <!-- Move up -->
                    <button
                      type="button"
                      @click.stop="handleMoveCategoryUp(cat.name)"
                      style="
                        padding: 4px 6px;
                        border-radius: 6px;
                        border: none;
                        background: none;
                        color: var(--text-3);
                        cursor: pointer;
                        font-size: 11px;
                      "
                      title="上移"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="18 15 12 9 6 15" />
                      </svg>
                    </button>

                    <!-- Move down -->
                    <button
                      type="button"
                      @click.stop="handleMoveCategoryDown(cat.name)"
                      style="
                        padding: 4px 6px;
                        border-radius: 6px;
                        border: none;
                        background: none;
                        color: var(--text-3);
                        cursor: pointer;
                        font-size: 11px;
                      "
                      title="下移"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  </div>
                </div>

                <!-- Expanded module list -->
                <div
                  v-if="expandedCategories.has(cat.name)"
                  style="
                    border-top: 1px solid var(--border-subtle);
                    padding: 8px 12px 10px 32px;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                  "
                >
                  <div
                    v-if="cat.modules.length === 0"
                    style="
                      font-size: 12px;
                      color: var(--text-3);
                      padding: 4px 0;
                    "
                  >
                    暂无模块
                  </div>
                  <div
                    v-for="mod in cat.modules"
                    :key="mod"
                    style="
                      display: flex;
                      align-items: center;
                      justify-content: space-between;
                      gap: 8px;
                    "
                  >
                    <span
                      style="
                        font-size: 12px;
                        color: var(--text-2);
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                      "
                      >{{ mod }}</span
                    >
                    <select
                      @change="
                        handleMoveModule(
                          mod,
                          cat.name,
                          ($event.target as HTMLSelectElement).value
                        );
                        ($event.target as HTMLSelectElement).value = '';
                      "
                      style="
                        padding: 3px 6px;
                        border-radius: 5px;
                        border: 1px solid var(--border);
                        background: var(--surface);
                        color: var(--text-2);
                        font-size: 11px;
                        cursor: pointer;
                        outline: none;
                        flex-shrink: 0;
                      "
                    >
                      <option value="" disabled selected>移动到...</option>
                      <option
                        v-for="target in categoryEntries.filter(
                          (c) => c.name !== cat.name
                        )"
                        :key="target.name"
                        :value="target.name"
                      >
                        {{ target.name }}
                      </option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Built-in Category Config -->
          <div style="display: flex; flex-direction: column; gap: 8px">
            <div
              style="
                display: flex;
                align-items: center;
                justify-content: space-between;
              "
            >
              <div
                style="font-size: 12px; font-weight: 500; color: var(--text-2)"
              >
                内置题库分类配置
              </div>
              <div style="display: flex; align-items: center; gap: 6px">
                <button
                  type="button"
                  @click="addingBuiltinCategory = true"
                  style="
                    font-size: 11px;
                    color: var(--primary);
                    background: none;
                    border: none;
                    cursor: pointer;
                    padding: 2px 6px;
                    display: flex;
                    align-items: center;
                    gap: 2px;
                  "
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  添加分类
                </button>
                <button
                  type="button"
                  @click="handleReloadBuiltinQuestions"
                  :disabled="builtinReloading"
                  style="
                    font-size: 11px;
                    color: var(--primary);
                    background: none;
                    border: 1px solid var(--primary);
                    border-radius: 6px;
                    cursor: pointer;
                    padding: 2px 8px;
                    display: flex;
                    align-items: center;
                    gap: 2px;
                  "
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  {{ builtinReloading ? "加载中…" : "重新加载题库" }}
                </button>
              </div>
            </div>

            <!-- Add builtin category form -->
            <div
              v-if="addingBuiltinCategory"
              style="
                display: flex;
                flex-direction: column;
                gap: 6px;
                padding: 10px;
                border-radius: 10px;
                background: var(--surface-2);
                border: 1px solid var(--border-subtle);
              "
            >
              <input
                v-model="newBuiltinCategoryName"
                type="text"
                placeholder="分类名称，如：Android"
                style="
                  width: 100%;
                  padding: 8px 12px;
                  border-radius: 8px;
                  border: 1px solid var(--border);
                  background: var(--surface);
                  color: var(--text);
                  font-size: 13px;
                  outline: none;
                  box-sizing: border-box;
                "
              />
              <textarea
                v-model="newBuiltinCategoryFiles"
                placeholder="（可选）远程 JSON 文件路径，每行一个&#10;如：android/basics.json&#10;    android/advanced.json&#10;也可留空，后续直接上传本地 JSON 文件"
                rows="4"
                style="
                  width: 100%;
                  padding: 8px 12px;
                  border-radius: 8px;
                  border: 1px solid var(--border);
                  background: var(--surface);
                  color: var(--text);
                  font-size: 13px;
                  outline: none;
                  box-sizing: border-box;
                  resize: vertical;
                  font-family: inherit;
                "
              />
              <div style="display: flex; gap: 8px; justify-content: flex-end">
                <button
                  type="button"
                  @click="
                    addingBuiltinCategory = false;
                    newBuiltinCategoryName = '';
                    newBuiltinCategoryFiles = '';
                  "
                  style="
                    padding: 5px 10px;
                    border-radius: 7px;
                    border: 1px solid var(--border);
                    background: transparent;
                    color: var(--text-2);
                    font-size: 12px;
                    cursor: pointer;
                  "
                >
                  取消
                </button>
                <button
                  type="button"
                  @click="handleAddBuiltinCategory"
                  style="
                    padding: 5px 10px;
                    border-radius: 7px;
                    border: none;
                    background: var(--primary);
                    color: white;
                    font-size: 12px;
                    cursor: pointer;
                  "
                >
                  确认
                </button>
              </div>
            </div>

            <!-- Builtin category list -->
            <div style="display: flex; flex-direction: column; gap: 6px">
              <div
                v-for="cat in builtinCategories"
                :key="cat.category"
                style="
                  border-radius: 10px;
                  background: var(--surface-2);
                  border: 1px solid var(--border-subtle);
                  overflow: hidden;
                "
              >
                <!-- Category header -->
                <div
                  style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 10px 12px;
                    cursor: pointer;
                  "
                  @click="toggleExpandBuiltin(cat.category)"
                >
                  <div
                    style="
                      display: flex;
                      align-items: center;
                      gap: 8px;
                      flex: 1;
                      min-width: 0;
                    "
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      :style="{
                        transform: expandedBuiltinCategories.has(cat.category)
                          ? 'rotate(90deg)'
                          : 'rotate(0deg)',
                        transition: 'transform 0.15s',
                        color: 'var(--text-3)',
                        flexShrink: 0,
                      }"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>

                    <template v-if="editingBuiltinCategory === cat.category">
                      <input
                        v-model="editBuiltinName"
                        type="text"
                        @keyup.enter="
                          handleConfirmEditBuiltinCategory(cat.category)
                        "
                        @click.stop
                        style="
                          flex: 1;
                          padding: 4px 8px;
                          border-radius: 6px;
                          border: 1px solid var(--primary);
                          background: var(--surface);
                          color: var(--text);
                          font-size: 13px;
                          outline: none;
                          min-width: 0;
                        "
                      />
                    </template>
                    <template v-else>
                      <span
                        style="
                          font-size: 13px;
                          font-weight: 500;
                          color: var(--text);
                          white-space: nowrap;
                          overflow: hidden;
                          text-overflow: ellipsis;
                        "
                        >{{ cat.category }}</span
                      >
                    </template>

                    <span
                      style="
                        font-size: 11px;
                        color: var(--text-3);
                        flex-shrink: 0;
                      "
                      >{{ cat.files.length }} 个文件</span
                    >
                  </div>

                  <div
                    style="
                      display: flex;
                      align-items: center;
                      gap: 2px;
                      flex-shrink: 0;
                    "
                  >
                    <button
                      v-if="editingBuiltinCategory !== cat.category"
                      type="button"
                      @click.stop="handleStartEditBuiltinCategory(cat.category)"
                      style="
                        padding: 4px 6px;
                        border-radius: 6px;
                        border: none;
                        background: none;
                        color: var(--text-3);
                        cursor: pointer;
                        font-size: 11px;
                      "
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path
                          d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
                        />
                        <path
                          d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                        />
                      </svg>
                    </button>
                    <button
                      v-if="editingBuiltinCategory === cat.category"
                      type="button"
                      @click.stop="
                        handleConfirmEditBuiltinCategory(cat.category)
                      "
                      style="
                        padding: 4px 6px;
                        border-radius: 6px;
                        border: none;
                        background: none;
                        color: var(--primary);
                        cursor: pointer;
                        font-size: 11px;
                      "
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    <button
                      v-if="editingBuiltinCategory === cat.category"
                      type="button"
                      @click.stop="handleCancelEditBuiltinCategory"
                      style="
                        padding: 4px 6px;
                        border-radius: 6px;
                        border: none;
                        background: none;
                        color: var(--text-3);
                        cursor: pointer;
                        font-size: 11px;
                      "
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                    <button
                      v-if="editingBuiltinCategory !== cat.category"
                      type="button"
                      @click.stop="handleDeleteBuiltinCategory(cat.category)"
                      style="
                        padding: 4px 6px;
                        border-radius: 6px;
                        border: none;
                        background: none;
                        color: var(--danger);
                        cursor: pointer;
                        font-size: 11px;
                      "
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path
                          d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                <!-- Expanded file list -->
                <div
                  v-if="expandedBuiltinCategories.has(cat.category)"
                  style="
                    padding: 0 12px 10px 36px;
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                  "
                >
                  <!-- File list in edit mode -->
                  <template v-if="editingBuiltinCategory === cat.category">
                    <div
                      v-for="(file, idx) in editBuiltinFiles"
                      :key="idx"
                      style="display: flex; align-items: center; gap: 6px"
                    >
                      <input
                        v-model="editBuiltinFiles[idx]"
                        type="text"
                        style="
                          flex: 1;
                          padding: 4px 8px;
                          border-radius: 5px;
                          border: 1px solid var(--border);
                          background: var(--surface);
                          color: var(--text);
                          font-size: 12px;
                          outline: none;
                        "
                      />
                      <button
                        type="button"
                        @click="editBuiltinFiles.splice(idx, 1)"
                        style="
                          padding: 2px 4px;
                          border-radius: 4px;
                          border: none;
                          background: none;
                          color: var(--danger);
                          cursor: pointer;
                          font-size: 11px;
                        "
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                    <button
                      type="button"
                      @click="editBuiltinFiles.push('')"
                      style="
                        padding: 4px 8px;
                        border-radius: 6px;
                        border: 1px dashed var(--border);
                        background: none;
                        color: var(--text-3);
                        cursor: pointer;
                        font-size: 11px;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        align-self: flex-start;
                      "
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      添加文件路径
                    </button>
                  </template>

                  <!-- File list in view mode -->
                  <template v-else>
                    <div
                      v-for="(file, idx) in cat.files"
                      :key="file"
                      style="
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 6px;
                      "
                    >
                      <code
                        style="
                          font-size: 11px;
                          color: var(--text-2);
                          background: var(--surface);
                          padding: 2px 6px;
                          border-radius: 4px;
                          flex: 1;
                          overflow: hidden;
                          text-overflow: ellipsis;
                          white-space: nowrap;
                        "
                        >{{ file }}</code
                      >
                      <button
                        type="button"
                        @click="handleRemoveBuiltinFile(cat.category, idx)"
                        style="
                          padding: 2px 4px;
                          border-radius: 4px;
                          border: none;
                          background: none;
                          color: var(--danger);
                          cursor: pointer;
                          font-size: 10px;
                        "
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                    <button
                      type="button"
                      @click="handleAddBuiltinFile(cat.category)"
                      style="
                        padding: 4px 8px;
                        border-radius: 6px;
                        border: 1px dashed var(--border);
                        background: none;
                        color: var(--text-3);
                        cursor: pointer;
                        font-size: 11px;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        align-self: flex-start;
                      "
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      添加文件路径
                    </button>
                    <input
                      :ref="(el: any) => { if (el) (el as HTMLInputElement).dataset.category = cat.category }"
                      type="file"
                      accept=".json,application/json"
                      style="display: none"
                      @change="(e: Event) => handleUploadBuiltinFile(cat.category, e)"
                    />
                    <button
                      type="button"
                      @click="
                        (
                          $event.currentTarget as HTMLElement
                        ).previousElementSibling?.click()
                      "
                      style="
                        padding: 4px 8px;
                        border-radius: 6px;
                        border: 1px dashed var(--primary);
                        background: none;
                        color: var(--primary);
                        cursor: pointer;
                        font-size: 11px;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        align-self: flex-start;
                      "
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      上传 JSON 文件
                    </button>
                  </template>
                </div>
              </div>

              <!-- Empty state -->
              <div
                v-if="builtinCategories.length === 0"
                style="
                  padding: 20px;
                  text-align: center;
                  color: var(--text-3);
                  font-size: 13px;
                  border-radius: 10px;
                  background: var(--surface-2);
                  border: 1px solid var(--border-subtle);
                "
              >
                暂无内置题库分类，点击「添加分类」开始配置
              </div>
            </div>
          </div>
        </template>

        <!-- ─── Data Tab ─── -->
        <template v-if="tab === 'data'">
          <div
            style="
              display: flex;
              align-items: center;
              gap: 8px;
              margin-bottom: 4px;
            "
          >
            <div
              style="
                width: 28px;
                height: 28px;
                border-radius: 8px;
                background: var(--primary-light);
                color: var(--primary);
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
              "
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
                <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
              </svg>
            </div>
            <span style="font-size: 13px; font-weight: 600; color: var(--text)"
              >数据管理</span
            >
          </div>

          <!-- Stats -->
          <div
            v-if="dataStats"
            style="
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 8px;
            "
            class="settings-data-stats-grid"
          >
            <div
              v-for="s in [
                { label: '题目', value: dataStats.questions },
                { label: '学习记录', value: dataStats.records },
                { label: '笔记', value: dataStats.notes },
                { label: '答案标注', value: dataStats.answerAnnotations },
                { label: '重点题', value: dataStats.starred },
                { label: 'AI 会话', value: dataStats.aiSessions },
                { label: '模拟面试', value: dataStats.mockInterviews },
                { label: 'JD 诊断', value: dataStats.jdMatchReports },
              ]"
              :key="s.label"
              style="
                padding: 10px;
                border-radius: 10px;
                background: var(--surface-2);
                text-align: center;
              "
            >
              <div
                style="font-size: 18px; font-weight: 700; color: var(--text)"
              >
                {{ s.value }}
              </div>
              <div
                style="font-size: 10px; color: var(--text-3); margin-top: 2px"
              >
                {{ s.label }}
              </div>
            </div>
          </div>

          <!-- Export -->
          <button
            type="button"
            @click="handleExport"
            :disabled="exporting"
            style="
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
              width: 100%;
              padding: 10px 16px;
              border-radius: 10px;
              font-size: 13px;
              font-weight: 500;
              border: 1px solid var(--border);
              background: var(--surface);
              color: var(--text-2);
              cursor: pointer;
              transition: all 0.15s;
            "
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {{ exporting ? "导出中..." : "导出备份" }}
          </button>

          <!-- Import -->
          <input
            ref="importRef"
            type="file"
            accept=".json"
            @change="
              handleImport(($event.target as HTMLInputElement).files?.[0]!)
            "
            style="display: none"
          />
          <button
            type="button"
            @click="importRef?.click()"
            :disabled="importing"
            style="
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 6px;
              width: 100%;
              padding: 10px 16px;
              border-radius: 10px;
              font-size: 13px;
              font-weight: 500;
              border: 1px solid var(--border);
              background: var(--surface);
              color: var(--text-2);
              cursor: pointer;
              transition: all 0.15s;
            "
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {{ importing ? "导入中..." : "导入备份" }}
          </button>

          <!-- Import preview -->
          <div
            v-if="importPreview"
            style="
              padding: 12px;
              border-radius: 10px;
              background: var(--surface-2);
              border: 1px solid var(--border-subtle);
            "
          >
            <div
              style="
                font-size: 13px;
                font-weight: 600;
                color: var(--text);
                margin-bottom: 8px;
              "
            >
              导入预览
            </div>
            <div
              style="
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 4px;
                font-size: 11px;
                color: var(--text-2);
                margin-bottom: 10px;
              "
              class="settings-import-preview-grid"
            >
              <div
                v-if="
                  importPreview.impact.questions.created ||
                  importPreview.impact.questions.overwritten
                "
              >
                <span style="font-weight: 500">题目</span>: 新增
                {{ importPreview.impact.questions.created }}，覆盖
                {{ importPreview.impact.questions.overwritten }}
              </div>
              <div
                v-if="
                  importPreview.impact.studyRecords.created ||
                  importPreview.impact.studyRecords.overwritten
                "
              >
                <span style="font-weight: 500">记录</span>: 新增
                {{ importPreview.impact.studyRecords.created }}，覆盖
                {{ importPreview.impact.studyRecords.overwritten }}
              </div>
              <div
                v-if="
                  importPreview.impact.questionNotes.created ||
                  importPreview.impact.questionNotes.overwritten
                "
              >
                <span style="font-weight: 500">笔记</span>: 新增
                {{ importPreview.impact.questionNotes.created }}，覆盖
                {{ importPreview.impact.questionNotes.overwritten }}
              </div>
              <div
                v-if="
                  importPreview.impact.questionFlags.created ||
                  importPreview.impact.questionFlags.overwritten
                "
              >
                <span style="font-weight: 500">重点</span>: 新增
                {{ importPreview.impact.questionFlags.created }}，覆盖
                {{ importPreview.impact.questionFlags.overwritten }}
              </div>
            </div>
            <div style="display: flex; gap: 8px">
              <button
                type="button"
                @click="handleConfirmImport"
                :disabled="importing"
                style="
                  flex: 1;
                  padding: 8px 14px;
                  border-radius: 8px;
                  font-size: 12px;
                  font-weight: 500;
                  border: none;
                  background: var(--primary);
                  color: white;
                  cursor: pointer;
                "
              >
                确认导入
              </button>
              <button
                type="button"
                @click="importPreview = null"
                style="
                  padding: 8px 12px;
                  border-radius: 8px;
                  font-size: 12px;
                  border: 1px solid var(--border);
                  background: transparent;
                  color: var(--text-2);
                  cursor: pointer;
                "
              >
                取消
              </button>
            </div>
          </div>

          <!-- Reset -->
          <div
            style="
              display: flex;
              flex-direction: column;
              gap: 8px;
              padding-top: 12px;
              border-top: 1px solid var(--border-subtle);
            "
          >
            <div
              style="font-size: 12px; font-weight: 500; color: var(--text-2)"
            >
              危险区域
            </div>
            <template v-if="confirmReset === 'records'">
              <p
                style="
                  font-size: 12px;
                  color: var(--danger);
                  padding: 8px;
                  border-radius: 8px;
                  background: var(--danger-light);
                "
              >
                确定清空所有学习记录？此操作不可撤销。
              </p>
              <div style="display: flex; gap: 8px">
                <button
                  type="button"
                  @click="handleResetConfirm"
                  style="
                    padding: 6px 12px;
                    border-radius: 7px;
                    border: 1px solid rgba(239, 68, 68, 0.3);
                    background: var(--danger);
                    color: white;
                    font-size: 12px;
                    cursor: pointer;
                  "
                >
                  确认清空
                </button>
                <button
                  type="button"
                  @click="confirmReset = null"
                  style="
                    padding: 6px 12px;
                    border-radius: 7px;
                    border: 1px solid var(--border);
                    background: transparent;
                    color: var(--text-2);
                    font-size: 12px;
                    cursor: pointer;
                  "
                >
                  取消
                </button>
              </div>
            </template>
            <template v-else-if="confirmReset === 'all'">
              <p
                style="
                  font-size: 12px;
                  color: var(--danger);
                  padding: 8px;
                  border-radius: 8px;
                  background: var(--danger-light);
                "
              >
                确定重置所有数据（题目、记录、笔记等全部内容）？此操作不可撤销！
              </p>
              <div style="display: flex; gap: 8px">
                <button
                  type="button"
                  @click="handleResetConfirm"
                  style="
                    padding: 6px 12px;
                    border-radius: 7px;
                    border: 1px solid rgba(239, 68, 68, 0.3);
                    background: var(--danger);
                    color: white;
                    font-size: 12px;
                    cursor: pointer;
                  "
                >
                  确认重置
                </button>
                <button
                  type="button"
                  @click="confirmReset = null"
                  style="
                    padding: 6px 12px;
                    border-radius: 7px;
                    border: 1px solid var(--border);
                    background: transparent;
                    color: var(--text-2);
                    font-size: 12px;
                    cursor: pointer;
                  "
                >
                  取消
                </button>
              </div>
            </template>
            <template v-else>
              <button
                type="button"
                @click="confirmReset = 'records'"
                style="
                  display: inline-flex;
                  align-items: center;
                  gap: 6px;
                  align-self: flex-start;
                  padding: 6px 12px;
                  border-radius: 7px;
                  font-size: 12px;
                  border: 1px solid rgba(239, 68, 68, 0.25);
                  background: transparent;
                  color: var(--danger);
                  cursor: pointer;
                "
              >
                清空学习记录
              </button>
              <button
                type="button"
                @click="confirmReset = 'all'"
                style="
                  display: inline-flex;
                  align-items: center;
                  gap: 6px;
                  align-self: flex-start;
                  padding: 6px 12px;
                  border-radius: 7px;
                  font-size: 12px;
                  border: 1px solid rgba(239, 68, 68, 0.25);
                  background: var(--danger-light);
                  color: var(--danger);
                  cursor: pointer;
                "
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
                重置全部数据
              </button>
            </template>
          </div>
        </template>

        <!-- ─── Sync Tab ─── -->
        <template v-if="tab === 'sync'">
          <div
            style="
              display: flex;
              align-items: center;
              gap: 8px;
              margin-bottom: 4px;
            "
          >
            <div
              style="
                width: 28px;
                height: 28px;
                border-radius: 8px;
                background: var(--primary-light);
                color: var(--primary);
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
              "
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path
                  d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
                />
              </svg>
            </div>
            <span style="font-size: 13px; font-weight: 600; color: var(--text)"
              >云同步</span
            >
          </div>

          <p style="font-size: 12px; color: var(--text-3); line-height: 1.5">
            通过 GitHub Gist 进行数据同步。无需创建仓库，一键备份与恢复。
          </p>

          <!-- GitHub Login -->
          <template v-if="!authStore.isLoggedIn">
            <button
              type="button"
              @click="authStore.login()"
              :disabled="authStore.loading"
              style="
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                width: 100%;
                padding: 10px 16px;
                border-radius: 10px;
                font-size: 13px;
                font-weight: 600;
                border: 1px solid var(--border);
                background: var(--surface);
                color: var(--text);
                cursor: pointer;
                transition: all 0.15s;
              "
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path
                  d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
                />
              </svg>
              {{ authStore.loading ? "登录中..." : "使用 GitHub 登录" }}
            </button>
          </template>

          <template v-if="authStore.isLoggedIn">
            <!-- User info -->
            <div
              style="
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 12px;
                border-radius: 10px;
                background: var(--surface-2);
              "
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path
                  d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
                />
              </svg>
              <span style="font-size: 13px; color: var(--text)">{{
                authStore.user?.login
              }}</span>
              <button
                type="button"
                @click="authStore.logout()"
                style="
                  margin-left: auto;
                  font-size: 11px;
                  color: var(--text-3);
                  background: none;
                  border: none;
                  cursor: pointer;
                "
              >
                退出
              </button>
            </div>

            <!-- Sync actions -->
            <div style="display: flex; gap: 8px">
              <button
                type="button"
                @click="handleSyncPush"
                :disabled="syncPushing"
                style="
                  flex: 1;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  gap: 6px;
                  padding: 8px 12px;
                  border-radius: 9px;
                  font-size: 12px;
                  font-weight: 500;
                  border: 1px solid var(--border);
                  background: var(--surface);
                  color: var(--text-2);
                  cursor: pointer;
                  transition: all 0.15s;
                "
              >
                {{ syncPushing ? "上传中..." : "上传" }}
              </button>
              <button
                type="button"
                @click="handleSyncPull"
                :disabled="syncPulling"
                style="
                  flex: 1;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  gap: 6px;
                  padding: 8px 12px;
                  border-radius: 9px;
                  font-size: 12px;
                  font-weight: 500;
                  border: 1px solid var(--border);
                  background: var(--surface);
                  color: var(--text-2);
                  cursor: pointer;
                  transition: all 0.15s;
                "
              >
                {{ syncPulling ? "拉取中..." : "拉取" }}
              </button>
            </div>

            <button
              type="button"
              @click="handleSyncDelete"
              :disabled="syncDeleting"
              style="
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                padding: 8px 12px;
                border-radius: 9px;
                font-size: 12px;
                border: 1px solid rgba(239, 68, 68, 0.2);
                background: transparent;
                color: var(--danger);
                cursor: pointer;
                transition: all 0.15s;
              "
            >
              {{ syncDeleting ? "删除中..." : "删除云端备份" }}
            </button>

            <!-- Last sync result -->
            <div
              v-if="lastSyncResult"
              :style="{
                padding: '10px 12px',
                borderRadius: '9px',
                fontSize: '12px',
                lineHeight: 1.5,
                background: lastSyncResult.ok
                  ? 'var(--success-light)'
                  : 'var(--danger-light)',
                color: lastSyncResult.ok ? 'var(--success)' : 'var(--danger)',
              }"
            >
              <div style="font-weight: 600; margin-bottom: 2px">
                {{ lastSyncResult.ok ? "✓" : "✗" }}
                {{ lastSyncResult.ok ? "同步成功" : "同步失败" }}
              </div>
              <div style="opacity: 0.85">{{ lastSyncResult.message }}</div>
              <div
                v-if="lastSyncResult.at"
                style="margin-top: 4px; opacity: 0.7; font-size: 11px"
              >
                {{ formatBackupTime(lastSyncResult.at) }}
              </div>
            </div>
          </template>
        </template>
      </div>

      <!-- Footer -->
      <div style="border-top: 1px solid var(--border-subtle); flex-shrink: 0">
        <!-- GitHub link -->
        <div
          style="
            padding: 10px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
          "
        >
          <a
            href="https://github.com/lokidundun/GrimoireFace"
            target="_blank"
            rel="noopener noreferrer"
            style="
              display: flex;
              align-items: center;
              gap: 7px;
              font-size: 12px;
              color: var(--text-3);
              text-decoration: none;
              transition: color 0.15s;
            "
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
              />
            </svg>
            GrimoireFace
          </a>
          <span style="font-size: 11px; color: var(--text-3)">v1.0.0</span>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <div
      v-if="toast"
      :style="{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        background:
          toast.type === 'success'
            ? 'var(--success)'
            : toast.type === 'error'
            ? 'var(--danger)'
            : 'var(--primary)',
        color: 'white',
        padding: '8px 16px',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: 500,
        boxShadow: 'var(--shadow-lg)',
        animation: 'slide-up 0.2s var(--ease-out) both',
        whiteSpace: 'nowrap',
        maxWidth: '90vw',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }"
    >
      {{ toast.message }}
    </div>
  </template>
</template>

<style scoped>
@keyframes drawer-slide-in {
  from {
    transform: translateX(100%);
    opacity: 0.8;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
@keyframes slide-up {
  from {
    transform: translateX(-50%) translateY(10px);
    opacity: 0;
  }
  to {
    transform: translateX(-50%) translateY(0);
    opacity: 1;
  }
}
.settings-tab-label {
  display: inline;
}
@media (max-width: 400px) {
  .settings-tab-label {
    display: none !important;
  }
}
@media (max-width: 420px) {
  .settings-data-stats-grid,
  .settings-import-preview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }
}
</style>
