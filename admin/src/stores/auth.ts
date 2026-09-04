import { defineStore } from 'pinia';
import { req, setToken, clearToken, getToken } from '../api';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: getToken(),
    email: '',
    loginLoading: false,
  }),
  getters: {
    loggedIn: (s) => !!s.token,
  },
  actions: {
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
      clearToken();
    },
  },
});
