'use strict';

// ---- API helper ----
async function api(method, path, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---- Alpine app ----
document.addEventListener('alpine:init', () => {
  Alpine.data('app', () => ({

    // ---- State ----
    loading: true,
    user: null,
    guestName: '',
    guestNameInput: '',

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
    itemForm: { title: '', description: '', actor_name: '' },
    editingItem: null,
    completeForm: { done_by_name: '', notes: '' },
    completingItem: null,
    picForm: { name: '', actor_name: '' },
    picTargetItem: null,

    draggingIndex: null,
    dragOverIndex: null,

    nonOwnerAssignMode: null,
    nonOwnerAssignItem: null,
    nonOwnerAssignInput: '',
    nonOwnerAssignError: '',

    ws: null,
    wsSlug: null,

    toast: { visible: false, msg: '', type: 'success', _timer: null },

    // ---- Init ----
    async init() {
      this.guestName = localStorage.getItem('guestName') || '';

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
        await this.loadProject(match[1]);
      } else {
        this.activeProject = null;
        this.items = [];
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
        await this.loadProjects();
        // Reload if there was a pending project slug in hash
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
      window.location.hash = `#/p/${slug}`;
    },

    async loadProject(slug) {
      try {
        const project = await api('GET', `/api/projects/${slug}`);
        this.activeProject = project;
        this.items = project.items || [];
        this.connectWs(slug);
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
        // Sync sidebar
        const idx = this.projects.findIndex(p => p.id === updated.id);
        if (idx !== -1) this.projects[idx].visibility = updated.visibility;
        this.showToast(`Project is now ${updated.visibility}.`);
      } catch (e) {
        this.showToast(e.message, 'error');
      }
    },

    async deleteProject() {
      if (!confirm(`Delete project "${this.activeProject.name}"? This cannot be undone.`)) return;
      try {
        await api('DELETE', `/api/projects/${this.activeProject.slug}`);
        this.projects = this.projects.filter(p => p.id !== this.activeProject.id);
        this.activeProject = null;
        this.items = [];
        this.disconnectWs();
        window.location.hash = '';
        this.showToast('Project deleted.');
      } catch (e) {
        this.showToast(e.message, 'error');
      }
    },

    copyLink() {
      const url = `${location.origin}/#/p/${this.activeProject.slug}`;
      navigator.clipboard.writeText(url).then(() => this.showToast('Link copied!'));
    },

    // ---- Items ----
    openEditItemModal(item) {
      this.editingItem = item;
      this.itemForm = { title: item.title, description: item.description || '', actor_name: this.guestName };
      this.openModal('editItem');
    },

    async submitItem() {
      this.modalError = '';
      const isEdit = this.modal === 'editItem';

      if (!this.itemForm.title.trim()) {
        this.modalError = 'Title is required.';
        return;
      }
      if (!this.user && !this.itemForm.actor_name?.trim() && !this.guestName) {
        this.modalError = 'Your name is required.';
        return;
      }

      const actorName = this.user ? undefined : (this.itemForm.actor_name?.trim() || this.guestName);
      const payload = {
        title: this.itemForm.title.trim(),
        description: this.itemForm.description?.trim() || undefined,
        ...(actorName ? { actor_name: actorName } : {}),
      };
      if (actorName) this.saveGuestNameSilent(actorName);

      try {
        if (isEdit) {
          const updated = await api('PATCH', `/api/projects/${this.activeProject.slug}/items/${this.editingItem.id}`, payload);
          const idx = this.items.findIndex(i => i.id === this.editingItem.id);
          if (idx !== -1) this.items[idx] = { ...this.items[idx], ...updated };
        } else {
          const item = await api('POST', `/api/projects/${this.activeProject.slug}/items`, payload);
          this.items.push(item);
        }
        this.closeModal();
        this.itemForm = { title: '', description: '', actor_name: '' };
        this.editingItem = null;
      } catch (e) {
        this.modalError = e.message;
      }
    },

    async deleteItem(item) {
      if (!confirm(`Delete "${item.title}"?`)) return;
      try {
        await api('DELETE', `/api/projects/${this.activeProject.slug}/items/${item.id}`);
        this.items = this.items.filter(i => i.id !== item.id);
      } catch (e) {
        this.showToast(e.message, 'error');
      }
    },

    // ---- Drag reorder ----
    dragStart(e, index) {
      this.draggingIndex = index;
      e.dataTransfer.effectAllowed = 'move';
    },
    dragOver(e, index) {
      this.dragOverIndex = index;
    },
    async drop(e, index) {
      const from = this.draggingIndex;
      this.draggingIndex = null;
      this.dragOverIndex = null;
      if (from === null || from === index) return;

      const items = [...this.items];
      const [moved] = items.splice(from, 1);
      items.splice(index, 0, moved);
      items.forEach((item, i) => { item.display_order = i; });
      this.items = items;

      await this.saveOrder();
    },
    dragEnd() {
      this.draggingIndex = null;
      this.dragOverIndex = null;
    },
    async saveOrder() {
      const actorName = this.guestName;
      const order = this.items.map((item, i) => ({ id: item.id, display_order: i }));
      const payload = { order, ...(actorName && !this.user ? { actor_name: actorName } : {}) };
      try {
        await api('PATCH', `/api/projects/${this.activeProject.slug}/items/reorder`, payload);
      } catch (e) {
        this.showToast('Reorder failed: ' + e.message, 'error');
      }
    },

    // ---- PICs ----
    openAddPicModal(item) {
      this.picTargetItem = item;
      this.picForm = { name: '', actor_name: this.guestName };
      this.openModal('addPic');
    },

    async submitPic() {
      this.modalError = '';
      if (!this.picForm.name.trim()) { this.modalError = 'Name is required.'; return; }
      const actorName = this.user ? undefined : (this.picForm.actor_name?.trim() || this.guestName);
      if (!this.user && !actorName) { this.modalError = 'Your name is required.'; return; }
      const payload = { name: this.picForm.name.trim(), ...(actorName ? { actor_name: actorName } : {}) };
      if (actorName) this.saveGuestNameSilent(actorName);

      try {
        const pic = await api('POST', `/api/projects/${this.activeProject.slug}/items/${this.picTargetItem.id}/pics`, payload);
        const idx = this.items.findIndex(i => i.id === this.picTargetItem.id);
        if (idx !== -1) this.items[idx] = { ...this.items[idx], pics: [...this.items[idx].pics, pic] };
        this.closeModal();
        this.picForm = { name: '', actor_name: '' };
        this.picTargetItem = null;
      } catch (e) {
        this.modalError = e.message;
      }
    },

    async removePic(item, pic) {
      try {
        await api('DELETE', `/api/projects/${this.activeProject.slug}/items/${item.id}/pics/${pic.id}`);
        const idx = this.items.findIndex(i => i.id === item.id);
        if (idx !== -1) this.items[idx] = { ...this.items[idx], pics: this.items[idx].pics.filter(p => p.id !== pic.id) };
      } catch (e) {
        this.showToast(e.message, 'error');
      }
    },

    // ---- Completions ----
    openCompleteModal(item) {
      this.completingItem = item;
      this.completeForm = { done_by_name: this.guestName || (this.user?.username ?? ''), notes: '' };
      this.openModal('complete');
    },

    async submitComplete() {
      this.modalError = '';
      if (!this.completeForm.done_by_name.trim()) { this.modalError = 'Completed by is required.'; return; }
      const payload = {
        done_by_name: this.completeForm.done_by_name.trim(),
        notes: this.completeForm.notes.trim() || undefined,
        ...(!this.user ? { actor_name: this.completeForm.done_by_name.trim() } : {}),
      };
      this.saveGuestNameSilent(this.completeForm.done_by_name.trim());

      try {
        const completion = await api('POST', `/api/projects/${this.activeProject.slug}/items/${this.completingItem.id}/complete`, payload);
        const idx = this.items.findIndex(i => i.id === this.completingItem.id);
        if (idx !== -1) this.items[idx] = { ...this.items[idx], completion };
        this.closeModal();
        this.completingItem = null;
      } catch (e) {
        this.modalError = e.message;
      }
    },

    async uncompleteItem(item) {
      if (!confirm('Undo completion?')) return;
      const actorName = this.user?.username ?? this.guestName;
      try {
        await api('DELETE', `/api/projects/${this.activeProject.slug}/items/${item.id}/complete`);
        const idx = this.items.findIndex(i => i.id === item.id);
        if (idx !== -1) this.items[idx] = { ...this.items[idx], completion: null };
      } catch (e) {
        this.showToast(e.message, 'error');
      }
    },

    // ---- Non-owner assign (PIC / complete) ----
    openNonOwnerPic(item) {
      this.nonOwnerAssignMode = 'pic';
      this.nonOwnerAssignItem = item;
      this.nonOwnerAssignInput = '';
      this.nonOwnerAssignError = '';
      this.openModal('nonOwnerAssign');
    },

    openNonOwnerComplete(item) {
      this.nonOwnerAssignMode = 'complete';
      this.nonOwnerAssignItem = item;
      this.nonOwnerAssignInput = item.completion?.done_by_name || this.guestName || (this.user?.username ?? '');
      this.nonOwnerAssignError = '';
      this.openModal('nonOwnerAssign');
    },

    async submitNonOwnerAssign() {
      this.nonOwnerAssignError = '';
      const name = this.nonOwnerAssignInput.trim();
      if (!name) { this.nonOwnerAssignError = 'Nama harus diisi.'; return; }
      const item = this.nonOwnerAssignItem;
      const slug = this.activeProject.slug;
      const actorName = this.user?.username ?? this.guestName ?? name;
      if (this.nonOwnerAssignMode === 'pic') {
        try {
          const pic = await api('POST', `/api/projects/${slug}/items/${item.id}/pics`, {
            name,
            ...(!this.user ? { actor_name: actorName } : {}),
          });
          const idx = this.items.findIndex(i => i.id === item.id);
          if (idx !== -1) this.items[idx] = { ...this.items[idx], pics: [...this.items[idx].pics, pic] };
          this.closeModal();
        } catch (e) {
          this.nonOwnerAssignError = e.message;
        }
      } else {
        try {
          const completion = await api('POST', `/api/projects/${slug}/items/${item.id}/complete`, {
            done_by_name: name,
            ...(!this.user ? { actor_name: name } : {}),
          });
          const idx = this.items.findIndex(i => i.id === item.id);
          if (idx !== -1) this.items[idx] = { ...this.items[idx], completion };
          if (!this.user) this.saveGuestNameSilent(name);
          this.closeModal();
        } catch (e) {
          this.nonOwnerAssignError = e.message;
        }
      }
    },

    // ---- Guest name ----
    saveGuestName() {
      const name = this.guestNameInput.trim();
      if (!name) return;
      this.guestName = name;
      localStorage.setItem('guestName', name);
      this.closeModal();
    },
    saveGuestNameSilent(name) {
      if (!name || this.user) return;
      this.guestName = name;
      localStorage.setItem('guestName', name);
    },

    // ---- Modals ----
    openModal(name) {
      this.modal = name;
      this.modalError = '';
      if (name === 'guestName') this.guestNameInput = this.guestName;
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

    // ---- WebSocket ----
    connectWs(slug) {
      if (this.wsSlug === slug && this.ws?.readyState === WebSocket.OPEN) return;
      this.disconnectWs();
      this.wsSlug = slug;

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws/${slug}`);
      this.ws = ws;

      ws.onopen = () => {
        console.log('[ws] connected:', slug);
        // Heartbeat every 25s
        ws._ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 25000);
      };

      ws.onmessage = (e) => {
        if (e.data === 'pong') return;
        try {
          const { event, data } = JSON.parse(e.data);
          this.handleWsEvent(event, data);
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        clearInterval(ws._ping);
        // Reconnect after 3s if still on same project
        if (this.wsSlug === slug) {
          setTimeout(() => { if (this.wsSlug === slug) this.connectWs(slug); }, 3000);
        }
      };

      ws.onerror = (e) => console.error('[ws] error:', e);
    },

    disconnectWs() {
      if (this.ws) {
        clearInterval(this.ws._ping);
        this.wsSlug = null;
        this.ws.onclose = null; // prevent reconnect loop
        this.ws.close();
        this.ws = null;
      }
    },

    handleWsEvent(event, data) {
      switch (event) {
        case 'item.created':
          if (!this.items.find(i => i.id === data.id)) this.items.push(data);
          break;
        case 'item.updated': {
          const idx = this.items.findIndex(i => i.id === data.id);
          if (idx !== -1) this.items[idx] = { ...this.items[idx], ...data };
          break;
        }
        case 'item.deleted':
          this.items = this.items.filter(i => i.id !== data.id);
          break;
        case 'item.reordered': {
          const map = Object.fromEntries(data.order.map(o => [o.id, o.display_order]));
          this.items = [...this.items]
            .map(i => ({ ...i, display_order: map[i.id] ?? i.display_order }))
            .sort((a, b) => a.display_order - b.display_order);
          break;
        }
        case 'item.completed': {
          const idx = this.items.findIndex(i => i.id === data.item_id);
          if (idx !== -1) this.items[idx] = { ...this.items[idx], completion: data.completion };
          break;
        }
        case 'item.uncompleted': {
          const idx = this.items.findIndex(i => i.id === data.item_id);
          if (idx !== -1) this.items[idx] = { ...this.items[idx], completion: null };
          break;
        }
        case 'item.pic_added': {
          const idx = this.items.findIndex(i => i.id === data.item_id);
          if (idx !== -1 && !this.items[idx].pics.find(p => p.id === data.pic.id)) {
            this.items[idx] = { ...this.items[idx], pics: [...this.items[idx].pics, data.pic] };
          }
          break;
        }
        case 'item.pic_removed': {
          const idx = this.items.findIndex(i => i.id === data.item_id);
          if (idx !== -1) this.items[idx] = { ...this.items[idx], pics: this.items[idx].pics.filter(p => p.id !== data.pic_id) };
          break;
        }
        case 'project.updated':
          if (this.activeProject) this.activeProject = { ...this.activeProject, ...data };
          break;
        case 'project.deleted':
          this.showToast('This project has been deleted.', 'error');
          this.activeProject = null;
          this.items = [];
          this.disconnectWs();
          window.location.hash = '';
          break;
      }
    },

  }));
});
