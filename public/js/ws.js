'use strict';

// WebSocket Alpine methods — merged into the app data object in app.js
const _wsMethods = {

  connectWs(slug) {
    if (this.wsSlug === slug && this.ws?.readyState === WebSocket.OPEN) return;
    this.disconnectWs();
    this.wsSlug = slug;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/${slug}`);
    this.ws = ws;

    ws.onopen = () => {
      console.log('[ws] connected:', slug);
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
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  },

  handleWsEvent(event, data) {
    const refreshLogs = () => {
      if (this.activeProject?.is_owner && this.rightTab === 'log') this.loadLogs();
    };
    switch (event) {
      case 'item.created':
        if (!this.items.find(i => i.id === data.id)) this.items.push(data);
        refreshLogs();
        break;
      case 'item.updated': {
        const idx = this.items.findIndex(i => i.id === data.id);
        if (idx !== -1) this.items[idx] = { ...this.items[idx], ...data };
        refreshLogs();
        break;
      }
      case 'item.deleted':
        this.items = this.items.filter(i => i.id !== data.id);
        if (this.commentPopup.visible && this.commentPopup.item?.id === data.id) this.closeCommentPopup();
        refreshLogs();
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
        refreshLogs();
        break;
      }
      case 'item.uncompleted': {
        const idx = this.items.findIndex(i => i.id === data.item_id);
        if (idx !== -1) this.items[idx] = { ...this.items[idx], completion: null };
        refreshLogs();
        break;
      }
      case 'item.pic_added': {
        const idx = this.items.findIndex(i => i.id === data.item_id);
        if (idx !== -1 && !(this.items[idx].pics ?? []).find(p => p.id === data.pic.id)) {
          this.items[idx] = { ...this.items[idx], pics: [...(this.items[idx].pics ?? []), data.pic] };
        }
        refreshLogs();
        break;
      }
      case 'item.pic_removed': {
        const idx = this.items.findIndex(i => i.id === data.item_id);
        if (idx !== -1) this.items[idx] = { ...this.items[idx], pics: this.items[idx].pics.filter(p => p.id !== data.pic_id) };
        refreshLogs();
        break;
      }
      case 'comment.added': {
        if (this.commentPopup.visible && this.commentPopup.item?.id === data.item_id) {
          if (!this.commentPopup.comments.find(c => c.id === data.id)) {
            this.commentPopup = { ...this.commentPopup, comments: [...this.commentPopup.comments, data] };
          }
        }
        break;
      }
      case 'comment.deleted': {
        if (this.commentPopup.visible && this.commentPopup.item?.id === data.item_id) {
          this.commentPopup = { ...this.commentPopup, comments: this.commentPopup.comments.filter(c => c.id !== data.comment_id) };
        }
        break;
      }
      case 'message.created':
        if (!this.messages.find(m => m.id === data.id)) {
          this.messages.push(data);
          setTimeout(() => {
            const el = document.getElementById('chat-messages');
            if (el) el.scrollTop = el.scrollHeight;
          }, 50);
        }
        break;
      case 'project.updated':
        if (this.activeProject) this.activeProject = { ...this.activeProject, ...data };
        break;
      case 'project.deleted':
        this.showToast('This project has been deleted.', 'error');
        this.activeProject = null;
        this.items = [];
        this.messages = [];
        this.logsData = [];
        this.disconnectWs();
        window.location.hash = '';
        break;
    }
  },

};
