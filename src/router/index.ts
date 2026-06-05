import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: () => import('../pages/Dashboard.vue'),
    },
    {
      path: '/questions',
      name: 'questions',
      component: () => import('../pages/QuestionList.vue'),
    },
    {
      path: '/questions/:id',
      name: 'question-detail',
      component: () => import('../pages/QuestionDetail.vue'),
      props: true,
    },
    {
      path: '/practice',
      name: 'practice',
      component: () => import('../pages/Practice.vue'),
    },
    {
      path: '/mock-interview',
      name: 'mock-interview',
      component: () => import('../pages/MockInterview.vue'),
    },
    {
      path: '/weak',
      name: 'weak-points',
      component: () => import('../pages/WeakPoints.vue'),
    },
    {
      path: '/tools',
      name: 'tools',
      component: () => import('../pages/Tools.vue'),
    },
    {
      path: '/tools/jd-match',
      name: 'jd-match',
      component: () => import('../pages/JdMatch.vue'),
    },
    {
      path: '/tools/:toolId',
      name: 'ai-tool',
      component: () => import('../pages/AITool.vue'),
    },
    {
      path: '/import',
      name: 'import',
      component: () => import('../pages/ImportPage.vue'),
    },
    {
      path: '/prompt',
      name: 'prompt',
      component: () => import('../pages/PromptPage.vue'),
    },
    {
      path: '/manage',
      name: 'manage',
      component: () => import('../pages/QuestionManager.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

export default router
