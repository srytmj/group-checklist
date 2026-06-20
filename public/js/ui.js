'use strict';

const _uiMethods = {

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

  showToast(msg, type = 'success') {
    if (this.toast._timer) clearTimeout(this.toast._timer);
    this.toast = { visible: true, msg, type, _timer: null };
    this.toast._timer = setTimeout(() => { this.toast.visible = false; }, 3000);
  },

};
