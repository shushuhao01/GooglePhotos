import { defineStore } from 'pinia';
import { req, setToken, clearToken, getToken } from '../api';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: getToken(),
    email: localStorage.getItem('pgx_admin_email') || '',
    adminUser: localStorage.getItem('pgx_admin_user') || '',
    loginLoading: false,
  }),
  getters: {
    loggedIn: (s) => !!s.token,
  },
  actions: {
    /* 管理员账号+密码登录（admin/admin123） */
    async adminLogin(username: string, password: string) {
      this.loginLoading = true;
      try {
        const d: any = await req('/auth/admin-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        this.token = d.token;
        this.email = d.user?.username || username;
        setToken(d.token);
        this.adminUser = username;
        localStorage.setItem('pgx_admin_user', username);
        localStorage.setItem('pgx_admin_email', this.email);
      } finally {
        this.loginLoading = false;
      }
    },
    async login(email: string) {
      this.loginLoading = true;
      try {
        const d: any = await req('/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
        this.token = d.token;
        this.email = d.user?.email || email;
        setToken(d.token);
        this.adminUser = '';
        localStorage.setItem('pgx_admin_email', this.email);
        localStorage.removeItem('pgx_admin_user');
      } finally {
        this.loginLoading = false;
      }
    },
    logout() {
      this.token = '';
      this.email = '';
      this.adminUser = '';
      clearToken();
      localStorage.removeItem('pgx_admin_email');
      localStorage.removeItem('pgx_admin_user');
    },
  },
});
