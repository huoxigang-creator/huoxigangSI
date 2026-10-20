export const PROGRESS_STAGES = [
  {status: '意向', label: '意向'},
  {status: '洽谈中', label: '洽谈'},
  {status: '设计中', label: '设计'},
  {status: '生产中', label: '生产'},
  {status: '安装中', label: '安装'},
  {status: '收尾中', label: '收尾'},
  {status: '已完工', label: '已完工'},
] as const;

export type PublicProgress = {name: string; stage: string; summary: string; asOf: string};
export type ProgressTask = {id?: string; title?: string; project?: string; due_at?: string; date?: string; done?: boolean; deleted?: boolean; assignee?: string; created?: string};

export function progressStep(status: unknown): number {
  if (status === '已归档') return PROGRESS_STAGES.length - 1;
  return PROGRESS_STAGES.findIndex(stage => stage.status === status);
}

/** Owner-facing content is built from an explicit allowlist, never from logs or tasks. */
export function publicProgress(project: {name?: unknown; status?: unknown}, now = Date.now()): PublicProgress {
  const index = progressStep(project.status);
  const stage = project.status === '已归档' ? '已归档' : index >= 0 ? PROGRESS_STAGES[index].status : '未设置阶段';
  const name = typeof project.name === 'string' && project.name.trim() ? project.name.trim() : '项目';
  return {
    name,
    stage,
    summary: index < 0 ? '当前工作环节尚未登记。' : stage === '已归档' ? '项目当前已归档。' : stage === '已完工' ? '项目当前已完工。' : `当前工作环节：${PROGRESS_STAGES[index].label}。`,
    asOf: new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(now)),
  };
}

export function publicProgressText(progress: PublicProgress, ownerNote = ''): string {
  return [
    `${progress.name} · 工作进展`,
    `更新日期：${progress.asOf}`,
    `当前环节：${progress.stage}`,
    progress.summary,
    ...(ownerNote.trim() ? [`补充说明：${ownerNote.trim()}`] : []),
  ].join('\n');
}

function taskDeadline(task: ProgressTask): number {
  const value = task.due_at || (task.date ? `${task.date}T23:59:59+08:00` : '');
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

/** Earliest unresolved deadlines come first; undated work follows them. */
export function upcomingProjectTasks<T extends ProgressTask>(tasks: T[], limit = 3): T[] {
  return tasks.filter(task => !task.done && !task.deleted)
    .sort((a, b) => taskDeadline(a) - taskDeadline(b) || String(a.created || '').localeCompare(String(b.created || '')))
    .slice(0, limit);
}

export function taskIsOverdue(task: ProgressTask, now = Date.now()): boolean {
  return !task.done && taskDeadline(task) < now;
}
