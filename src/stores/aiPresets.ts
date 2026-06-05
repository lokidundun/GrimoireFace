export type AIProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "azure"
  | "xai"
  | "mistral"
  | "groq"
  | "deepseek"
  | "cohere"
  | "perplexity"
  | "togetherai"
  | "cerebras"
  | "openrouter"
  | "amazon-bedrock"
  | "gitlab"
  | "dashscope"
  | "zhipu"
  | "siliconflow"
  | "fireworks"
  | "novita"
  | "hyperbolic"
  | "deepinfra"
  | "vercel"
  | "xiaomi"
  | "alibaba"
  | "alibaba-cn"
  | "moonshotai"
  | "moonshotai-cn"
  | "bailing"
  | "baseten"
  | "chutes"
  | "friendli"
  | "github-models"
  | "helicone"
  | "huggingface"
  | "iflowcn"
  | "inception"
  | "inference"
  | "io-net"
  | "llama"
  | "lmstudio"
  | "lucidquery"
  | "modelscope"
  | "nano-gpt"
  | "nebius"
  | "nvidia"
  | "ollama-cloud"
  | "opencode"
  | "ovhcloud"
  | "poe"
  | "requesty"
  | "scaleway"
  | "siliconflow-cn"
  | "submodel"
  | "synthetic"
  | "upstage"
  | "venice"
  | "vultr"
  | "wandb"
  | "zai"
  | "zai-coding-plan"
  | "zenmux"
  | "custom";

export interface AIModelPreset {
  label: string;
  value: string;
  description?: string;
  recommended?: boolean;
}

export interface AIProviderPreset {
  id: AIProviderId;
  label: string;
  shortLabel: string;
  baseUrl: string;
  defaultModel: string;
  apiKeyPlaceholder: string;
  note: string;
  models: AIModelPreset[];
}

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI 官方",
    shortLabel: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.4-mini",
    apiKeyPlaceholder: "sk-...",
    note: "官方 Chat Completions 兼容模型，默认选择速度、质量和成本更均衡的 GPT-5.4 mini。",
    models: [
      {
        label: "GPT-5.4 Mini",
        value: "gpt-5.4-mini",
        description: "推荐：面试教练、代码解释、日常问答",
        recommended: true,
      },
      {
        label: "GPT-5.5",
        value: "gpt-5.5",
        description: "旗舰：复杂推理和高质量编码",
      },
      {
        label: "GPT-5.4",
        value: "gpt-5.4",
        description: "高质量：复杂任务成本更低",
      },
      {
        label: "GPT-5.4 Nano",
        value: "gpt-5.4-nano",
        description: "轻量：更低延迟和成本",
      },
      { label: "GPT-4.1", value: "gpt-4.1", description: "非推理通用模型" },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek 官方",
    shortLabel: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    apiKeyPlaceholder: "sk-...",
    note: "DeepSeek V4 官方模型。deepseek-chat / deepseek-reasoner 是旧兼容名，将于 2026-07-24 废弃。",
    models: [
      {
        label: "DeepSeek V4 Flash",
        value: "deepseek-v4-flash",
        description: "推荐：速度快、成本低，适合常规问答和代码辅助",
        recommended: true,
      },
      {
        label: "DeepSeek V4 Pro",
        value: "deepseek-v4-pro",
        description: "更强：复杂推理、长上下文和高质量代码任务",
      },
    ],
  },
  {
    id: "dashscope",
    label: "阿里云百炼 DashScope",
    shortLabel: "DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.6-flash",
    apiKeyPlaceholder: "sk-...",
    note: "使用 DashScope 的 OpenAI 兼容模式，适合接入 Qwen 系列文本模型。",
    models: [
      {
        label: "Qwen3.6 Flash",
        value: "qwen3.6-flash",
        description: "推荐：低成本、长上下文、常规学习助手",
        recommended: true,
      },
      {
        label: "Qwen3.6 Plus",
        value: "qwen3.6-plus",
        description: "均衡：更强质量和 1M 上下文",
      },
      {
        label: "Qwen3.6 Max Preview",
        value: "qwen3.6-max-preview",
        description: "预览：复杂任务和更强推理",
      },
      {
        label: "Qwen3.5 Flash",
        value: "qwen3.5-flash",
        description: "稳定低成本选项",
      },
      {
        label: "Qwen3.5 Plus",
        value: "qwen3.5-plus",
        description: "稳定均衡选项",
      },
    ],
  },
  {
    id: "alibaba",
    label: "Alibaba Cloud (国际)",
    shortLabel: "Alibaba",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    apiKeyPlaceholder: "sk-...",
    note: "阿里云国际版 OpenAI 兼容接口，使用 DashScope API Key。",
    models: [
      {
        label: "Qwen Plus",
        value: "qwen-plus",
        description: "推荐：均衡的质量和成本",
        recommended: true,
      },
      { label: "Qwen Max", value: "qwen-max", description: "最强推理能力" },
      { label: "Qwen Turbo", value: "qwen-turbo", description: "高速低成本" },
      { label: "Qwen Flash", value: "qwen-flash", description: "轻量快速" },
    ],
  },
  {
    id: "alibaba-cn",
    label: "Alibaba Cloud (中国)",
    shortLabel: "Alibaba CN",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    apiKeyPlaceholder: "sk-...",
    note: "阿里云中国版 OpenAI 兼容接口，与 DashScope 共用端点。",
    models: [
      {
        label: "Qwen Plus",
        value: "qwen-plus",
        description: "推荐：均衡的质量和成本",
        recommended: true,
      },
      { label: "Qwen Max", value: "qwen-max", description: "最强推理能力" },
      { label: "Qwen Turbo", value: "qwen-turbo", description: "高速低成本" },
      { label: "Qwen Flash", value: "qwen-flash", description: "轻量快速" },
    ],
  },
  {
    id: "zhipu",
    label: "智谱 Z.ai / GLM",
    shortLabel: "GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-5.1",
    apiKeyPlaceholder: "填写智谱 API Key",
    note: "智谱 OpenAI 兼容接口，GLM-5.1 是当前旗舰文本模型。",
    models: [
      {
        label: "GLM-5.1",
        value: "glm-5.1",
        description: "推荐：旗舰模型，适合复杂编码和 Agent 任务",
        recommended: true,
      },
      {
        label: "GLM-5",
        value: "glm-5",
        description: "通用 Agentic Engineering 基座",
      },
      {
        label: "GLM-4.6",
        value: "glm-4.6",
        description: "强代码能力，200K 上下文",
      },
      {
        label: "GLM-4.6 Flash",
        value: "glm-4.6-flash",
        description: "轻量低成本选项",
      },
    ],
  },
  {
    id: "zai",
    label: "Z.AI",
    shortLabel: "Z.AI",
    baseUrl: "https://api.z.ai/api/paas/v4",
    defaultModel: "glm-4.7",
    apiKeyPlaceholder: "填写 Z.AI API Key",
    note: "Z.AI OpenAI 兼容接口。",
    models: [
      {
        label: "GLM-4.7",
        value: "glm-4.7",
        description: "推荐：最新旗舰模型",
        recommended: true,
      },
      { label: "GLM-4.5", value: "glm-4.5", description: "强代码能力" },
      {
        label: "GLM-4.5 Flash",
        value: "glm-4.5-flash",
        description: "轻量快速",
      },
    ],
  },
  {
    id: "zai-coding-plan",
    label: "Z.AI Coding Plan",
    shortLabel: "Z.AI Coding",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    defaultModel: "glm-4.7",
    apiKeyPlaceholder: "填写 Z.AI API Key",
    note: "Z.AI Coding 专用端点。",
    models: [
      {
        label: "GLM-4.7",
        value: "glm-4.7",
        description: "推荐：Coding 专用",
        recommended: true,
      },
      { label: "GLM-4.5", value: "glm-4.5", description: "强代码能力" },
    ],
  },
  {
    id: "xiaomi",
    label: "Xiaomi MiMo",
    shortLabel: "Xiaomi",
    baseUrl: "https://api.xiaomimimo.com/v1",
    defaultModel: "mimo-v2-flash",
    apiKeyPlaceholder: "填写 Xiaomi API Key",
    note: "小米 MiMo 系列模型 OpenAI 兼容接口。",
    models: [
      {
        label: "MiMo-V2-Flash",
        value: "mimo-v2-flash",
        description: "推荐：小米自研推理模型",
        recommended: true,
      },
    ],
  },
  {
    id: "moonshotai",
    label: "Moonshot AI (Kimi)",
    shortLabel: "Moonshot",
    baseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k2-turbo-preview",
    apiKeyPlaceholder: "填写 Moonshot API Key",
    note: "月之暗面 Kimi 系列模型 OpenAI 兼容接口。",
    models: [
      {
        label: "Kimi K2 Turbo",
        value: "kimi-k2-turbo-preview",
        description: "推荐：速度快、成本低",
        recommended: true,
      },
      {
        label: "Kimi K2 Thinking",
        value: "kimi-k2-thinking",
        description: "推理模型",
      },
      {
        label: "Kimi K2 Thinking Turbo",
        value: "kimi-k2-thinking-turbo",
        description: "推理模型加速版",
      },
    ],
  },
  {
    id: "moonshotai-cn",
    label: "Moonshot AI 中国 (Kimi)",
    shortLabel: "Moonshot CN",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2-turbo-preview",
    apiKeyPlaceholder: "填写 Moonshot API Key",
    note: "月之暗面 Kimi 中国版 OpenAI 兼容接口。",
    models: [
      {
        label: "Kimi K2 Turbo",
        value: "kimi-k2-turbo-preview",
        description: "推荐：速度快、成本低",
        recommended: true,
      },
      {
        label: "Kimi K2 Thinking",
        value: "kimi-k2-thinking",
        description: "推理模型",
      },
      {
        label: "Kimi K2 Thinking Turbo",
        value: "kimi-k2-thinking-turbo",
        description: "推理模型加速版",
      },
    ],
  },
  {
    id: "bailing",
    label: "Bailing",
    shortLabel: "Bailing",
    baseUrl: "https://api.tbox.cn/api/llm/v1/chat/completions",
    defaultModel: "Ling-1T",
    apiKeyPlaceholder: "填写 Bailing API Key",
    note: "Bailing OpenAI 兼容接口。",
    models: [
      {
        label: "Ling-1T",
        value: "Ling-1T",
        description: "推荐：旗舰模型",
        recommended: true,
      },
      { label: "Ring-1T", value: "Ring-1T", description: "轻量模型" },
    ],
  },
  {
    id: "baseten",
    label: "Baseten",
    shortLabel: "Baseten",
    baseUrl: "https://inference.baseten.co/v1",
    defaultModel: "moonshotai/Kimi-K2-Instruct-0905",
    apiKeyPlaceholder: "填写 Baseten API Key",
    note: "Baseten 开源模型推理平台。",
    models: [
      {
        label: "Kimi K2 Instruct",
        value: "moonshotai/Kimi-K2-Instruct-0905",
        description: "推荐：Kimi K2",
        recommended: true,
      },
      {
        label: "Kimi K2 Thinking",
        value: "moonshotai/Kimi-K2-Thinking",
        description: "Kimi K2 推理版",
      },
    ],
  },
  {
    id: "chutes",
    label: "Chutes",
    shortLabel: "Chutes",
    baseUrl: "https://llm.chutes.ai/v1",
    defaultModel: "NousResearch/Hermes-4.3-36B",
    apiKeyPlaceholder: "填写 Chutes API Key",
    note: "Chutes 去中心化推理平台。",
    models: [
      {
        label: "Hermes 4.3 36B",
        value: "NousResearch/Hermes-4.3-36B",
        description: "推荐：Nous Research 模型",
        recommended: true,
      },
    ],
  },
  {
    id: "friendli",
    label: "Friendli",
    shortLabel: "Friendli",
    baseUrl: "https://api.friendli.ai/serverless/v1",
    defaultModel: "meta-llama-3.3-70b-instruct",
    apiKeyPlaceholder: "填写 Friendli API Key",
    note: "Friendli 推理平台。",
    models: [
      {
        label: "Llama 3.3 70B",
        value: "meta-llama-3.3-70b-instruct",
        description: "推荐：Meta 开源模型",
        recommended: true,
      },
    ],
  },
  {
    id: "github-models",
    label: "GitHub Models",
    shortLabel: "GitHub Models",
    baseUrl: "https://models.github.ai/inference",
    defaultModel: "xai/grok-3",
    apiKeyPlaceholder: "填写 GitHub Token",
    note: "GitHub Models 推理服务。",
    models: [
      {
        label: "Grok 3",
        value: "xai/grok-3",
        description: "推荐：xAI 旗舰模型",
        recommended: true,
      },
      {
        label: "Grok 3 Mini",
        value: "xai/grok-3-mini",
        description: "轻量快速",
      },
    ],
  },
  {
    id: "helicone",
    label: "Helicone",
    shortLabel: "Helicone",
    baseUrl: "https://ai-gateway.helicone.ai/v1",
    defaultModel: "gpt-4.1-nano",
    apiKeyPlaceholder: "填写 Helicone API Key",
    note: "Helicone AI 网关，统一访问多种模型。",
    models: [
      {
        label: "GPT-4.1 Nano",
        value: "gpt-4.1-nano",
        description: "推荐：通过 Helicone 访问",
        recommended: true,
      },
    ],
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    shortLabel: "HuggingFace",
    baseUrl: "https://router.huggingface.co/v1",
    defaultModel: "moonshotai/Kimi-K2-Instruct",
    apiKeyPlaceholder: "填写 HF Token",
    note: "Hugging Face 推理 API。",
    models: [
      {
        label: "Kimi K2 Instruct",
        value: "moonshotai/Kimi-K2-Instruct",
        description: "推荐：Kimi K2",
        recommended: true,
      },
      {
        label: "MiniMax M2",
        value: "MiniMaxAI/MiniMax-M2",
        description: "MiniMax 模型",
      },
    ],
  },
  {
    id: "iflowcn",
    label: "iFlow",
    shortLabel: "iFlow",
    baseUrl: "https://apis.iflow.cn/v1",
    defaultModel: "qwen3-coder",
    apiKeyPlaceholder: "填写 iFlow API Key",
    note: "iFlow 中文模型推理平台。",
    models: [
      {
        label: "Qwen3 Coder",
        value: "qwen3-coder",
        description: "推荐：代码专用",
        recommended: true,
      },
      { label: "DeepSeek V3", value: "deepseek-v3", description: "DeepSeek" },
      { label: "Kimi K2", value: "kimi-k2", description: "Kimi" },
    ],
  },
  {
    id: "inception",
    label: "Inception",
    shortLabel: "Inception",
    baseUrl: "https://api.inceptionlabs.ai/v1",
    defaultModel: "mercury-coder",
    apiKeyPlaceholder: "填写 Inception API Key",
    note: "Inception Labs 推理平台。",
    models: [
      {
        label: "Mercury Coder",
        value: "mercury-coder",
        description: "推荐：代码专用模型",
        recommended: true,
      },
      { label: "Mercury", value: "mercury", description: "通用模型" },
    ],
  },
  {
    id: "inference",
    label: "Inference",
    shortLabel: "Inference",
    baseUrl: "https://inference.net/v1",
    defaultModel: "mistral/mistral-nemo-12b-instruct",
    apiKeyPlaceholder: "填写 Inference API Key",
    note: "Inference.net 开源模型推理平台。",
    models: [
      {
        label: "Mistral Nemo 12B",
        value: "mistral/mistral-nemo-12b-instruct",
        description: "推荐：Mistral 轻量模型",
        recommended: true,
      },
    ],
  },
  {
    id: "io-net",
    label: "IO.NET",
    shortLabel: "IO.NET",
    baseUrl: "https://api.intelligence.io.solutions/api/v1",
    defaultModel: "moonshotai/Kimi-K2-Instruct-0905",
    apiKeyPlaceholder: "填写 IO.NET API Key",
    note: "IO.NET 去中心化推理平台。",
    models: [
      {
        label: "Kimi K2 Instruct",
        value: "moonshotai/Kimi-K2-Instruct-0905",
        description: "推荐：Kimi K2",
        recommended: true,
      },
    ],
  },
  {
    id: "llama",
    label: "Llama API",
    shortLabel: "Llama",
    baseUrl: "https://api.llama.com/compat/v1",
    defaultModel: "llama-4-maverick-17b-128e-instruct-fp8",
    apiKeyPlaceholder: "填写 Llama API Key",
    note: "Meta Llama 官方兼容接口。",
    models: [
      {
        label: "Llama 4 Maverick",
        value: "llama-4-maverick-17b-128e-instruct-fp8",
        description: "推荐：最新 Llama 4",
        recommended: true,
      },
      {
        label: "Llama 3.3 70B",
        value: "llama-3.3-70b-instruct",
        description: "Llama 3.3",
      },
    ],
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    shortLabel: "LM Studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    defaultModel: "openai/gpt-oss-20b",
    apiKeyPlaceholder: "无需填写或填任意值",
    note: "LM Studio 本地模型服务，默认端口 1234。",
    models: [
      {
        label: "本地模型",
        value: "openai/gpt-oss-20b",
        description: "推荐：请在 LM Studio 中加载模型",
        recommended: true,
      },
    ],
  },
  {
    id: "lucidquery",
    label: "LucidQuery AI",
    shortLabel: "LucidQuery",
    baseUrl: "https://lucidquery.com/api/v1",
    defaultModel: "lucidquery-nexus-coder",
    apiKeyPlaceholder: "填写 LucidQuery API Key",
    note: "LucidQuery AI 推理平台。",
    models: [
      {
        label: "Nexus Coder",
        value: "lucidquery-nexus-coder",
        description: "推荐：代码专用",
        recommended: true,
      },
      {
        label: "LucidNova RF1 100B",
        value: "lucidnova-rf1-100b",
        description: "大参数模型",
      },
    ],
  },
  {
    id: "modelscope",
    label: "ModelScope",
    shortLabel: "ModelScope",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    defaultModel: "ZhipuAI/GLM-4.5",
    apiKeyPlaceholder: "填写 ModelScope Token",
    note: "魔搭社区模型推理 API。",
    models: [
      {
        label: "GLM-4.5",
        value: "ZhipuAI/GLM-4.5",
        description: "推荐：智谱模型",
        recommended: true,
      },
      {
        label: "GLM-4.6",
        value: "ZhipuAI/GLM-4.6",
        description: "智谱最新模型",
      },
    ],
  },
  {
    id: "nano-gpt",
    label: "NanoGPT",
    shortLabel: "NanoGPT",
    baseUrl: "https://nano-gpt.com/api/v1",
    defaultModel: "moonshotai/kimi-k2-thinking",
    apiKeyPlaceholder: "填写 NanoGPT API Key",
    note: "NanoGPT 模型聚合平台。",
    models: [
      {
        label: "Kimi K2 Thinking",
        value: "moonshotai/kimi-k2-thinking",
        description: "推荐：Kimi 推理模型",
        recommended: true,
      },
    ],
  },
  {
    id: "nebius",
    label: "Nebius Token Factory",
    shortLabel: "Nebius",
    baseUrl: "https://api.tokenfactory.nebius.com/v1",
    defaultModel: "NousResearch/hermes-4-70b",
    apiKeyPlaceholder: "填写 Nebius API Key",
    note: "Nebius 推理平台。",
    models: [
      {
        label: "Hermes 4 70B",
        value: "NousResearch/hermes-4-70b",
        description: "推荐：Nous Research",
        recommended: true,
      },
    ],
  },
  {
    id: "nvidia",
    label: "NVIDIA",
    shortLabel: "NVIDIA",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    defaultModel: "moonshotai/kimi-k2-instruct",
    apiKeyPlaceholder: "填写 NVIDIA API Key",
    note: "NVIDIA NIM 推理服务。",
    models: [
      {
        label: "Kimi K2 Instruct",
        value: "moonshotai/kimi-k2-instruct",
        description: "推荐：Kimi K2",
        recommended: true,
      },
    ],
  },
  {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    shortLabel: "Ollama",
    baseUrl: "https://ollama.com/v1",
    defaultModel: "qwen3-vl-235b-cloud",
    apiKeyPlaceholder: "填写 Ollama Token",
    note: "Ollama Cloud 远程推理服务。",
    models: [
      {
        label: "Qwen3 VL 235B Cloud",
        value: "qwen3-vl-235b-cloud",
        description: "推荐：Qwen3 VL",
        recommended: true,
      },
    ],
  },
  {
    id: "opencode",
    label: "OpenCode Zen",
    shortLabel: "OpenCode",
    baseUrl: "https://opencode.ai/zen/v1",
    defaultModel: "qwen3-coder",
    apiKeyPlaceholder: "填写 OpenCode Token",
    note: "OpenCode Zen 统一网关。",
    models: [
      {
        label: "Qwen3 Coder",
        value: "qwen3-coder",
        description: "推荐：代码专用",
        recommended: true,
      },
      {
        label: "Claude Opus 4.1",
        value: "claude-opus-4-1",
        description: "Anthropic 旗舰",
      },
      { label: "Kimi K2", value: "kimi-k2", description: "Kimi" },
    ],
  },
  {
    id: "ovhcloud",
    label: "OVHcloud AI",
    shortLabel: "OVHcloud",
    baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
    defaultModel: "mixtral-8x7b-instruct-v0.1",
    apiKeyPlaceholder: "填写 OVHcloud Token",
    note: "OVHcloud AI Endpoints。",
    models: [
      {
        label: "Mixtral 8x7B",
        value: "mixtral-8x7b-instruct-v0.1",
        description: "推荐：Mixtral MoE",
        recommended: true,
      },
    ],
  },
  {
    id: "poe",
    label: "Poe",
    shortLabel: "Poe",
    baseUrl: "https://api.poe.com/v1",
    defaultModel: "xai/grok-4-fast-non-reasoning",
    apiKeyPlaceholder: "填写 Poe API Key",
    note: "Poe 第三方 API。",
    models: [
      {
        label: "Grok 4 Fast",
        value: "xai/grok-4-fast-non-reasoning",
        description: "推荐：Grok 4",
        recommended: true,
      },
      {
        label: "Grok 4 Fast Reasoning",
        value: "xai/grok-4-fast-reasoning",
        description: "推理版",
      },
    ],
  },
  {
    id: "requesty",
    label: "Requesty",
    shortLabel: "Requesty",
    baseUrl: "https://router.requesty.ai/v1",
    defaultModel: "xai/grok-4",
    apiKeyPlaceholder: "填写 Requesty API Key",
    note: "Requesty AI 路由平台。",
    models: [
      {
        label: "Grok 4",
        value: "xai/grok-4",
        description: "推荐：xAI 旗舰",
        recommended: true,
      },
      {
        label: "Gemini 3 Flash",
        value: "google/gemini-3-flash-preview",
        description: "Google 模型",
      },
    ],
  },
  {
    id: "scaleway",
    label: "Scaleway",
    shortLabel: "Scaleway",
    baseUrl: "https://api.scaleway.ai/v1",
    defaultModel: "qwen3-235b-a22b-instruct-2507",
    apiKeyPlaceholder: "填写 Scaleway Token",
    note: "Scaleway 欧洲推理平台。",
    models: [
      {
        label: "Qwen3 235B",
        value: "qwen3-235b-a22b-instruct-2507",
        description: "推荐：Qwen3 大参数模型",
        recommended: true,
      },
      {
        label: "Pixtral 12B",
        value: "pixtral-12b-2409",
        description: "Mistral 多模态",
      },
    ],
  },
  {
    id: "siliconflow-cn",
    label: "硅基流动 (中国)",
    shortLabel: "SiliconFlow CN",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V4",
    apiKeyPlaceholder: "sk-...",
    note: "硅基流动中国版高速推理平台。",
    models: [
      {
        label: "DeepSeek V4",
        value: "deepseek-ai/DeepSeek-V4",
        description: "推荐：高速推理",
        recommended: true,
      },
      {
        label: "DeepSeek R1",
        value: "deepseek-ai/DeepSeek-R1",
        description: "推理模型",
      },
    ],
  },
  {
    id: "submodel",
    label: "submodel",
    shortLabel: "submodel",
    baseUrl: "https://llm.submodel.ai/v1",
    defaultModel: "openai/gpt-oss-120b",
    apiKeyPlaceholder: "填写 submodel API Key",
    note: "submodel 开源推理平台。",
    models: [
      {
        label: "GPT-OSS 120B",
        value: "openai/gpt-oss-120b",
        description: "推荐：OpenAI 开源",
        recommended: true,
      },
    ],
  },
  {
    id: "synthetic",
    label: "Synthetic",
    shortLabel: "Synthetic",
    baseUrl: "https://api.synthetic.new/v1",
    defaultModel: "hf:Qwen/Qwen3-235B-A22B-Instruct-2507",
    apiKeyPlaceholder: "填写 Synthetic API Key",
    note: "Synthetic 推理平台。",
    models: [
      {
        label: "Qwen3 235B",
        value: "hf:Qwen/Qwen3-235B-A22B-Instruct-2507",
        description: "推荐：Qwen3 大参数",
        recommended: true,
      },
    ],
  },
  {
    id: "upstage",
    label: "Upstage",
    shortLabel: "Upstage",
    baseUrl: "https://api.upstage.ai",
    defaultModel: "solar-mini",
    apiKeyPlaceholder: "填写 Upstage API Key",
    note: "Upstage Solar 系列模型。",
    models: [
      {
        label: "Solar Mini",
        value: "solar-mini",
        description: "推荐：轻量快速",
        recommended: true,
      },
      { label: "Solar Pro2", value: "solar-pro2", description: "专业版" },
    ],
  },
  {
    id: "venice",
    label: "Venice AI",
    shortLabel: "Venice",
    baseUrl: "https://api.venice.ai/api/v1",
    defaultModel: "qwen3-235b-a22b-instruct-2507",
    apiKeyPlaceholder: "填写 Venice API Key",
    note: "Venice AI 隐私优先推理平台。",
    models: [
      {
        label: "Qwen3 235B",
        value: "qwen3-235b-a22b-instruct-2507",
        description: "推荐：隐私优先",
        recommended: true,
      },
    ],
  },
  {
    id: "vultr",
    label: "Vultr",
    shortLabel: "Vultr",
    baseUrl: "https://api.vultrinference.com/v1",
    defaultModel: "deepseek-r1-distill-qwen-32b",
    apiKeyPlaceholder: "填写 Vultr API Key",
    note: "Vultr 推理平台。",
    models: [
      {
        label: "DeepSeek R1 Distill Qwen 32B",
        value: "deepseek-r1-distill-qwen-32b",
        description: "推荐：蒸馏推理模型",
        recommended: true,
      },
      {
        label: "Kimi K2 Instruct",
        value: "kimi-k2-instruct",
        description: "Kimi K2",
      },
    ],
  },
  {
    id: "wandb",
    label: "Weights & Biases",
    shortLabel: "W&B",
    baseUrl: "https://api.inference.wandb.ai/v1",
    defaultModel: "moonshotai/Kimi-K2-Instruct",
    apiKeyPlaceholder: "填写 W&B API Key",
    note: "Weights & Biases 推理服务。",
    models: [
      {
        label: "Kimi K2 Instruct",
        value: "moonshotai/Kimi-K2-Instruct",
        description: "推荐：Kimi K2",
        recommended: true,
      },
    ],
  },
  {
    id: "zenmux",
    label: "ZenMux",
    shortLabel: "ZenMux",
    baseUrl: "https://zenmux.ai/api/v1",
    defaultModel: "stepfun/step-3",
    apiKeyPlaceholder: "填写 ZenMux API Key",
    note: "ZenMux 模型聚合网关。",
    models: [
      {
        label: "Step 3",
        value: "stepfun/step-3",
        description: "推荐：阶跃星辰",
        recommended: true,
      },
      {
        label: "Kimi K2 Thinking Turbo",
        value: "moonshotai/kimi-k2-thinking-turbo",
        description: "Kimi 推理加速版",
      },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    shortLabel: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-5.4-mini",
    apiKeyPlaceholder: "sk-or-...",
    note: "模型聚合平台，一个 API Key 访问全球主流模型。",
    models: [
      {
        label: "GPT-5.4 Mini",
        value: "openai/gpt-5.4-mini",
        description: "推荐：低成本均衡选择",
        recommended: true,
      },
      {
        label: "Claude Sonnet 4",
        value: "anthropic/claude-sonnet-4",
        description: "Anthropic 旗舰代码模型",
      },
      {
        label: "Gemini 2.5 Pro",
        value: "google/gemini-2.5-pro-preview",
        description: "Google 最强推理模型",
      },
      {
        label: "DeepSeek V4",
        value: "deepseek/deepseek-chat",
        description: "DeepSeek 官方 via OpenRouter",
      },
      {
        label: "Qwen3.6 72B",
        value: "qwen/qwen3.6-72b",
        description: "阿里 Qwen 开源模型",
      },
    ],
  },
  {
    id: "siliconflow",
    label: "硅基流动 SiliconFlow",
    shortLabel: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "deepseek-ai/DeepSeek-V4",
    apiKeyPlaceholder: "sk-...",
    note: "国内高速模型推理平台，支持 DeepSeek、Qwen、Llama 等主流开源模型。",
    models: [
      {
        label: "DeepSeek V4",
        value: "deepseek-ai/DeepSeek-V4",
        description: "推荐：高速推理、低成本",
        recommended: true,
      },
      {
        label: "DeepSeek R1",
        value: "deepseek-ai/DeepSeek-R1",
        description: "推理模型，适合数学和代码",
      },
      {
        label: "Qwen3.6 72B",
        value: "Qwen/Qwen3.6-72B",
        description: "阿里开源模型",
      },
      {
        label: "Llama 4 Maverick",
        value: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        description: "Meta 最新开源模型",
      },
    ],
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    shortLabel: "xAI",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-3-beta",
    apiKeyPlaceholder: "xai-...",
    note: "xAI 官方 OpenAI 兼容接口，Grok 系列模型。",
    models: [
      {
        label: "Grok 3",
        value: "grok-3-beta",
        description: "推荐：xAI 旗舰模型",
        recommended: true,
      },
      {
        label: "Grok 3 Mini",
        value: "grok-3-mini-beta",
        description: "轻量快速",
      },
    ],
  },
  {
    id: "groq",
    label: "Groq",
    shortLabel: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "meta-llama/llama-4-scout-17b-16e-instruct",
    apiKeyPlaceholder: "gsk_...",
    note: "超高速推理平台，Llama 和 Mixtral 系列模型响应极快。",
    models: [
      {
        label: "Llama 4 Scout",
        value: "meta-llama/llama-4-scout-17b-16e-instruct",
        description: "推荐：超高速、低成本",
        recommended: true,
      },
      {
        label: "Llama 4 Maverick",
        value: "meta-llama/llama-4-maverick-17b-128e-instruct",
        description: "更强质量",
      },
      {
        label: "Mixtral 8x7B",
        value: "mixtral-8x7b-32768",
        description: "Mixtral MoE 模型",
      },
    ],
  },
  {
    id: "mistral",
    label: "Mistral AI",
    shortLabel: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    apiKeyPlaceholder: "填写 Mistral API Key",
    note: "Mistral 官方 OpenAI 兼容接口。",
    models: [
      {
        label: "Mistral Large",
        value: "mistral-large-latest",
        description: "推荐：旗舰多语言模型",
        recommended: true,
      },
      {
        label: "Mistral Medium",
        value: "mistral-medium-latest",
        description: "均衡选择",
      },
      {
        label: "Codestral",
        value: "codestral-latest",
        description: "代码专用模型",
      },
    ],
  },
  {
    id: "togetherai",
    label: "Together AI",
    shortLabel: "Together",
    baseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
    apiKeyPlaceholder: "填写 Together API Key",
    note: "开源模型推理平台，支持 Llama、DeepSeek、Qwen 等。",
    models: [
      {
        label: "Llama 4 Maverick",
        value: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        description: "推荐：Meta 最新开源模型",
        recommended: true,
      },
      {
        label: "DeepSeek V3",
        value: "deepseek-ai/DeepSeek-V3",
        description: "DeepSeek 开源模型",
      },
      {
        label: "Qwen3 32B",
        value: "Qwen/Qwen3-32B",
        description: "阿里开源模型",
      },
    ],
  },
  {
    id: "perplexity",
    label: "Perplexity",
    shortLabel: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    defaultModel: "sonar-pro",
    apiKeyPlaceholder: "pplx-...",
    note: "Perplexity 官方 API，带联网搜索能力。",
    models: [
      {
        label: "Sonar Pro",
        value: "sonar-pro",
        description: "推荐：带搜索的高级模型",
        recommended: true,
      },
      {
        label: "Sonar Reasoning Pro",
        value: "sonar-reasoning-pro",
        description: "推理+搜索",
      },
    ],
  },
  {
    id: "cerebras",
    label: "Cerebras",
    shortLabel: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "llama-4-scout-17b-16e-instruct",
    apiKeyPlaceholder: "csk-...",
    note: "Cerebras 高速推理平台，基于自研 AI 加速器。",
    models: [
      {
        label: "Llama 4 Scout",
        value: "llama-4-scout-17b-16e-instruct",
        description: "推荐：超高速推理",
        recommended: true,
      },
    ],
  },
  {
    id: "cohere",
    label: "Cohere",
    shortLabel: "Cohere",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    defaultModel: "command-a-03-2025",
    apiKeyPlaceholder: "填写 Cohere API Key",
    note: "Cohere 官方 OpenAI 兼容接口。",
    models: [
      {
        label: "Command A",
        value: "command-a-03-2025",
        description: "推荐：旗舰企业级模型",
        recommended: true,
      },
      {
        label: "Command R7B",
        value: "command-r7b-12-2024",
        description: "轻量高效",
      },
    ],
  },
  {
    id: "google",
    label: "Google Gemini",
    shortLabel: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-2.5-flash-preview-04-17",
    apiKeyPlaceholder: "填写 Gemini API Key",
    note: "Google Gemini OpenAI 兼容接口。",
    models: [
      {
        label: "Gemini 2.5 Flash",
        value: "gemini-2.5-flash-preview-04-17",
        description: "推荐：速度快、成本低",
        recommended: true,
      },
      {
        label: "Gemini 2.5 Pro",
        value: "gemini-2.5-pro-preview-03-25",
        description: "最强推理质量",
      },
      {
        label: "Gemini 2.0 Flash",
        value: "gemini-2.0-flash",
        description: "稳定快速",
      },
    ],
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    shortLabel: "Fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    defaultModel: "accounts/fireworks/models/llama4-maverick-instruct-basic",
    apiKeyPlaceholder: "填写 Fireworks API Key",
    note: "Fireworks 开源模型推理平台。",
    models: [
      {
        label: "Llama 4 Maverick",
        value: "accounts/fireworks/models/llama4-maverick-instruct-basic",
        description: "推荐：高速开源模型",
        recommended: true,
      },
      {
        label: "Llama 4 Scout",
        value: "accounts/fireworks/models/llama4-scout-instruct-basic",
        description: "轻量快速",
      },
    ],
  },
  {
    id: "novita",
    label: "Novita AI",
    shortLabel: "Novita",
    baseUrl: "https://api.novita.ai/v3/openai",
    defaultModel: "meta-llama/llama-4-maverick-17b-128e-instruct-fp8",
    apiKeyPlaceholder: "填写 Novita API Key",
    note: "Novita AI 开源模型推理平台。",
    models: [
      {
        label: "Llama 4 Maverick",
        value: "meta-llama/llama-4-maverick-17b-128e-instruct-fp8",
        description: "推荐：高速开源模型",
        recommended: true,
      },
      {
        label: "DeepSeek V3",
        value: "deepseek/deepseek-v3-0324",
        description: "DeepSeek 开源模型",
      },
    ],
  },
  {
    id: "hyperbolic",
    label: "Hyperbolic",
    shortLabel: "Hyperbolic",
    baseUrl: "https://api.hyperbolic.xyz/v1",
    defaultModel: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
    apiKeyPlaceholder: "eyJhbG...",
    note: "Hyperbolic 去中心化 AI 推理平台。",
    models: [
      {
        label: "Llama 4 Maverick",
        value: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        description: "推荐：高速去中心化推理",
        recommended: true,
      },
      {
        label: "DeepSeek V3",
        value: "deepseek-ai/DeepSeek-V3",
        description: "DeepSeek 开源模型",
      },
    ],
  },
  {
    id: "azure",
    label: "Azure OpenAI",
    shortLabel: "Azure",
    baseUrl: "",
    defaultModel: "gpt-5.5",
    apiKeyPlaceholder: "填写 Azure API Key",
    note: "Azure OpenAI Service，需自行填写部署端点 Base URL。",
    models: [
      {
        label: "GPT-5.5",
        value: "gpt-5.5",
        description: "推荐：Azure 部署的 GPT 旗舰",
        recommended: true,
      },
      {
        label: "GPT-5.4",
        value: "gpt-5.4",
        description: "高质量选择",
      },
      {
        label: "GPT-5.4 Mini",
        value: "gpt-5.4-mini",
        description: "轻量低成本",
      },
    ],
  },
  {
    id: "deepinfra",
    label: "DeepInfra",
    shortLabel: "DeepInfra",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    defaultModel: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
    apiKeyPlaceholder: "填写 DeepInfra API Key",
    note: "DeepInfra 开源模型推理平台。",
    models: [
      {
        label: "Llama 4 Maverick",
        value: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        description: "推荐：高速开源模型",
        recommended: true,
      },
      {
        label: "Llama 4 Scout",
        value: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
        description: "轻量快速",
      },
      {
        label: "DeepSeek V3",
        value: "deepseek-ai/DeepSeek-V3",
        description: "DeepSeek 开源模型",
      },
    ],
  },
  {
    id: "vercel",
    label: "Vercel AI Gateway",
    shortLabel: "Vercel",
    baseUrl: "",
    defaultModel: "gpt-5.4-mini",
    apiKeyPlaceholder: "填写 Vercel AI Token",
    note: "Vercel AI SDK 统一网关，需自行填写网关 Base URL。",
    models: [
      {
        label: "GPT-5.4 Mini",
        value: "gpt-5.4-mini",
        description: "推荐：通过 Vercel 网关访问",
        recommended: true,
      },
      {
        label: "Claude Sonnet 4",
        value: "claude-sonnet-4",
        description: "Anthropic 模型",
      },
      {
        label: "Gemini 2.5 Pro",
        value: "gemini-2.5-pro",
        description: "Google 模型",
      },
    ],
  },
  {
    id: "custom",
    label: "自定义兼容接口",
    shortLabel: "自定义",
    baseUrl: "",
    defaultModel: "",
    apiKeyPlaceholder: "sk-...",
    note: "用于 OpenAI Chat Completions 兼容接口，例如代理网关或自部署模型服务。",
    models: [],
  },
];

export const PRESET_MODELS = [
  ...AI_PROVIDER_PRESETS.flatMap((p) => p.models),
  { label: "自定义", value: "custom" },
];

export const PRESET_BASE_URLS = [
  ...AI_PROVIDER_PRESETS.filter((p) => p.id !== "custom").map((p) => ({
    label: p.label,
    value: p.baseUrl,
  })),
  { label: "自定义", value: "custom" },
];

export function getAIProviderPreset(
  providerId: AIProviderId
): AIProviderPreset {
  return (
    AI_PROVIDER_PRESETS.find((p) => p.id === providerId) ??
    AI_PROVIDER_PRESETS[AI_PROVIDER_PRESETS.length - 1]
  );
}
