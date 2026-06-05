<script setup lang="ts">
import { computed, ref } from 'vue'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'

const props = defineProps<{ content: string }>()

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return `<pre class="hljs-code-block"><div class="code-header"><span class="code-lang">${lang}</span><button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.hljs-code-block').querySelector('code').textContent).then(()=>{this.textContent='已复制';setTimeout(()=>{this.textContent='复制'},1500)})">复制</button></div><code class="hljs language-${lang}">${hljs.highlight(str, { language: lang }).value}</code></pre>`
    }
    return `<pre class="hljs-code-block"><div class="code-header"><button class="copy-btn" onclick="navigator.clipboard.writeText(this.closest('.hljs-code-block').querySelector('code').textContent).then(()=>{this.textContent='已复制';setTimeout(()=>{this.textContent='复制'},1500)})">复制</button></div><code>${md.utils.escapeHtml(str)}</code></pre>`
  },
})

const html = computed(() => md.render(props.content))
</script>

<template>
  <div class="markdown-body" v-html="html" />
</template>

<style scoped>
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  font-weight: 700;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}
.markdown-body :deep(h1) { font-size: 1.5em; }
.markdown-body :deep(h2) { font-size: 1.3em; }
.markdown-body :deep(h3) { font-size: 1.15em; }

.markdown-body :deep(p) {
  margin-bottom: 0.75em;
  line-height: 1.7;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.5em;
  margin-bottom: 0.75em;
}
.markdown-body :deep(li) {
  margin-bottom: 0.25em;
}

.markdown-body :deep(code) {
  background: var(--surface-2, #f3f4f6);
  padding: 0.15em 0.4em;
  border-radius: 0.25em;
  font-size: 0.9em;
  font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
}

.markdown-body :deep(.hljs-code-block) {
  position: relative;
  background: #1e1e2e;
  border-radius: 0.5em;
  margin: 1em 0;
  overflow: hidden;
}
.markdown-body :deep(.hljs-code-block code) {
  display: block;
  padding: 1em;
  overflow-x: auto;
  background: transparent;
  color: #cdd6f4;
  font-size: 0.875em;
  line-height: 1.6;
}
.markdown-body :deep(.code-header) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4em 1em;
  background: #181825;
  font-size: 0.8em;
  color: #a6adc8;
}
.markdown-body :deep(.copy-btn) {
  background: transparent;
  border: 1px solid #45475a;
  color: #cdd6f4;
  padding: 0.15em 0.6em;
  border-radius: 0.25em;
  cursor: pointer;
  font-size: 0.85em;
}
.markdown-body :deep(.copy-btn:hover) {
  background: #313244;
}

.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--primary, #6366f1);
  padding-left: 1em;
  color: var(--text-2, #6b7280);
  margin: 1em 0;
}

.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
}
.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--border, #e5e7eb);
  padding: 0.5em 0.75em;
  text-align: left;
}
.markdown-body :deep(th) {
  background: var(--surface-2, #f3f4f6);
  font-weight: 600;
}

.markdown-body :deep(img) {
  max-width: 100%;
  border-radius: 0.5em;
}

.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border, #e5e7eb);
  margin: 1.5em 0;
}

.markdown-body :deep(a) {
  color: var(--primary, #6366f1);
  text-decoration: underline;
}
</style>
