import { rawDatabase } from './local-env';
import { sendProgressNotice, progressNoticeConfigured } from './sms';

// 记录已经发过短信提醒的待办任务，避免重复发
rawDatabase.exec(`CREATE TABLE IF NOT EXISTS task_sms_sent (task_id TEXT PRIMARY KEY, sent_at TEXT NOT NULL)`);

function ownerPhone(): string | null {
  const row = rawDatabase.prepare(`SELECT phone FROM accounts WHERE role='owner' AND active=1 AND phone IS NOT NULL AND phone!='' LIMIT 1`).get() as { phone?: string } | undefined;
  return row?.phone || null;
}

interface TaskRow { id: string; data: string; }

async function checkOnce() {
  try {
    if (!progressNoticeConfigured()) return;
    const phone = ownerPhone();
    if (!phone) return;
    const now = Date.now();
    const rows = rawDatabase.prepare(`SELECT id, data FROM records WHERE kind='task'`).all().flatMap(row=>typeof row.id==='string'&&typeof row.data==='string'?[{id:row.id,data:row.data}]:[]);
    for (const row of rows) {
      let task: any;
      try { task = JSON.parse(row.data); } catch { continue; }
      if (task.done || task.deleted) continue;
      if (typeof task.due_at !== 'string') continue;
      const due = Date.parse(task.due_at);
      if (!Number.isFinite(due) || due > now) continue;
      const sent = rawDatabase.prepare(`SELECT 1 FROM task_sms_sent WHERE task_id=?`).get(row.id);
      if (sent) continue;
      const title = (task.title || '未命名任务').slice(0, 60);
      const project = task.project_name || '';
      try {
        await sendProgressNotice(phone, project.slice(0, 60), '待办提醒', title);
        rawDatabase.prepare(`INSERT OR REPLACE INTO task_sms_sent (task_id, sent_at) VALUES (?, ?)`).run(row.id, new Date().toISOString());
      } catch { /* 失败下次重试 */ }
    }
  } catch { /* 静默 */ }
}

setTimeout(() => { checkOnce(); setInterval(checkOnce, 60000); }, 10000);
