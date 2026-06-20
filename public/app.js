'use strict';

// api() is in js/api.js
// Item methods are in js/items.js  (_itemMethods)
// WebSocket methods are in js/ws.js (_wsMethods)

document.addEventListener('alpine:init', () => {
  Alpine.data('app', () => ({

    // ---- State ----
    loading: true,
    user: null,
    guestName: '',
    guestNameInput: '',

    sidebarOpen: true,
    mobileSidebarOpen: false,
    mobilePanel: 'items',

    authMode: 'login',
    authForm: { username: '', password: '' },
    authError: '',
    authLoading: false,

    projects: [],
    activeProject: null,
    items: [],

    modal: null,
    modalError: '',

    createProjectForm: { name: '', visibility: 'private' },
    itemForm: { title: '', description: '', actor_name: '', item_type: 'task' },
    editingItem: null,
    completeForm: { done_by_name: '', notes: '' },
    completingItem: null,
    uncomletingItem: null,
    pendingCompleteItem: null,
    picForm: { name: '', actor_name: '' },
    picTargetItem: null,

    deleteItemTarget: null,

    commentPopup: { visible: false, item: null, comments: [], loading: false, input: '', top: 0, left: 0 },

    importError: '',
    importLoading: false,
    importTab: 'md',

    draggingIndex: null,
    dragOverIndex: null,

    nonOwnerAssignMode: null,
    nonOwnerAssignItem: null,
    nonOwnerAssignInput: '',
    nonOwnerAssignError: '',

    rightTab: 'chat',
    messages: [],
    messagesLoading: false,
    messageInput: '',
    logsData: [],
    logsLoading: false,

    theme: localStorage.getItem('theme') || 'system',
    get isDark() {
      if (this.theme === 'dark') return true;
      if (this.theme === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    },

    ws: null,
    wsSlug: null,

    toast: { visible: false, msg: '', type: 'success', _timer: null },

    // ---- Init ----
    async init() {
      this.guestName = localStorage.getItem('guestName') || '';
      this.sidebarOpen = localStorage.getItem('sidebarOpen') !== 'false';
      this.applyTheme();

      this.$watch('sidebarOpen', (v) => localStorage.setItem('sidebarOpen', String(v)));

      try {
        this.user = await api('GET', '/api/auth/me');
      } catch {
        this.user = null;
      }

      window.addEventListener('hashchange', () => this.handleRoute());
      await this.handleRoute();
      this.loading = false;
    },

    // ---- Routing ----
    async handleRoute() {
      const hash = window.location.hash;
      const match = hash.match(/^#\/p\/([a-z0-9]+)$/);
      if (match) {
        if (this.user) await this.loadProjects();
        await this.loadProject(match[1]);
      } else {
        this.activeProject = null;
        this.items = [];
        this.messages = [];
        this.logsData = [];
        this.disconnectWs();
        if (this.user) await this.loadProjects();
      }
    },

    // ---- Auth ----
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

    // ---- Projects ----
    async loadProjects() {
      if (!this.user) return;
      try {
        this.projects = await api('GET', '/api/projects');
      } catch (e) {
        this.showToast('Failed to load projects: ' + e.message, 'error');
      }
    },

    async selectProject(slug) {
      this.mobileSidebarOpen = false;
      this.mobilePanel = 'items';
      window.location.hash = `#/p/${slug}`;
    },

    async loadProject(slug) {
      try {
        const project = await api('GET', `/api/projects/${slug}`);
        this.activeProject = project;
        this.items = project.items || [];
        this.messages = [];
        this.logsData = [];
        this.rightTab = 'chat';
        this.connectWs(slug);
        this.loadMessages();
        if (project.is_owner) this.loadLogs();
      } catch (e) {
        this.showToast(e.message === 'access denied' ? 'This project is private.' : e.message, 'error');
        this.activeProject = null;
        this.items = [];
      }
    },

    async createProject() {
      this.modalError = '';
      if (!this.createProjectForm.name.trim()) {
        this.modalError = 'Project name is required.';
        return;
      }
      try {
        const project = await api('POST', '/api/projects', this.createProjectForm);
        this.projects.unshift({ ...project });
        this.closeModal();
        this.createProjectForm = { name: '', visibility: 'private' };
        this.selectProject(project.slug);
      } catch (e) {
        this.modalError = e.message;
      }
    },

    async toggleVisibility() {
      if (!this.activeProject?.is_owner) return;
      const next = this.activeProject.visibility === 'public' ? 'private' : 'public';
      try {
        const updated = await api('PATCH', `/api/projects/${this.activeProject.slug}`, { visibility: next });
        this.activeProject = { ...this.activeProject, ...updated };
        const idx = this.projects.findIndex(p => p.id === updated.id);
        if (idx !== -1) this.projects[idx].visibility = updated.visibility;
        this.showToast(`Project is now ${updated.visibility}.`);
      } catch (e) {
        this.showToast(e.message, 'error');
      }
    },

    openDeleteProjectModal() {
      this.openModal('deleteProject');
    },

    async confirmDeleteProject() {
      try {
        await api('DELETE', `/api/projects/${this.activeProject.slug}`);
        this.projects = this.projects.filter(p => p.id !== this.activeProject.id);
        this.activeProject = null;
        this.items = [];
        this.messages = [];
        this.logsData = [];
        this.disconnectWs();
        window.location.hash = '';
        this.closeModal();
        this.showToast('Project deleted.');
      } catch (e) {
        this.showToast(e.message, 'error');
      }
    },

    copyLink() {
      const url = `${location.origin}/#/p/${this.activeProject.slug}`;
      navigator.clipboard.writeText(url).then(() => this.showToast('Link copied!'));
    },

    get taskItems() {
      return this.items.filter(i => i.item_type !== 'section');
    },

    // ---- Theme ----
    applyTheme() {
      const html = document.documentElement;
      if (this.theme === 'dark') html.setAttribute('data-theme', 'dark');
      else if (this.theme === 'light') html.setAttribute('data-theme', 'light');
      else html.removeAttribute('data-theme');
    },
    toggleTheme() {
      this.theme = this.isDark ? 'light' : 'dark';
      localStorage.setItem('theme', this.theme);
      this.applyTheme();
    },

    // ---- Guest name ----
    saveGuestName() {
      const name = this.guestNameInput.trim();
      if (!name) return;
      this.guestName = name;
      localStorage.setItem('guestName', name);
      this.closeModal();
      if (this.pendingCompleteItem) {
        const item = this.pendingCompleteItem;
        this.pendingCompleteItem = null;
        this.directComplete(item);
      }
    },
    saveGuestNameSilent(name) {
      if (!name || this.user) return;
      this.guestName = name;
      localStorage.setItem('guestName', name);
    },

    // ---- Messages (chat) ----
    async loadMessages() {
      if (!this.activeProject) return;
      this.messagesLoading = true;
      try {
        const data = await api('GET', `/api/projects/${this.activeProject.slug}/messages`);
        this.messages = data.messages || [];
        setTimeout(() => {
          const el = document.getElementById('chat-messages');
          if (el) el.scrollTop = el.scrollHeight;
        }, 50);
      } catch {
        // silent
      } finally {
        this.messagesLoading = false;
      }
    },

    async sendMessage() {
      const body = this.messageInput.trim();
      if (!body) return;
      if (!this.user) {
        this.showToast('Sign in to send messages.', 'error');
        return;
      }
      this.messageInput = '';
      try {
        await api('POST', `/api/projects/${this.activeProject.slug}/messages`, { body });
      } catch (e) {
        this.messageInput = body;
        this.showToast(e.message, 'error');
      }
    },

    // ---- Audit logs ----
    async loadLogs() {
      if (!this.activeProject?.is_owner) return;
      this.logsLoading = true;
      try {
        const data = await api('GET', `/api/projects/${this.activeProject.slug}/logs?level=public&limit=40`);
        this.logsData = data.logs || [];
      } catch {
        // silent
      } finally {
        this.logsLoading = false;
      }
    },

    formatLogAction(action) {
      const map = {
        'item.created': 'created item',
        'item.updated': 'updated item',
        'item.deleted': 'deleted item',
        'item.completed': 'completed item',
        'item.uncompleted': 'uncompleted item',
        'item.pic_added': 'assigned PIC',
        'item.pic_removed': 'removed PIC',
        'item.reordered': 'reordered items',
        'project.created': 'created project',
        'project.updated': 'updated project',
      };
      return map[action] || action;
    },

    // ---- Modals ----
    openModal(name) {
      this.modal = name;
      this.modalError = '';
      if (name === 'guestName') this.guestNameInput = this.guestName;
      if (name === 'addItem') this.itemForm = { title: '', description: '', actor_name: '', item_type: 'task' };
      if (name === 'import') { this.importError = ''; this.importLoading = false; this.importTab = 'md'; }
      if (name === 'auth') { this.authError = ''; }
    },
    closeModal() {
      this.modal = null;
      this.modalError = '';
    },

    // ---- Toast ----
    showToast(msg, type = 'success') {
      if (this.toast._timer) clearTimeout(this.toast._timer);
      this.toast = { visible: true, msg, type, _timer: null };
      this.toast._timer = setTimeout(() => { this.toast.visible = false; }, 3000);
    },

    // Merge methods from separate files
    ..._itemMethods,
    ..._wsMethods,

  }));
});
