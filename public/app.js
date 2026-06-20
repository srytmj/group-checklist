'use strict';

// Modules (load order must match script tags in index.html):
// js/api.js      → api()
// js/modals.js   → _modalHTML
// js/auth.js     → _authMethods
// js/projects.js → _projectMethods
// js/ui.js       → _uiMethods
// js/chat.js     → _chatMethods
// js/items.js    → _itemMethods
// js/ws.js       → _wsMethods
// js/export.js   → _exportMethods

document.addEventListener('alpine:init', () => {
  // Inject modal/popup/toast HTML before Alpine scans the DOM
  const modalsMount = document.getElementById('modals-mount');
  if (modalsMount && typeof _modalHTML !== 'undefined') {
    modalsMount.innerHTML = _modalHTML;
  }

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

    viewMode: localStorage.getItem('viewMode') || 'tree',
    deleteMode: false,
    selectedItems: {},
    collapsedSections: {},

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

    get taskItems() {
      return this.items.filter(i => i.item_type !== 'section');
    },

    // Items with _sectionId metadata for tree collapse logic
    get displayItems() {
      let sectionId = null;
      return this.items.map(item => {
        if (item.item_type === 'section') sectionId = item.id;
        return { ...item, _sectionId: item.item_type === 'section' ? null : sectionId };
      });
    },

    // ---- Spread methods from separate files ----
    ..._authMethods,
    ..._projectMethods,
    ..._uiMethods,
    ..._chatMethods,
    ..._itemMethods,
    ..._wsMethods,
    ..._exportMethods,

  }));
});
