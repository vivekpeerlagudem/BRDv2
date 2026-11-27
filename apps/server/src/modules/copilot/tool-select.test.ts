import { describe, expect, it } from 'vitest';
import './actions.ts'; // registers the write tools
import './assignments.ts';
import { pickPlaybook, selectTools } from './tool-select.ts';
import { toolsForRole } from './tools.ts';

const names = (
  question: string,
  openType: Parameters<typeof selectTools>[0]['openType'] = null,
  role: 'salesperson' | 'sales_manager' | 'admin' = 'salesperson',
) => selectTools({ question, openType, roleTools: toolsForRole(role) }).tools.map((t) => t.name);

describe('tool pre-filter (deterministic keyword rules)', () => {
  it('sends team and total questions to pipeline_report / kpis', () => {
    expect(names('What is my open pipeline value and weighted forecast?')).toContain('pipeline_report');
    expect(names('What are my key figures: won revenue and win rate?')).toEqual(expect.arrayContaining(['kpis', 'pipeline_report']));
    expect(names('How is my team doing?', null, 'sales_manager')).toContain('pipeline_report');
  });
  it('offers the write tool an action question needs', () => {
    expect(names('Score this lead', 'lead')).toContain('set_lead_score');
    expect(names('Create follow-ups for my stalled deals')).toEqual(expect.arrayContaining(['list_deals', 'create_task']));
    expect(names('Summarise this deal and save a note about it', 'deal')).toEqual(expect.arrayContaining(['get_record', 'add_ai_note']));
    expect(names('Accept my new lead')).toEqual(expect.arrayContaining(['my_lead_inbox', 'accept_assignment']));
    expect(names('Move this deal to Negotiation', 'deal')).toContain('move_deal_stage');
  });
  it('sends far fewer tools than the full list, always sorted, never get_playbook', () => {
    const all = toolsForRole('salesperson').length;
    const some = names('How many open deals do I have?');
    expect(some.length).toBeLessThan(all / 2);
    expect(some).toEqual([...some].sort());
    expect(some).not.toContain('get_playbook');
    expect(names('How many open deals do I have?')).toEqual(some); // same kind of question, byte-identical list
  });
  it('falls back to the whole role list when nothing matches, and never offers another role’s tools', () => {
    const r = selectTools({ question: 'hello there', openType: null, roleTools: toolsForRole('salesperson') });
    expect(r.fallback).toBe(true);
    expect(r.tools.length).toBe(toolsForRole('salesperson').length - 1);
    expect(names('Show me the latest sales brief')).not.toContain('sales_brief_latest');
    expect(names('Show me the latest sales brief', null, 'admin')).toContain('sales_brief_latest');
  });
});

describe('playbook choice', () => {
  it('gives action requests the "call the tool" examples', () => {
    expect(pickPlaybook('Create follow-ups for my stalled deals', null)?.name).toBe('take-action');
    expect(pickPlaybook('Accept my new lead', null)?.name).toBe('take-action');
    expect(pickPlaybook('Score this lead', 'lead')?.name).toBe('lead-triage');
    expect(pickPlaybook('Score this lead', 'lead')?.text).toMatch(/CALL set_lead_score/);
    expect(pickPlaybook('Create follow-ups for my stalled deals', null)?.text).toMatch(/CALL THE TOOL/);
  });
  it('picks the report steps for figures and none for a plain lookup', () => {
    expect(pickPlaybook('What is my open pipeline value and weighted forecast?', null)?.name).toBe('pipeline-and-reports');
    expect(pickPlaybook('How many open deals do I have?', null)).toBeNull();
  });
});
