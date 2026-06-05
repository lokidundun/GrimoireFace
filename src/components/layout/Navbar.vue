<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStudyStore } from "@/stores/useStudyStore";
import SettingsDrawer from "@/components/layout/SettingsDrawer.vue";

const route = useRoute();
const router = useRouter();
const studyStore = useStudyStore();

const navItems = [
  { path: "/", label: "概览" },
  { path: "/questions", label: "题库" },
  { path: "/practice", label: "练习" },
  { path: "/weak", label: "薄弱点" },
  { path: "/import", label: "导入" },
  {
    path: "/tools",
    label: "工具",
    activePaths: ["/mock-interview", "/prompt"],
  },
] as const;

const scrolled = ref(false);
let scrolledCache = false;

const mobileOpen = ref(false);
const settingsOpen = ref(false);
let animationFrame = 0;

function updateScrolled() {
  animationFrame = 0;
  const next = window.scrollY > 4;
  if (scrolledCache === next) return;
  scrolledCache = next;
  scrolled.value = next;
}

function onScroll() {
  if (animationFrame) return;
  animationFrame = window.requestAnimationFrame(updateScrolled);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") mobileOpen.value = false;
}

onMounted(() => {
  updateScrolled();
  window.addEventListener("scroll", onScroll, { passive: true });
});

// Watch mobileOpen for escape key + body scroll lock
import { watch } from "vue";
watch(mobileOpen, (val) => {
  if (val) {
    window.addEventListener("keydown", onKeydown);
    document.body.style.overflow = "hidden";
  } else {
    window.removeEventListener("keydown", onKeydown);
    document.body.style.overflow = "";
  }
});

function isActive(item: {
  path: string;
  activePaths?: readonly string[];
}): boolean {
  if (item.path === "/") return route.path === "/";
  return [item.path, ...(item.activePaths ?? [])].some((p) =>
    route.path.startsWith(p)
  );
}

function navigateTo(path: string) {
  router.push(path);
  mobileOpen.value = false;
}

const themeLabel = computed(() =>
  studyStore.theme === "dark" ? "切换亮色" : "切换暗色"
);

const iconSize = { width: "15px", height: "15px" };
</script>

<template>
  <header
    class="nav-header"
    :style="{
      borderBottom: scrolled
        ? '1px solid var(--border-subtle)'
        : '1px solid transparent',
      background: scrolled ? 'var(--surface-glass)' : 'transparent',
      backdropFilter: scrolled ? 'saturate(180%) blur(20px)' : 'none',
      WebkitBackdropFilter: scrolled ? 'saturate(180%) blur(20px)' : 'none',
    }"
  >
    <div class="nav-inner">
      <!-- Logo -->
      <RouterLink to="/" class="nav-logo">
        <span class="nav-logo-text">GrimoireFace</span>
      </RouterLink>

      <!-- Desktop nav -->
      <nav class="nav-desktop hidden-mobile">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="nav-link"
          :class="{ 'nav-link-active': isActive(item) }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="nav-spacer show-mobile" />

      <!-- Actions -->
      <div class="nav-actions">
        <!-- Settings button -->
        <button
          type="button"
          aria-label="设置"
          class="nav-icon-btn"
          @click="settingsOpen = true"
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
        </button>

        <!-- Theme toggle -->
        <button
          type="button"
          :aria-label="themeLabel"
          class="nav-icon-btn"
          @click="studyStore.toggleTheme()"
        >
          <!-- Sun icon (dark mode → switch to light) -->
          <svg
            v-if="studyStore.theme === 'dark'"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
          <!-- Moon icon (light mode → switch to dark) -->
          <svg
            v-else
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </button>

        <!-- Mobile hamburger -->
        <button
          type="button"
          aria-label="菜单"
          :aria-expanded="mobileOpen"
          class="nav-icon-btn show-mobile"
          @click="mobileOpen = !mobileOpen"
        >
          <!-- X -->
          <svg
            v-if="mobileOpen"
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
          <!-- Hamburger -->
          <svg
            v-else
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
          >
            <line x1="3" y1="7" x2="21" y2="7" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="17" x2="21" y2="17" />
          </svg>
        </button>
      </div>
    </div>
  </header>

  <!-- Mobile overlay -->
  <button
    v-if="mobileOpen"
    type="button"
    aria-label="关闭菜单"
    class="mobile-overlay"
    @click="mobileOpen = false"
  />

  <!-- Mobile menu -->
  <Transition name="slide-down">
    <div v-if="mobileOpen" class="mobile-menu show-mobile">
      <RouterLink
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="mobile-menu-link"
        :class="{ 'mobile-menu-link-active': isActive(item) }"
        @click="mobileOpen = false"
      >
        {{ item.label }}
        <div v-if="isActive(item)" class="mobile-menu-dot" />
      </RouterLink>

      <button
        type="button"
        class="mobile-menu-settings"
        @click="
          mobileOpen = false;
          settingsOpen = true;
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
          style="color: var(--text-2)"
        >
          <path
            d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
          />
          <circle cx="12" cy="12" r="3" />
        </svg>
        设置
      </button>
    </div>
  </Transition>

  <!-- Settings drawer -->
  <SettingsDrawer :open="settingsOpen" @close="settingsOpen = false" />
</template>

<style scoped>
.nav-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  height: var(--navbar-h);
  transition: background 0.25s, border-color 0.25s, backdrop-filter 0.25s;
}

.nav-inner {
  max-width: 1100px;
  margin: 0 auto;
  height: 100%;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  margin-right: 8px;
  flex-shrink: 0;
}

.nav-logo-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.01em;
}

.nav-desktop {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
}

.nav-link {
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-2);
  background: transparent;
  letter-spacing: 0.003em;
  text-decoration: none;
  transition: color 0.15s, background 0.15s;
  white-space: nowrap;
}

.nav-link:hover {
  color: var(--text);
  background: var(--surface-2);
}

.nav-link-active {
  color: var(--primary);
  background: var(--primary-light);
}

.nav-link-active:hover {
  color: var(--primary);
  background: var(--primary-light);
}

.nav-spacer {
  flex: 1;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.nav-icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-2);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.nav-icon-btn:hover {
  background: var(--surface-2);
  color: var(--text);
}

/* Mobile overlay */
.mobile-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.2);
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
}

/* Mobile menu */
.mobile-menu {
  position: fixed;
  top: var(--navbar-h);
  left: 0;
  right: 0;
  z-index: 45;
  background: var(--surface-glass);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid var(--border-subtle);
  padding: 8px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-shadow: var(--shadow-lg);
}

.mobile-menu-link {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 400;
  color: var(--text);
  background: transparent;
  text-decoration: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mobile-menu-link-active {
  font-weight: 500;
  color: var(--primary);
  background: var(--primary-light);
}

.mobile-menu-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
}

.mobile-menu-settings {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 400;
  color: var(--text);
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  margin-top: 4px;
  border-top: 1px solid var(--border-subtle);
}

/* Slide-down transition */
.slide-down-enter-active {
  animation: nav-slide-down 0.2s var(--ease-out) both;
}
.slide-down-leave-active {
  animation: nav-slide-down 0.15s var(--ease-out) reverse both;
}

@keyframes nav-slide-down {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Responsive */
@media (max-width: 640px) {
  .hidden-mobile {
    display: none !important;
  }
  .show-mobile {
    display: flex !important;
  }
}
@media (min-width: 641px) {
  .show-mobile {
    display: none !important;
  }
}
</style>
