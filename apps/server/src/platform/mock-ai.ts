/**
 * MockAiProvider — the deterministic stand-in for a real model.
 *  - Used when AI_PROVIDER=fake (local development, automated tests). It makes no network call and costs nothing.
 *  - It reads the SAME prompt a real provider receives (<task> and <crm_context> JSON) and builds its answer only from
 *    those facts, so the full pipeline — context, validation, approval, usage — is exercised for real.
 *  - Tests can script the next responses (`enqueue`) to simulate provider failures, malformed output or rate limits.
 * Its answers are template text, not model output, and every screen labels them "simulator".
 */
import { type AiProvider, AiProviderError, type AiProviderStatus, type AiRequest, type AiResult } from './ports.ts';

type Scripted = AiProviderError | { text: string } | ((req: AiRequest) => string);
// biome-ignore lint/suspicious/noExplicitAny: the mock reads loosely-typed prompt JSON
type Json = Record<string, any>;

const block = (text: string, tag: string): Json => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  try {
    return m ? (JSON.parse(m[1] as string) as Json) : {};
  } catch {
    return {};
  }
};
const sentence = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};
const firstSentence = (s: string) => /^[\s\S]*?[.!?](?=\s|$)/.exec(s.trim())?.[0] ?? s.trim();
const digits = (s: string) => s.replace(/[^0-9.]/g, '').replace(/\.0+$/, '');

function draft(task: Json, c: Json): Json {
  const company = c.company?.name ?? 'your organization';
  const seller = c.sellerOrganization ?? 'our team';
  const primary = (c.contacts ?? []).find((x: Json) => x.isPrimary) ?? c.contacts?.[0];
  const items: string[] = (c.proposal?.lineItems ?? []).map((l: Json) => l.name);
  const offer = items.length ? items.join(', ') : 'the services described in this proposal';
  const extra = task.instructions ? ` ${sentence(String(task.instructions))}${/[.!?]$/.test(String(task.instructions).trim()) ? '' : '.'}` : '';
  const write = (title: string): string => {
    const t = title.toLowerCase();
    if (t.includes('intro') || t.includes('summary') || t.includes('overview')) {
      return `${primary?.firstName ? `Dear ${primary.firstName},\n\n` : ''}Thank you for the opportunity to work with ${company}. This proposal from ${seller} sets out how we will support ${c.deal?.name ?? 'your project'}.\n\nIt covers ${offer}. We have kept the scope focused on what we discussed and welcome your feedback.${extra}`;
    }
    if (t.includes('scope') || t.includes('approach') || t.includes('deliver')) {
      return `For ${company}, our scope covers ${offer}.\n\nWe will agree the detailed plan and responsibilities with your team at kick-off, and confirm any dependencies before work starts.${extra}`;
    }
    if (t.includes('next') || t.includes('term')) {
      return `To proceed, please review this proposal and let us know of any questions. Once you are ready, we will arrange a kick-off with the ${company} team.${extra}`;
    }
    return `This section describes ${title.toLowerCase()} for ${company} in relation to ${offer}.${extra}`;
  };
  return { sections: (task.sections ?? []).map((s: Json) => ({ sectionId: s.id, text: write(String(s.title ?? '')) })) };
}

function review(c: Json): Json {
  const findings: Json[] = [];
  const p = c.proposal ?? {};
  const allowed = new Set<string>();
  const add = (v: unknown) => {
    if (v !== null && v !== undefined && String(v) !== '') allowed.add(digits(String(v)));
  };
  add(p.totals?.oneTime);
  add(p.totals?.contractValueExclTax);
  for (const r of p.totals?.recurring ?? []) add(r.total);
  for (const l of p.lineItems ?? []) add(l.unitPrice);
  add(c.deal?.amount);
  const firstNames: string[] = (c.contacts ?? []).map((x: Json) => String(x.firstName ?? '').toLowerCase()).filter(Boolean);
  for (const s of p.sections ?? []) {
    const text = String(s.text ?? '');
    const claim = /\b(guarantee[ds]?|100%|risk[- ]free|always|never fails?)\b/i.exec(text);
    if (claim) {
      findings.push({
        category: 'unsupported_claim',
        sectionId: s.id,
        quote: claim[0],
        description: `"${claim[0]}" is a commitment with no basis in the CRM record.`,
        suggestion: 'Remove it or replace it with a statement you can evidence.',
      });
    }
    for (const m of text.matchAll(/(?:\$|USD\s?|EUR\s?|£|€)\s?(\d[\d,]{2,}(?:\.\d{1,2})?)/g)) {
      if (!allowed.has(digits(m[1] as string))) {
        findings.push({
          category: 'amount_mismatch',
          sectionId: s.id,
          quote: m[0],
          description: `The figure ${m[0]} does not match any price or total in the pricing table.`,
          suggestion: `Use the figures from the pricing table (contract value ${p.currency ?? ''} ${p.totals?.contractValueExclTax ?? ''}).`.trim(),
        });
      }
    }
    const dear = /\bDear\s+([A-Z][a-z]+)\b/.exec(text);
    if (dear && firstNames.length && !firstNames.includes((dear[1] as string).toLowerCase())) {
      findings.push({
        category: 'contact_name_mismatch',
        sectionId: s.id,
        quote: dear[0],
        description: `"${dear[1]}" is not a contact on this deal.`,
        suggestion: `Address ${c.contacts[0].fullName ?? c.contacts[0].firstName}.`,
      });
    }
  }
  return { findings };
}

function summary(c: Json): Json {
  const d = c.deal ?? {};
  const company = c.company?.name ?? 'the customer';
  const proposals: Json[] = c.proposals ?? [];
  const eng = c.buyerEngagement ?? {};
  const tasks: Json[] = c.openTasks ?? [];
  const viewed = (eng.recipients ?? []).filter((r: Json) => r.viewCount > 0);
  const keyPoints: string[] = [];
  if (proposals[0])
    keyPoints.push(`Latest proposal "${proposals[0].title}" is ${proposals[0].status}${proposals[0].sentDate ? ` (sent ${proposals[0].sentDate})` : ''}.`);
  if (eng.linksShared)
    keyPoints.push(
      viewed.length ? `${viewed.map((r: Json) => r.recipientName).join(', ')} opened the proposal.` : 'The proposal has been shared but not opened yet.',
    );
  const logged = c.activity?.callsAndMeetings ?? [];
  if (logged.length) keyPoints.push(`${logged.length} call(s) or meeting(s) logged, most recently on ${logged[0].date}.`);
  if (c.activity?.notesCount) keyPoints.push(`${c.activity.notesCount} note(s) recorded on the deal.`);
  const risks: string[] = [];
  if ((d.flags ?? []).includes('stalled')) risks.push('Flagged as stalled: no recent activity is recorded.');
  if ((d.flags ?? []).includes('past_close_date')) risks.push('The expected close date has passed.');
  if (eng.linksShared && !viewed.length) risks.push('Based on engagement data: the buyer has not opened the proposal.');
  if (tasks.some((t) => t.overdue)) risks.push('Based on the task list: at least one open task is overdue.');
  if (!(c.contacts ?? []).length) risks.push('No contact is linked to this deal.');
  const nextSteps: string[] = tasks.slice(0, 3).map((t) => `Complete the open task "${t.title}"${t.dueDate ? ` (due ${t.dueDate})` : ''}.`);
  if (!proposals.length && d.status === 'open') nextSteps.push('No proposal exists yet: consider creating one.');
  if (eng.linksShared && !viewed.length) nextSteps.push('Follow up with the recipient about the shared proposal.');
  return {
    overview: `${d.name ?? 'This deal'} with ${company} is ${d.status ?? 'open'} at stage ${d.stage ?? 'unknown'}${d.amount ? `, valued at ${d.currency ?? ''} ${d.amount}` : ''}. The owner is ${d.ownerName ?? 'unassigned'}.`,
    currentStatus: `It has been in the current stage for ${d.daysInCurrentStage ?? 0} day(s)${d.expectedCloseDate ? ` and is expected to close on ${d.expectedCloseDate}` : ''}.`,
    keyPoints,
    risks,
    nextSteps,
    openQuestions: (c.contacts ?? []).some((x: Json) => (x.roles ?? []).includes('Decision-maker'))
      ? []
      : ['Who is the decision-maker? None is recorded on the deal.'],
  };
}

function rewrite(task: Json): Json {
  const text = String(task.selectedText ?? '');
  const tidy = sentence(text);
  switch (task.mode) {
    case 'concise':
      return { replacement: firstSentence(tidy) };
    case 'expand':
      return { replacement: `${tidy} We would be glad to walk you through the details and answer any questions.` };
    case 'friendly':
      return { replacement: `We're pleased to share that ${tidy.charAt(0).toLowerCase()}${tidy.slice(1)}` };
    case 'formal':
      return {
        replacement: tidy
          .replace(/\bwe'll\b/gi, 'we will')
          .replace(/\bcan't\b/gi, 'cannot')
          .replace(/\bdon't\b/gi, 'do not'),
      };
    case 'simplify':
      return {
        replacement: tidy
          .replace(/\butili[sz]e\b/gi, 'use')
          .replace(/\bin order to\b/gi, 'to')
          .replace(/\bfacilitate\b/gi, 'help'),
      };
    case 'custom':
      return { replacement: `${tidy} [${String(task.instructions ?? '').trim()}]` };
    default:
      return { replacement: /[.!?]$/.test(tidy) ? tidy : `${tidy}.` };
  }
}

function followUp(task: Json, c: Json): Json {
  const first = task.recipient?.firstName ?? 'there';
  const title = c.proposal?.title ?? `our proposal for ${c.company?.name ?? 'your team'}`;
  const line: Record<string, string> = {
    initial: `I wanted to follow up on "${title}", which I sent over${c.proposal?.sentDate ? ` on ${c.proposal.sentDate}` : ''}.`,
    viewed: `I hope you have had a chance to look through "${title}". I am happy to answer any questions.`,
    revisited: `I wanted to check whether anything in "${title}" would benefit from a quick conversation.`,
    not_viewed: `I am resending a quick note in case "${title}" got buried in your inbox.`,
    changes_requested: `Thank you for your feedback on "${title}". I would like to confirm the changes you need so I can update it.`,
    gone_quiet: `I wanted to check in on "${title}" and see whether the timing still works for you.`,
  };
  const extra = task.instructions ? `\n\n${sentence(String(task.instructions))}` : '';
  return {
    subject: task.scenario === 'changes_requested' ? `Updating ${title}` : `Following up: ${title}`,
    body: `Hi ${first},\n\n${line[String(task.scenario)] ?? line.initial}${extra}\n\nWould a short call this week be useful?\n\nBest regards,\n${task.senderName ?? ''}`.trim(),
  };
}

/** Weekly client report: statements built only from the facts, each citing the ids it used; numbers are copied, never computed. */
function weeklyReport(c: Json): Json {
  const metric = (id: string): string | null => (c.metrics ?? []).find((m: Json) => m.id === `metric:${id}`)?.value ?? null;
  const client = c.client?.name ?? 'your team';
  const name = (s: Json) => String(s.title ?? '').replace(/[.!?]+$/, '');
  const summary: Json[] = [];
  const done = metric('E-06');
  const pct = metric('E-05');
  if (done !== null && pct !== null)
    summary.push({
      text: `This week we completed ${done} scope ${done === '1' ? 'item' : 'items'} for ${client}, and the project is now ${pct}% complete by estimated hours.`,
      sources: ['metric:E-06', 'metric:E-05'],
    });
  const remaining = metric('E-07');
  const active = metric('E-08');
  if (remaining !== null && active !== null)
    summary.push({
      text: `${remaining} estimated hours remain, with ${active} scope ${active === '1' ? 'item' : 'items'} currently in progress.`,
      sources: ['metric:E-07', 'metric:E-08'],
    });
  if (!summary.length) summary.push({ text: `This is the weekly status report for ${client}.`, sources: [String(c.client?.id ?? 'period')] });
  const completed = (c.scopeDone ?? [])
    .filter((s: Json) => s.completedThisWeek)
    .slice(0, 5)
    .map((s: Json) => ({ text: `We completed ${name(s)}.`, sources: [s.id] }));
  const nextWeek = [
    ...(c.scopeInProgress ?? []).slice(0, 3).map((s: Json) => ({ text: `We will continue work on ${name(s)}.`, sources: [s.id] })),
    ...(c.scopeNext ?? []).slice(0, 2).map((s: Json) => ({ text: `We plan to start ${name(s)}.`, sources: [s.id] })),
  ];
  const overdue = metric('E-10');
  const risks =
    overdue !== null && overdue !== '0'
      ? [
          {
            text: `${overdue} ${overdue === '1' ? 'task is' : 'tasks are'} overdue on scope items and we are prioritising ${overdue === '1' ? 'it' : 'them'}.`,
            sources: ['metric:E-10'],
          },
        ]
      : [];
  return { summary, completed, nextWeek, risks };
}

/**
 * Weekly sales brief: analysis and recommended actions built only from the facts. Every statement cites the ids it
 * used, insights and actions name their signal, numbers are copied (never computed), and causes are stated only when
 * the facts record them.
 */
function salesBrief(c: Json): Json {
  const metricFact = (id: string): Json | undefined => (c.metrics ?? []).find((m: Json) => m.id === `metric:${id}`);
  const metric = (id: string): string | null => metricFact(id)?.value ?? null;
  const signals: Json[] = c.signals ?? [];
  const deals: Json[] = c.deals ?? [];
  const team: Json[] = c.team ?? [];
  const money = (v: unknown) => String(v); // the facts already carry money written as "USD 37,000"
  const amountOf = (v: unknown) => Number(String(v).replace(/[^0-9.-]/g, '')) || 0; // "USD 128,000" → 128000, for sorting only
  const many = (n: unknown, one: string, plural = `${one}s`) => `${n} ${String(n) === '1' ? one : plural}`;
  const short = (text: string) => (text.length <= 300 ? text : `${text.slice(0, text.lastIndexOf(' ', 280))}…`);
  const evidence = (s: Json) => [s.id, ...(s.metrics ?? []), ...(s.records ?? []).slice(0, 4)];
  const person = (s: Json) => team.find((t) => (s.records ?? []).includes(t.id))?.name as string | undefined;

  const headline: Json[] = [];
  const won = metric('S-07');
  const revenue = metric('S-08');
  const created = metric('S-05');
  if (won !== null && revenue !== null && created !== null)
    headline.push({
      text: `This week the team won ${many(won, 'deal')} worth ${money(revenue)} and opened ${many(created, 'new opportunity', 'new opportunities')}.`,
      sources: ['metric:S-07', 'metric:S-08', 'metric:S-05'],
    });
  const pipeline = metric('S-11');
  if (pipeline !== null) headline.push({ text: `The open pipeline stands at ${money(pipeline)}.`, sources: ['metric:S-11'] });
  const top = signals[0];
  if (top) headline.push({ text: `The main point to look at: ${short(String(top.finding)).replace(/\.$/, '')}.`, sources: evidence(top) });
  if (!headline.length) headline.push({ text: `This is the weekly sales brief for ${c.organization ?? 'the company'}.`, sources: ['period'] });

  const meaning: Record<string, string> = {
    risk: 'This puts revenue at risk if nothing changes.',
    bottleneck: 'This step limits how many leads become deals.',
    concentration: 'Results depend heavily on one place.',
    team: 'It is worth checking whether work is happening but not being logged.',
    trend: 'It is worth checking what changed.',
    opportunity: 'This may be worth more attention.',
  };
  const insights = signals.slice(0, 5).map((s) => ({
    text: short(`${String(s.finding)} ${meaning[String(s.kind)] ?? ''}`.trim()),
    sources: evidence(s),
    signalIds: [s.id],
    kind: s.kind,
  }));

  const actionFor = (s: Json): string | null => {
    const finding = String(s.finding);
    const who = person(s);
    // Singular or plural follows the number of deals the finding names (its "deal:" evidence).
    const one = (Array.isArray(s.records) ? s.records : []).filter((r) => String(r).startsWith('deal:')).length === 1;
    if (s.kind === 'risk' && finding.includes('stalled'))
      return one
        ? 'Review the stalled deal with its owner and agree one next step.'
        : 'Review the stalled deals with their owners and agree one next step for each.';
    if (s.kind === 'risk' && finding.includes('stage time limit'))
      return one
        ? 'Decide whether to move the deal over its stage time limit forward or close it.'
        : 'Decide for each deal over its stage time limit whether to move it forward or close it.';
    if (s.kind === 'risk' && finding.includes('expected close date'))
      return one ? 'Ask the owner to update the expected close date that has passed.' : 'Ask the owners to update the expected close dates that have passed.';
    if (s.kind === 'risk' && finding.includes('not been viewed'))
      return one ? 'Follow up with the buyer whose proposal has not been viewed.' : 'Follow up with the buyers whose proposals have not been viewed.';
    if (s.kind === 'concentration') return 'Build more pipeline alongside the largest position so results do not depend on it.';
    if (s.kind === 'team')
      return who ? `Check in with ${who} about their open deals and whether activity is being logged.` : 'Check in with the rep about their open deals.';
    if (s.kind === 'bottleneck') return 'Look at the weakest funnel step before adding more leads at the top.';
    if (s.kind === 'trend' && finding.includes('fell')) return 'Look into what is behind the drop before next week.';
    if (s.kind === 'opportunity') return 'Consider putting more effort into the lead source that converted best.';
    return null;
  };
  const actions: Json[] = [];
  for (const s of signals) {
    const text = actionFor(s);
    if (text && actions.length < 4 && !actions.some((a) => a.text === text)) actions.push({ text, sources: evidence(s), signalIds: [s.id] });
  }

  const throughput: Json[] = [];
  const [leads, qualified, converted] = [metric('S-01'), metric('S-02'), metric('S-03')];
  if (leads !== null && qualified !== null && converted !== null)
    throughput.push({
      text: `${many(leads, 'new lead')} came in, ${qualified} ${qualified === '1' ? 'was' : 'were'} qualified and ${converted} converted.`,
      sources: ['metric:S-01', 'metric:S-02', 'metric:S-03'],
    });
  const rate = metric('S-04');
  if (rate !== null) throughput.push({ text: `Lead conversion rate was ${rate}.`, sources: ['metric:S-04'] }); // the fact is written "66.7%"
  const bottleneck = signals.find((s) => s.kind === 'bottleneck');
  if (bottleneck) throughput.push({ text: short(String(bottleneck.finding)), sources: evidence(bottleneck) });

  const wins = deals
    .filter((d) => d.status === 'won')
    .slice(0, 3)
    .map((d) => ({ text: d.amount ? `${d.owner} won ${d.name} for ${money(d.amount)}.` : `${d.owner} won ${d.name}.`, sources: [d.id] }));

  const pipelineLines: Json[] = [];
  if (pipeline !== null) pipelineLines.push({ text: `Open pipeline is ${money(pipeline)}.`, sources: ['metric:S-11'] });
  const stages: Json[] = [...(c.pipelineByStage ?? [])].sort((a, b) => amountOf(b.value) - amountOf(a.value));
  if (stages[0])
    pipelineLines.push({
      text: `The largest stage is ${stages[0].stage} with ${many(stages[0].deals, 'deal')} worth ${money(stages[0].value)}.`,
      sources: ['metric:S-11'],
    });
  const advanced = metric('S-06');
  if (advanced !== null)
    pipelineLines.push({ text: `${many(advanced, 'opportunity', 'opportunities')} moved forward a stage this week.`, sources: ['metric:S-06'] });

  const risks: Json[] = deals
    .filter((d) => d.status === 'lost')
    .slice(0, 2)
    .map((d) => ({ text: `${d.name} was lost; the recorded reason is ${d.lostReason}.`, sources: [d.id] }));
  const attention = metricFact('S-13');
  if (attention && attention.value !== '0')
    risks.push({ text: `${many(attention.value, 'open deal')} need attention (${attention.detail}).`, sources: ['metric:S-13'] });

  const teamLines: Json[] = [];
  const best = [...team].filter((t) => Number(t.dealsWon ?? 0) > 0).sort((a, b) => amountOf(b.revenueWon) - amountOf(a.revenueWon))[0];
  if (best) teamLines.push({ text: `${best.name} won ${many(best.dealsWon, 'deal')} worth ${money(best.revenueWon)}.`, sources: [best.id] });
  const activity = metricFact('S-15');
  if (activity) teamLines.push({ text: `The team logged ${many(activity.value, 'activity', 'activities')} (${activity.detail}).`, sources: ['metric:S-15'] });

  return {
    headline: headline.slice(0, 3),
    insights,
    actions,
    throughput: throughput.slice(0, 3),
    wins,
    pipeline: pipelineLines.slice(0, 3),
    risks: risks.slice(0, 4),
    team: teamLines.slice(0, 3),
  };
}

export class MockAiProvider implements AiProvider {
  readonly name = 'fake';
  readonly simulated = true;
  /** Every request received, for assertions in tests. */
  readonly calls: AiRequest[] = [];
  private readonly script: Scripted[] = [];

  /** Queue what the next call(s) should do instead of the built-in deterministic answer. */
  enqueue(...items: Scripted[]): void {
    this.script.push(...items);
  }
  reset(): void {
    this.script.length = 0;
    this.calls.length = 0;
  }
  status(): AiProviderStatus {
    return { provider: this.name, simulated: true, configured: true, detail: 'Built-in simulator: deterministic template text, no external calls, no cost' };
  }

  async complete(req: AiRequest): Promise<AiResult> {
    this.calls.push(req);
    const scripted = this.script.shift();
    if (scripted instanceof AiProviderError) throw scripted;
    const task = block(req.user, 'task');
    const context = block(req.user, 'crm_context');
    let text: string;
    if (typeof scripted === 'function') text = scripted(req);
    else if (scripted) text = scripted.text;
    else {
      const answer =
        req.feature === 'draft_section'
          ? draft(task, context)
          : req.feature === 'presend_review'
            ? review(context)
            : req.feature === 'deal_summary'
              ? summary(context)
              : req.feature === 'rewrite_text'
                ? rewrite(task)
                : req.feature === 'weekly_report'
                  ? weeklyReport(context)
                  : req.feature === 'sales_brief'
                    ? salesBrief(context)
                    : followUp(task, context);
      text = JSON.stringify(answer);
    }
    return {
      text,
      model: 'mock-deterministic-1',
      inputTokens: Math.ceil((req.system.length + req.user.length) / 4),
      outputTokens: Math.ceil(text.length / 4),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      providerRequestId: `mock_${req.requestId.slice(0, 8)}`,
    };
  }
}
