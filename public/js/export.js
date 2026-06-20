'use strict';

const _exportMethods = {

  exportChecklist(format) {
    const name = this.activeProject.name;
    const items = this.items;

    if (format === 'md') {
      const lines = [`# ${name}`, ''];
      for (const item of items) {
        if (item.item_type === 'section') {
          lines.push('', `## ${item.title}`);
          if (item.description) lines.push(item.description);
          lines.push('');
        } else {
          const check = item.completion ? 'x' : ' ';
          let line = `- [${check}] ${item.title}`;
          if (item.completion) line += ` — done by ${item.completion.done_by_name}`;
          lines.push(line);
          if (item.description) lines.push(`  ${item.description}`);
          const pics = (item.pics || []).map(p => p.name).join(', ');
          if (pics) lines.push(`  PIC: ${pics}`);
        }
      }
      this._downloadFile(lines.join('\n'), `${name}.md`, 'text/markdown');

    } else {
      const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [['type', 'title', 'description', 'status', 'done_by', 'done_at', 'pics']];
      for (const item of items) {
        rows.push([
          item.item_type,
          item.title,
          item.description || '',
          item.completion ? 'done' : 'pending',
          item.completion?.done_by_name || '',
          item.completion?.completed_at
            ? new Date(item.completion.completed_at).toISOString().split('T')[0]
            : '',
          (item.pics || []).map(p => p.name).join(';'),
        ]);
      }
      const csv = rows.map(r => r.map(escape).join(',')).join('\n');
      this._downloadFile(csv, `${name}.csv`, 'text/csv');
    }

    this.closeModal();
    this.showToast('Exported!');
  },

  _downloadFile(content, filename, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },

};
