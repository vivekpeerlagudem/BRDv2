/**
 * Accept / Decline banner with a countdown (accept-and-escalate), shown at the top of the lead inbox.
 * Lists the user's waiting assignments and the ones escalated to them. The deadline comes from the server.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, Clock, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api.ts';
import { Button, Input, useAction } from '../lib/ui.tsx';

interface Assignment {
  id: string;
  recordType: 'lead' | 'deal';
  recordId: string;
  recordLabel: string;
  assigneeId: string;
  assigneeName: string | null;
  status: string;
  secondsLeft: number;
}

/** "1 h 05 min left" or "12 min late". */
export function countdown(seconds: number): string {
  const late = seconds < 0;
  const m = Math.floor(Math.abs(seconds) / 60);
  const text = m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
  return late ? `${text} late` : `${text} left`;
}

function Item({ a, mine, loadedAt, now }: { a: Assignment; mine: boolean; loadedAt: number; now: number }) {
  const qc = useQueryClient();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['assignments'] });
  const accept = useAction(() => post(`/assignments/${a.id}/accept`), { success: 'Accepted', onDone: refresh });
  const decline = useAction(() => post(`/assignments/${a.id}/decline`, { reason }), { success: 'Declined — your manager was told', onDone: refresh });
  const left = a.secondsLeft - Math.round((now - loadedAt) / 1000);
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-amber-200 px-3 py-2 last:border-0" data-testid="assignment-banner-item">
      <Clock className="size-4 text-warn" aria-hidden />
      <span className="min-w-0 flex-1 text-sm">
        {a.recordType === 'deal' ? (
          <Link to="/deals/$id" params={{ id: a.recordId }} className="font-medium hover:text-brand">
            {a.recordLabel}
          </Link>
        ) : (
          <span className="font-medium">{a.recordLabel}</span>
        )}
        {!mine && a.assigneeName && <span className="text-muted"> · assigned to {a.assigneeName}</span>}
        <span className={`ml-2 text-xs ${left < 0 ? 'font-semibold text-danger' : 'text-muted'}`} data-testid="assignment-countdown">
          {a.status === 'pending' ? countdown(left) : `escalated · ${countdown(left)}`}
        </span>
      </span>
      {declining ? (
        <span className="flex items-center gap-2">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why? (your manager sees this)"
            className="w-56"
            aria-label="Decline reason"
          />
          <Button variant="danger" className="h-7" disabled={!reason.trim() || decline.busy} onClick={() => decline.run(undefined)}>
            Decline
          </Button>
          <Button variant="ghost" className="h-7" onClick={() => setDeclining(false)}>
            Cancel
          </Button>
        </span>
      ) : (
        <span className="flex gap-2">
          {mine && (
            <Button variant="secondary" className="h-7" onClick={() => setDeclining(true)}>
              <X className="size-3.5" aria-hidden /> Decline
            </Button>
          )}
          <Button className="h-7" onClick={() => accept.run(undefined)} disabled={accept.busy}>
            <Check className="size-3.5" aria-hidden /> Accept
          </Button>
        </span>
      )}
    </li>
  );
}

export function AssignmentBanner({ userId }: { userId: string }) {
  const q = useQuery({ queryKey: ['assignments', 'mine'], queryFn: () => get<{ items: Assignment[] }>('/assignments?mine=1'), refetchInterval: 60_000 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!q.data?.items.length) return null;
  return (
    <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50" data-testid="assignment-banner" aria-label="Leads waiting for you to accept">
      <p className="border-b border-amber-200 px-3 py-2 text-[13px] font-semibold text-amber-900">Accept your new leads before the time runs out</p>
      <ul>
        {q.data.items.map((a) => (
          <Item key={a.id} a={a} mine={a.assigneeId === userId} loadedAt={q.dataUpdatedAt} now={now} />
        ))}
      </ul>
    </section>
  );
}
