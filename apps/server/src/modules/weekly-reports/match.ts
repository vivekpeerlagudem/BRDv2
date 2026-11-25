/**
 * Matcher (pure): links each scope row of the estimates sheet to CRM tasks and decides its state.
 *
 * A row matches a task when the task title contains "[<scope id>]" (case-insensitive); rows without a hit match
 * a task with the same normalized title. When several tasks match, an open one decides (work remains), else the
 * most recently completed one. When the sheet and the CRM disagree, the CRM wins and the row is flagged internally.
 */
import type { SheetStatus } from '../../db/schema-weekly-reports.ts';

export interface MatchItem {
  id: string;
  rowNo: number;
  scopeId: string | null;
  title: string;
  phase: string | null;
  estimateHours: string;
  sheetStatus: SheetStatus | null;
  pctDone: string | null;
  actualHours: string | null;
}
export interface MatchTask {
  id: string;
  title: string;
  status: 'open' | 'completed' | 'cancelled';
  dueAt: string;
  completedAt: string | null;
}
export interface MatchedItem {
  item: MatchItem;
  state: SheetStatus;
  /** Completion time of the matched task (ISO); null for rows decided by the sheet alone. */
  doneAt: string | null;
  taskId: string | null;
  /** Due date of the matched OPEN task (ISO), for overdue checks. */
  openTaskDueAt: string | null;
  mismatch: boolean;
}

export const normalizeTitle = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');

function sheetState(item: MatchItem): SheetStatus {
  if (item.sheetStatus) return item.sheetStatus;
  const pct = item.pctDone === null ? null : Number(item.pctDone);
  if (pct !== null && pct >= 100) return 'done';
  if (pct !== null && pct > 0) return 'in_progress';
  return 'not_started';
}

export function matchItems(items: MatchItem[], tasks: MatchTask[]): MatchedItem[] {
  const live = tasks.filter((t) => t.status !== 'cancelled').map((t) => ({ task: t, lower: t.title.toLowerCase(), norm: normalizeTitle(t.title) }));
  return items.map((item) => {
    const tag = item.scopeId ? `[${item.scopeId.toLowerCase()}]` : null;
    let hits = tag ? live.filter((t) => t.lower.includes(tag)) : [];
    if (!hits.length) {
      const norm = normalizeTitle(item.title);
      hits = live.filter((t) => t.norm === norm);
    }
    if (!hits.length) return { item, state: sheetState(item), doneAt: null, taskId: null, openTaskDueAt: null, mismatch: false };
    const open = hits.filter((h) => h.task.status === 'open').sort((a, b) => a.task.dueAt.localeCompare(b.task.dueAt))[0];
    if (open) {
      const state: SheetStatus = item.sheetStatus === 'not_started' ? 'not_started' : 'in_progress';
      return { item, state, doneAt: null, taskId: open.task.id, openTaskDueAt: open.task.dueAt, mismatch: item.sheetStatus === 'done' };
    }
    const done = hits.sort((a, b) => (b.task.completedAt ?? '').localeCompare(a.task.completedAt ?? ''))[0]!;
    return {
      item,
      state: 'done',
      doneAt: done.task.completedAt,
      taskId: done.task.id,
      openTaskDueAt: null,
      mismatch: item.sheetStatus !== null && item.sheetStatus !== 'done',
    };
  });
}
