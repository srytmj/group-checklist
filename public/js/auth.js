'use strict';

const _authMethods = {

  async submitAuth() {
    this.authError = '';
    this.authLoading = true;
    try {
      const endpoint = this.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      this.user = await api('POST', endpoint, this.authForm);
      this.authForm = { username: '', password: '' };
      this.closeModal();
      await this.loadProjects();
      await this.handleRoute();
    } catch (e) {
      this.authError = e.message;
    } finally {
      this.authLoading = false;
    }
  },

  async logout() {
    await api('POST', '/api/auth/logout').catch(() => {});
    this.user = null;
    this.projects = [];
    this.activeProject = null;
    this.items = [];
    this.messages = [];
    this.logsData = [];
    this.disconnectWs();
    window.location.hash = '';
  },

};
