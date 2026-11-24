/**
 * Facts pack for the narrative agent (pure): the only things the AI model is given, each with an id it must cite.
 * Internal figures (E-11 unmatched rows, E-12 status mismatches) and internal flags are never included, so they
 * cannot leak into client text. Free text typed by people (titles, meeting outcomes) is sanitized and shortened.
 */
import type { WeeklyItemState, WeeklyMetricsDoc } from '../../db/schema-weekly-reports.ts';
import { type AiContext, estimateTokens, sanitizeText } from '../ai/context.ts';
import type { WeeklySnapshot } from './collect.ts';
import { periodLabel } from './period.ts';

const LIST_CAP = 25;
const scopeFact = (i: WeeklyItemState) => ({
  id: `scope:${i.rowId}`,
  scopeId: i.scopeId,
  title: sanitizeText(i.title, 200),
  phase: i.phase,
  estimateHours: i.estimateHours,
});

export function buildWeeklyFacts(snapshot: WeeklySnapshot, doc: WeeklyMetricsDoc, orgName: string): AiContext {
  const done = doc.items.filter((i) => i.state === 'done');
  // Items finished this week come first, so they survive the cap.
  const doneOrdered = [...done.filter((i) => i.doneThisWeek), ...done.filter((i) => !i.doneThisWeek)].slice(0, LIST_CAP);
  const facts: Record<string, unknown> = {
    sellerOrganization: orgName,
    accountOwner: snapshot.company.ownerName,
    client: { id: `company:${snapshot.company.id}`, name: snapshot.company.name },
    period: { id: 'period', start: snapshot.period.start, end: snapshot.period.end, label: periodLabel(snapshot.period.start, snapshot.period.end) },
    metrics: doc.metrics
      .filter((m) => !m.internal && m.value !== null)
      .map((m) => ({ id: `metric:${m.id}`, label: m.label, value: m.value, unit: m.unit, delta: m.delta ?? null })),
    scopeDone: doneOrdered.map((i) => ({ ...scopeFact(i), completedThisWeek: i.doneThisWeek })),
    scopeInProgress: doc.items
      .filter((i) => i.state === 'in_progress')
      .slice(0, LIST_CAP)
      .map(scopeFact),
    scopeNext: doc.items
      .filter((i) => i.state === 'not_started')
      .slice(0, 5)
      .map(scopeFact),
    meetings: snapshot.activities.slice(0, 10).map((a) => ({
      id: `activity:${a.id}`,
      kind: a.kind,
      date: a.occurredAt.slice(0, 10),
      outcome: a.outcome ? sanitizeText(a.outcome, 200) : null,
    })),
    upcomingTasks: doc.upcomingTasks.slice(0, 10).map((t) => ({ id: `task:${t.id}`, title: sanitizeText(t.title, 200), dueDate: t.dueDate })),
  };
  return {
    facts,
    untrusted: [],
    refs: [
      { type: 'company', id: snapshot.company.id },
      { type: 'estimate_import', id: snapshot.estimates.importId },
    ],
    estimatedTokens: estimateTokens(facts),
    omittedTexts: 0,
  };
}

/** Every id a statement may cite: the `id` fields anywhere in the facts. */
export function allowedSourceIds(facts: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(facts)) for (const v of facts) allowedSourceIds(v, out);
  else if (facts && typeof facts === 'object')
    for (const [k, v] of Object.entries(facts)) {
      if (k === 'id' && typeof v === 'string') out.add(v);
      else allowedSourceIds(v, out);
    }
  return out;
}
