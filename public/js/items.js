'use strict';

// Item-related Alpine methods — merged into the app data object in app.js
const _itemMethods = {

  // ---- Items ----
  openEditItemModal(item) {
    this.editingItem = item;
    this.itemForm = {
      title: item.title,
      description: item.description || '',
      actor_name: this.guestName,
      item_type: item.item_type || 'task',
    };
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
      item_type: this.itemForm.item_type || 'task',
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
      this.itemForm = { title: '', description: '', actor_name: '', item_type: 'task' };
      this.editingItem = null;
    } catch (e) {
      this.modalError = e.message;
    }
  },

  deleteItem(item) {
    this.openDeleteItemModal(item);
  },

  openDeleteItemModal(item) {
    this.deleteItemTarget = item;
    this.openModal('deleteItem');
  },

  async confirmDeleteItem() {
    const item = this.deleteItemTarget;
    if (!item) return;
    try {
      await api('DELETE', `/api/projects/${this.activeProject.slug}/items/${item.id}`);
      this.items = this.items.filter(i => i.id !== item.id);
      this.closeModal();
      this.deleteItemTarget = null;
    } catch (e) {
      this.showToast(e.message, 'error');
      this.closeModal();
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
      if (idx !== -1 && !(this.items[idx].pics ?? []).find(p => p.id === pic.id)) {
        this.items[idx] = { ...this.items[idx], pics: [...(this.items[idx].pics ?? []), pic] };
      }
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

  openUncompleteModal(item) {
    this.uncomletingItem = item;
    this.openModal('uncomplete');
  },

  async confirmUncomplete() {
    const item = this.uncomletingItem;
    if (!item) return;
    try {
      await api('DELETE', `/api/projects/${this.activeProject.slug}/items/${item.id}/complete`);
      const idx = this.items.findIndex(i => i.id === item.id);
      if (idx !== -1) this.items[idx] = { ...this.items[idx], completion: null };
      this.closeModal();
      this.uncomletingItem = null;
    } catch (e) {
      this.showToast(e.message, 'error');
      this.closeModal();
    }
  },

  handleNonOwnerCheck(item) {
    const name = this.user?.username ?? this.guestName;
    if (!name) {
      this.pendingCompleteItem = item;
      this.openModal('guestName');
      return;
    }
    this.directComplete(item);
  },

  async directComplete(item) {
    const name = this.user?.username ?? this.guestName;
    try {
      const completion = await api('POST', `/api/projects/${this.activeProject.slug}/items/${item.id}/complete`, {
        done_by_name: name,
        ...(!this.user ? { actor_name: name } : {}),
      });
      const idx = this.items.findIndex(i => i.id === item.id);
      if (idx !== -1) this.items[idx] = { ...this.items[idx], completion };
    } catch (e) {
      this.showToast(e.message, 'error');
    }
  },

  // ---- Comment popup ----
  openCommentPopup(item, event) {
    const btn = event.currentTarget;
    const rect = btn.getBoundingClientRect();
    const popW = 296, popH = 360;
    const vw = window.innerWidth, vh = window.innerHeight;

    let top = rect.bottom + 6;
    if (top + popH > vh - 10) top = Math.max(10, rect.top - popH - 6);

    let left = rect.left;
    if (left + popW > vw - 10) left = vw - popW - 10;
    if (left < 10) left = 10;

    this.commentPopup = { visible: true, item, comments: [], loading: true, input: '', top, left };
    this.loadItemComments(item.id);
  },

  closeCommentPopup() {
    this.commentPopup = { visible: false, item: null, comments: [], loading: false, input: '', top: 0, left: 0 };
  },

  async loadItemComments(itemId) {
    try {
      const data = await api('GET', `/api/projects/${this.activeProject.slug}/items/${itemId}/comments`);
      this.commentPopup = { ...this.commentPopup, comments: data.comments || [], loading: false };
    } catch {
      this.commentPopup = { ...this.commentPopup, loading: false };
    }
  },

  async addComment() {
    const text = this.commentPopup.input.trim();
    if (!text || !this.user) return;
    const itemId = this.commentPopup.item.id;
    try {
      const comment = await api('POST', `/api/projects/${this.activeProject.slug}/items/${itemId}/comments`, { body: text });
      this.commentPopup = { ...this.commentPopup, comments: [...this.commentPopup.comments, comment], input: '' };
    } catch (e) {
      this.showToast(e.message, 'error');
    }
  },

  async deleteComment(comment) {
    try {
      await api('DELETE', `/api/projects/${this.activeProject.slug}/items/${this.commentPopup.item.id}/comments/${comment.id}`);
      this.commentPopup = { ...this.commentPopup, comments: this.commentPopup.comments.filter(c => c.id !== comment.id) };
    } catch (e) {
      this.showToast(e.message, 'error');
    }
  },

  copyDescription(text) {
    navigator.clipboard.writeText(text).then(() => this.showToast('Copied!')).catch(() => this.showToast('Copy failed', 'error'));
  },

  // ---- Non-owner assign ----
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
    if (!name) { this.nonOwnerAssignError = 'Name is required.'; return; }
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
        if (idx !== -1 && !(this.items[idx].pics ?? []).find(p => p.id === pic.id)) {
          this.items[idx] = { ...this.items[idx], pics: [...(this.items[idx].pics ?? []), pic] };
        }
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

  // ---- Tree view: section collapse + progress ----
  toggleSection(sectionId) {
    this.collapsedSections = { ...this.collapsedSections, [sectionId]: !this.collapsedSections[sectionId] };
  },

  getSectionTasks(sectionId) {
    let inside = false;
    const tasks = [];
    for (const item of this.items) {
      if (item.item_type === 'section') {
        if (item.id === sectionId) { inside = true; continue; }
        if (inside) break;
      } else if (inside) {
        tasks.push(item);
      }
    }
    return tasks;
  },

  getSectionProgress(sectionId) {
    const tasks = this.getSectionTasks(sectionId);
    const total = tasks.length;
    const done = tasks.filter(t => t.completion).length;
    return { total, done, pct: total ? Math.round(done / total * 100) : 0 };
  },

  // ---- Delete mode ----
  toggleDeleteMode() {
    this.deleteMode = !this.deleteMode;
    if (!this.deleteMode) this.selectedItems = {};
  },

  toggleSelectItem(item) {
    if (item.item_type === 'section') {
      const tasks = this.getSectionTasks(item.id);
      const allSelected = !!this.selectedItems[item.id] && tasks.every(t => this.selectedItems[t.id]);
      const next = !allSelected;
      const updates = { [item.id]: next };
      tasks.forEach(t => { updates[t.id] = next; });
      this.selectedItems = { ...this.selectedItems, ...updates };
    } else {
      this.selectedItems = { ...this.selectedItems, [item.id]: !this.selectedItems[item.id] };
    }
  },

  selectedCount() {
    return Object.values(this.selectedItems).filter(Boolean).length;
  },

  async confirmBatchDelete() {
    const ids = Object.entries(this.selectedItems).filter(([, v]) => v).map(([id]) => Number(id));
    if (!ids.length) return;
    try {
      await api('DELETE', `/api/projects/${this.activeProject.slug}/items/batch`, { ids });
      const idSet = new Set(ids);
      this.items = this.items.filter(i => !idSet.has(i.id));
      this.selectedItems = {};
      this.deleteMode = false;
      this.closeModal();
      this.showToast(`Deleted ${ids.length} item${ids.length !== 1 ? 's' : ''}.`);
    } catch (e) {
      this.showToast(e.message, 'error');
      this.closeModal();
    }
  },

  // ---- Import ----
  downloadTemplate(format = 'md') {
    let content, mime, filename;
    if (format === 'md') {
      content = [
        '## Phase 1 — Getting Started',
        'Overview of the first phase',
        '',
        '- [ ] Set up repository',
        '  Clone and configure the repo',
        '- [ ] Configure environment',
        '  Set up environment variables',
        '',
        '## Phase 2 — Development',
        'Core development tasks',
        '',
        '- [ ] Implement core features',
        '- [ ] Write tests',
        '  Add unit and integration tests',
      ].join('\n');
      mime = 'text/markdown'; filename = 'checklist-template.md';
    } else {
      content = [
        'type,title,description',
        'section,Phase 1 — Getting Started,Overview of the first phase',
        'task,Set up repository,Create a new repository and initialize the project',
        'task,Configure environment,Set up environment variables and configurations',
        'section,Phase 2 — Development,Core development tasks',
        'task,Implement core features,Build the main application functionality',
        'task,Write tests,Add unit and integration tests',
      ].join('\n');
      mime = 'text/csv'; filename = 'checklist-template.csv';
    }
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },

  async handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    this.importError = '';
    this.importLoading = true;
    try {
      const content = await file.text();
      const result = await api('POST', `/api/projects/${this.activeProject.slug}/items/import`, {
        content,
        filename: file.name,
      });
      for (const item of result.items) {
        if (!this.items.find(i => i.id === item.id)) this.items.push(item);
      }
      this.closeModal();
      this.showToast(`Imported ${result.imported} item${result.imported !== 1 ? 's' : ''} successfully.`);
    } catch (e) {
      this.importError = e.message;
    } finally {
      this.importLoading = false;
      event.target.value = '';
    }
  },

};
