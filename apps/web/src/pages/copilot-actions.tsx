/**
 * Copilot action cards (in the panel) and the two pages that list them:
 *  - "Waiting for your OK": approval cards the Copilot proposed; Approve runs the same CRM service as you.
 *  - "Done by Copilot": automatic changes, each with Undo for 7 days (refused if the record changed since).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, Clock, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { dateTime, get, post } from '../lib/api.ts';
import { Badge, Button, EmptyState, PageHeader, Query, Table, useAction } from '../lib/ui.tsx';

export interface CopilotAction {
  id: string;
  tool: string;
  tier: 'auto' | 'approval' | 'draft';
  status: string;
  summary: string;
  target: { type: string; id: string } | null;
  undoable: boolean;
}
interface LedgerRow extends CopilotAction {
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
  undoUntil: string | null;
  runKind: string;
  reason: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  executed: 'Done',
  proposed: 'Waiting for your OK',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
  undone: 'Undone',
  failed: 'Failed',
  conflict: 'Record changed',
};
const tone = (s: string) =>
  s === 'executed' || s === 'approved' ? 'ok' : s === 'proposed' ? 'warn' : s === 'failed' || s === 'conflict' ? 'danger' : 'neutral';

function useDecide(id: string, onDone: (status: string) => void) {
  const qc = useQueryClient();
  // Approving or undoing changes records anywhere in the app: refresh everything.
  const refresh = () => void qc.invalidateQueries();
  const approve = useAction(() => post<{ status: string }>(`/copilot/actions/${id}/approve`), {
    success: 'Approved and done',
    onDone: (r) => {
      onDone(r.status);
      refresh();
    },
  });
  const reject = useAction(() => post<{ status: string }>(`/copilot/actions/${id}/reject`), {
    success: 'Rejected',
    onDone: (r) => {
      onDone(r.status);
      refresh();
    },
  });
  const undo = useAction(() => post<{ status: string }>(`/copilot/actions/${id}/undo`), {
    success: 'Undone',
    onDone: (r) => {
      onDone(r.status);
      refresh();
    },
  });
  return { approve, reject, undo };
}

export function ActionCard({ action }: { action: CopilotAction }) {
  const [status, setStatus] = useState(action.status);
  const { approve, reject, undo } = useDecide(action.id, setStatus);
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm" data-testid="copilot-action">
      <div className="flex items-start gap-2">
        <Bot className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        <p className="flex-1 text-ink">{action.summary}</p>
        <Badge tone={tone(status)}>{STATUS_LABEL[status] ?? status}</Badge>
      </div>
      {status === 'proposed' && action.tier === 'approval' && (
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" className="h-7" onClick={() => reject.run(undefined)} disabled={reject.busy || approve.busy}>
            <X className="size-3.5" aria-hidden /> Reject
          </Button>
          <Button className="h-7" onClick={() => approve.run(undefined)} disabled={reject.busy || approve.busy}>
            <Check className="size-3.5" aria-hidden /> Approve
          </Button>
        </div>
      )}
      {status === 'executed' && action.undoable && (
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" className="h-7" onClick={() => undo.run(undefined)} disabled={undo.busy}>
            <Undo2 className="size-3.5" aria-hidden /> Undo
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({ a, mode }: { a: LedgerRow; mode: 'pending' | 'done' }) {
  const [status, setStatus] = useState(a.status);
  const { approve, reject, undo } = useDecide(a.id, setStatus);
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-3 py-2.5">
        <p className="text-ink">{a.summary}</p>
        {a.reason && <p className="mt-0.5 text-xs text-muted">{a.reason}</p>}
      </td>
      <td className="px-3 py-2.5 text-xs text-muted">{a.runKind === 'chat' ? 'Chat' : 'Background'}</td>
      <td className="px-3 py-2.5 text-xs text-muted">{dateTime(a.createdAt)}</td>
      <td className="px-3 py-2.5">
        <Badge tone={tone(status)}>{STATUS_LABEL[status] ?? status}</Badge>
      </td>
      <td className="px-3 py-2.5 text-right">
        {mode === 'pending' && status === 'proposed' && (
          <span className="inline-flex gap-2">
            <Button variant="secondary" className="h-7" onClick={() => reject.run(undefined)} disabled={approve.busy || reject.busy}>
              Reject
            </Button>
            <Button className="h-7" onClick={() => approve.run(undefined)} disabled={approve.busy || reject.busy}>
              Approve
            </Button>
          </span>
        )}
        {mode === 'done' && status === 'executed' && a.undoable && (
          <Button variant="secondary" className="h-7" onClick={() => undo.run(undefined)} disabled={undo.busy}>
            <Undo2 className="size-3.5" aria-hidden /> Undo
          </Button>
        )}
      </td>
    </tr>
  );
}

export function CopilotApprovalsPage() {
  const q = useQuery({ queryKey: ['copilot-actions', 'pending'], queryFn: () => get<{ items: LedgerRow[] }>('/copilot/actions?view=pending') });
  return (
    <div className="space-y-4">
      <PageHeader
        title="Waiting for your OK"
        subtitle="Changes the Copilot proposed. Nothing happens until you approve. Cards expire after 24 hours or when the record changes."
        icon={<Clock className="size-5" />}
      />
      <Query q={q}>
        {(d) =>
          d.items.length ? (
            <Table head={['Proposed change', 'From', 'When', 'Status', '']}>
              {d.items.map((a) => (
                <Row key={a.id} a={a} mode="pending" />
              ))}
            </Table>
          ) : (
            <EmptyState title="Nothing waiting" hint="When the Copilot proposes a change that needs your OK, it appears here." />
          )
        }
      </Query>
    </div>
  );
}

export function CopilotDonePage() {
  const q = useQuery({ queryKey: ['copilot-actions', 'done'], queryFn: () => get<{ items: LedgerRow[] }>('/copilot/actions?view=done') });
  return (
    <div className="space-y-4">
      <PageHeader
        title="Done by Copilot"
        subtitle="Changes the Copilot made for you. Undo works for 7 days, unless the record has changed since."
        icon={<Bot className="size-5" />}
      />
      <Query q={q}>
        {(d) =>
          d.items.length ? (
            <Table head={['Change', 'From', 'When', 'Status', '']}>
              {d.items.map((a) => (
                <Row key={a.id} a={a} mode="done" />
              ))}
            </Table>
          ) : (
            <EmptyState title="Nothing yet" hint="Tasks, AI notes and lead scores the Copilot adds for you appear here, with Undo." />
          )
        }
      </Query>
    </div>
  );
}
