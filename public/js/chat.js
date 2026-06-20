'use strict';

const _chatMethods = {

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

};
