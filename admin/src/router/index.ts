import { createRouter, createWebHashHistory } from 'vue-router';
import AdminLayout from '../layouts/AdminLayout.vue';
import Login from '../views/Login.vue';
import Dashboard from '../views/Dashboard.vue';
import Users from '../views/Users.vue';
import Plans from '../views/Plans.vue';
import Orders from '../views/Orders.vue';
import Channels from '../views/Channels.vue';
import Jobs from '../views/Jobs.vue';
import Audit from '../views/Audit.vue';
import Risk from '../views/Risk.vue';
import Settings from '../views/Settings.vue';
import { getToken } from '../api';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', name: 'login', component: Login, meta: { public: true } },
    {
      path: '/',
      component: AdminLayout,
      redirect: '/dashboard',
      children: [
        { path: 'dashboard', component: Dashboard },
        { path: 'users', component: Users },
        { path: 'plans', component: Plans },
        { path: 'orders', component: Orders },
        { path: 'channels', component: Channels },
        { path: 'jobs', component: Jobs },
        { path: 'audit', component: Audit },
        { path: 'risk', component: Risk },
        { path: 'settings', component: Settings },
      ],
    },
  ],
});

router.beforeEach((to) => {
  if (!to.meta.public && !getToken()) return '/login';
  if (to.path === '/login' && getToken()) return '/dashboard';
  return true;
});

export default router;
