import { defineStore } from 'pinia';
import { req, setToken, clearToken, getToken } from '../api';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: getToken(),
    email: '',
    adminUser: '',
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
      } finally {
        this.loginLoading = false;
      }
    },
    logout() {
      this.token = '';
      this.email = '';
      this.adminUser = '';
      clearToken();
    },
  },
});
