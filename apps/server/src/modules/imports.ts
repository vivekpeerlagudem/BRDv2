/**
 * imports module — CSV import of companies, contacts and deals (BR-MIG-001/003/004/005, RULE-MIG-01..10).
 *
 * Flow: upload (file text is parsed and stored in import_batch / import_row) → save column mapping → preview
 * (every row validated and checked for duplicates; NOTHING is written to CRM tables) → commit (all inserts in ONE
 * transaction; any failure rolls everything back and marks the batch failed) → undo (removes exactly the records the
 * batch created, except those edited or referenced since).
 *
 * Scope of this version: CSV only, one entity type per batch, duplicates can be skipped or created (no merge),
 * runs inside the request (no background job), so the limits below are deliberately small.
 */
import { companyInput, contactInput, dealInput } from '@crm/shared';
import { and, asc, count, desc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type ImportBatchStatus,
  type ImportCellError,
  type ImportCounts,
  type ImportDuplicate,
  type ImportEntity,
  type ImportRowStatus,
  type ImportUndoItem,
  type ImportUndoOutcome,
  type ImportUndoReport,
  importBatch,
  importRecordLink,
  importRow,
} from '../db/schema-imports.ts';
import {
  type AppContext,
  canAccessOwner,
  conflict,
  type DbOrTx,
  normalizeDomain,
  normalizeEmail,
  notFound,
  requirePerm,
  rule,
  schema,
  sha256Hex,
  type Tx,
  type UserActor,
  unitOfWork,
} from '../platform/core.ts';
import { DomainError } from '../platform/errors/domain-error.ts';
import { insertDeal } from './crm.ts';
import { CsvError, parseCsv, toCsv } from './imports/csv.ts';

const { company, contact, deal, pipelineStage, appUserProfile, organizationSettings } = schema;

// ───────────── limits ─────────────
export const IMPORT_LIMITS = { maxFileBytes: 2 * 1024 * 1024, maxRows: 2000, maxColumns: 100 } as const;

// ───────────── importable fields ─────────────
export interface ImportField {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
  aliases: string[];
}
const OWNER: ImportField = {
  key: 'ownerEmail',
  label: 'Owner (user email)',
  required: false,
  hint: 'Email of an active user. Blank or unknown: you become the owner.',
  aliases: ['owner', 'owneremail', 'recordowner', 'assignedto', 'salesrep', 'accountowner', 'dealowner', 'contactowner', 'companyowner'],
};
const COMPANY_REF_HINT = 'Name or domain of a company that already exists in the CRM.';
export const IMPORT_FIELDS: Record<ImportEntity, ImportField[]> = {
  companies: [
    {
      key: 'name',
      label: 'Company name',
      required: true,
      aliases: ['name', 'company', 'companyname', 'account', 'accountname', 'organization', 'organisation'],
    },
    { key: 'domain', label: 'Domain', required: false, aliases: ['domain', 'companydomain', 'companydomainname', 'emaildomain'] },
    { key: 'industry', label: 'Industry', required: false, aliases: ['industry', 'sector'] },
    { key: 'phone', label: 'Phone', required: false, aliases: ['phone', 'phonenumber', 'telephone', 'tel'] },
    { key: 'website', label: 'Website', required: false, aliases: ['website', 'websiteurl', 'url', 'web', 'homepage'] },
    OWNER,
  ],
  contacts: [
    { key: 'firstName', label: 'First name', required: false, aliases: ['firstname', 'first', 'givenname', 'forename'] },
    { key: 'lastName', label: 'Last name', required: false, aliases: ['lastname', 'last', 'surname', 'familyname'] },
    { key: 'email', label: 'Email', required: false, aliases: ['email', 'emailaddress', 'mail', 'workemail'] },
    { key: 'phone', label: 'Phone', required: false, aliases: ['phone', 'phonenumber', 'telephone', 'tel', 'mobile', 'mobilephone'] },
    { key: 'jobTitle', label: 'Job title', required: false, aliases: ['jobtitle', 'title', 'position', 'role'] },
    {
      key: 'company',
      label: 'Company (name or domain)',
      required: false,
      hint: COMPANY_REF_HINT,
      aliases: ['company', 'companyname', 'account', 'accountname', 'organization', 'organisation', 'companydomain'],
    },
    OWNER,
  ],
  deals: [
    { key: 'name', label: 'Deal name', required: true, aliases: ['name', 'deal', 'dealname', 'opportunity', 'opportunityname', 'title'] },
    {
      key: 'company',
      label: 'Company (name or domain)',
      required: true,
      hint: COMPANY_REF_HINT,
      aliases: ['company', 'companyname', 'account', 'accountname', 'organization', 'organisation', 'companydomain'],
    },
    {
      key: 'stage',
      label: 'Stage',
      required: false,
      hint: 'Name of an open pipeline stage. Blank: the first open stage.',
      aliases: ['stage', 'dealstage', 'pipelinestage'],
    },
    { key: 'amount', label: 'Amount', required: false, hint: 'Digits only, for example 1234.50', aliases: ['amount', 'value', 'dealvalue', 'dealamount'] },
    {
      key: 'closeDate',
      label: 'Expected close date',
      required: false,
      hint: 'YYYY-MM-DD',
      aliases: ['closedate', 'expectedclosedate', 'expectedclose', 'closingdate'],
    },
    OWNER,
  ],
};
const ENTITY_LABEL: Record<ImportEntity, { one: 'company' | 'contact' | 'deal'; many: string }> = {
  companies: { one: 'company', many: 'companies' },
  contacts: { one: 'contact', many: 'contacts' },
  deals: { one: 'deal', many: 'deals' },
};

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
const normName = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');

/** Suggests a field for each column by normalised header name; each field is suggested at most once. */
export function suggestMapping(entity: ImportEntity, headers: string[]): (string | null)[] {
  const used = new Set<string>();
  return headers.map((h) => {
    const n = normHeader(h);
    if (!n) return null;
    const f = IMPORT_FIELDS[entity].find((x) => !used.has(x.key) && (normHeader(x.key) === n || x.aliases.includes(n)));
    if (!f) return null;
    used.add(f.key);
    return f.key;
  });
}

// ───────────── request contracts ─────────────
const entityType = z.enum(['companies', 'contacts', 'deals']);
export const uploadInput = z.object({
  entityType,
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((n) => /\.csv$/i.test(n), 'Only .csv files can be imported'),
  text: z.string().min(1, 'The file is empty').max(IMPORT_LIMITS.maxFileBytes, 'The file is larger than 2 MB'),
});
export const mappingInput = z.object({ mapping: z.array(z.string().max(40).nullable()).max(IMPORT_LIMITS.maxColumns) });
export const commitInput = z.object({ duplicateStrategy: z.enum(['skip', 'create']) });
export const rowsQuery = z.object({
  status: z.enum(['valid', 'invalid', 'duplicate', 'pending']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ───────────── helpers ─────────────
type Batch = typeof importBatch.$inferSelect;
type Row = typeof importRow.$inferSelect;
type Link = typeof importRecordLink.$inferSelect;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
/** Fingerprint of a record exactly as stored; undo compares it with the current row to detect later edits. */
function fingerprint(row: Record<string, unknown>): string {
  return sha256Hex(
    JSON.stringify(
      Object.keys(row)
        .sort()
        .map((k) => [k, row[k] instanceof Date ? (row[k] as Date).toISOString() : (row[k] ?? null)]),
    ),
  );
}
const admin = (actor: UserActor) => requirePerm(actor, 'settings.manage'); // RULE-MIG-01

async function loadBatch(db: DbOrTx, id: string): Promise<Batch> {
  const [b] = await db.select().from(importBatch).where(eq(importBatch.id, id));
  if (!b) throw notFound('Import');
  return b;
}
async function lockBatch(tx: Tx, id: string): Promise<Batch> {
  const [b] = await tx.select().from(importBatch).where(eq(importBatch.id, id)).for('update');
  if (!b) throw notFound('Import');
  return b;
}
const loadRows = (db: DbOrTx, batchId: string): Promise<Row[]> =>
  db.select().from(importRow).where(eq(importRow.batchId, batchId)).orderBy(asc(importRow.rowNumber));

function present(batch: Batch, extra: { createdByName?: string | null; sampleRows?: string[][] } = {}) {
  return {
    id: batch.id,
    source: batch.source,
    entityType: batch.entityType,
    fileName: batch.fileName,
    headers: batch.headers,
    rowCount: batch.rowCount,
    mapping: batch.mapping,
    suggestedMapping: suggestMapping(batch.entityType, batch.headers),
    fields: IMPORT_FIELDS[batch.entityType].map(({ key, label, required, hint }) => ({ key, label, required, hint: hint ?? null })),
    status: batch.status,
    counts: batch.counts,
    duplicateStrategy: batch.duplicateStrategy,
    failureReason: batch.failureReason,
    createdAt: batch.createdAt,
    validatedAt: batch.validatedAt,
    committedAt: batch.committedAt,
    undoneAt: batch.undoneAt,
    undoReport: batch.undoReport,
    limits: IMPORT_LIMITS,
    ...extra,
  };
}

// ───────────── upload ─────────────
export async function uploadCsv(ctx: AppContext, actor: UserActor, input: z.infer<typeof uploadInput>) {
  admin(actor);
  if (Buffer.byteLength(input.text, 'utf8') > IMPORT_LIMITS.maxFileBytes) throw rule('IMPORT_FILE_TOO_LARGE', 'The file is larger than 2 MB');
  if (input.text.includes('\u0000')) throw rule('IMPORT_FILE_TYPE', 'This is not a text CSV file. Excel files must be saved as CSV first.');
  let records: string[][];
  try {
    records = parseCsv(input.text, { maxRecords: IMPORT_LIMITS.maxRows + 1 });
  } catch (error) {
    if (error instanceof CsvError)
      throw error.tooManyRows
        ? rule('IMPORT_TOO_MANY_ROWS', `The file has more than ${IMPORT_LIMITS.maxRows} data rows. Split it into smaller files.`)
        : rule('IMPORT_FILE_INVALID', `The file is not valid CSV. ${error.message}`);
    throw error;
  }
  const headers = (records[0] ?? []).map((h) => h.trim());
  if (headers.every((h) => h === '')) throw rule('IMPORT_FILE_EMPTY', 'The file has no header row');
  if (headers.length > IMPORT_LIMITS.maxColumns) throw rule('IMPORT_TOO_MANY_COLUMNS', `The file has more than ${IMPORT_LIMITS.maxColumns} columns`);
  const data = records.slice(1);
  if (data.length === 0) throw rule('IMPORT_NO_ROWS', 'The file has a header row but no data rows');

  return unitOfWork(ctx, actor, async (u) => {
    const [batch] = await u.tx
      .insert(importBatch)
      .values({
        entityType: input.entityType,
        fileName: input.fileName,
        headers,
        rowCount: data.length,
        counts: { total: data.length },
        createdBy: actor.userId,
      })
      .returning();
    // Row numbers match what a spreadsheet shows: the header is row 1, the first data row is row 2.
    for (const part of chunks(
      data.map((cells, i) => ({ batchId: batch!.id, rowNumber: i + 2, rawData: cells })),
      500,
    ))
      await u.tx.insert(importRow).values(part);
    await u.audit('import.uploaded', { type: 'import_batch', id: batch!.id }, { entityType: input.entityType, fileName: input.fileName, rows: data.length });
    return present(batch!, { createdByName: actor.name, sampleRows: data.slice(0, 5) });
  });
}

// ───────────── list / detail / rows ─────────────
export async function listBatches(ctx: AppContext, actor: UserActor) {
  admin(actor);
  const rows = await ctx.db
    .select({ batch: importBatch, createdByName: appUserProfile.fullName })
    .from(importBatch)
    .leftJoin(appUserProfile, eq(appUserProfile.userId, importBatch.createdBy))
    .orderBy(desc(importBatch.createdAt), desc(importBatch.id))
    .limit(100);
  return {
    items: rows.map(({ batch, createdByName }) => ({
      id: batch.id,
      entityType: batch.entityType,
      fileName: batch.fileName,
      rowCount: batch.rowCount,
      status: batch.status,
      counts: batch.counts,
      failureReason: batch.failureReason,
      createdAt: batch.createdAt,
      committedAt: batch.committedAt,
      undoneAt: batch.undoneAt,
      createdByName,
    })),
  };
}

export async function getBatch(ctx: AppContext, actor: UserActor, id: string) {
  admin(actor);
  const batch = await loadBatch(ctx.db, id);
  const [creator] = await ctx.db.select({ fullName: appUserProfile.fullName }).from(appUserProfile).where(eq(appUserProfile.userId, batch.createdBy));
  const sample = await ctx.db
    .select({ rawData: importRow.rawData })
    .from(importRow)
    .where(eq(importRow.batchId, id))
    .orderBy(asc(importRow.rowNumber))
    .limit(5);
  return present(batch, { createdByName: creator?.fullName ?? null, sampleRows: sample.map((s) => s.rawData) });
}

export async function listRows(ctx: AppContext, actor: UserActor, id: string, q: z.infer<typeof rowsQuery>) {
  admin(actor);
  await loadBatch(ctx.db, id);
  const where = and(eq(importRow.batchId, id), q.status ? eq(importRow.status, q.status) : undefined);
  const [total] = await ctx.db.select({ n: count() }).from(importRow).where(where);
  const items = await ctx.db.select().from(importRow).where(where).orderBy(asc(importRow.rowNumber)).limit(q.limit).offset(q.offset);
  return {
    total: total?.n ?? 0,
    items: items.map((r) => ({
      id: r.id,
      rowNumber: r.rowNumber,
      status: r.status,
      outcome: r.outcome,
      rawData: r.rawData,
      mappedData: r.mappedData,
      errors: r.validationErrors,
      warnings: r.warnings,
      duplicate: r.duplicate,
    })),
  };
}

/** Removes an import that was never committed (its stored file rows only; there are no CRM records to remove). */
export async function discardBatch(ctx: AppContext, actor: UserActor, id: string) {
  admin(actor);
  return unitOfWork(ctx, actor, async (u) => {
    const batch = await lockBatch(u.tx, id);
    if (!['uploaded', 'validated', 'failed'].includes(batch.status))
      throw conflict('IMPORT_ALREADY_COMMITTED', 'This import has created records. Use Undo instead.');
    await u.tx.delete(importBatch).where(eq(importBatch.id, id));
    await u.audit('import.discarded', { type: 'import_batch', id }, { fileName: batch.fileName, entityType: batch.entityType });
    return { ok: true };
  });
}

// ───────────── mapping ─────────────
function checkMapping(batch: Batch, mapping: (string | null)[]): void {
  const fields = IMPORT_FIELDS[batch.entityType];
  if (mapping.length !== batch.headers.length) throw rule('IMPORT_MAPPING_INVALID', 'The mapping does not match the columns of this file');
  const seen = new Set<string>();
  for (const key of mapping) {
    if (key === null) continue;
    const f = fields.find((x) => x.key === key);
    if (!f) throw rule('IMPORT_MAPPING_INVALID', `"${key}" is not a field that can be imported for ${ENTITY_LABEL[batch.entityType].many}`);
    if (seen.has(key)) throw rule('IMPORT_MAPPING_INVALID', `"${f.label}" is mapped to more than one column. Map each field once.`);
    seen.add(key);
  }
  if (seen.size === 0) throw rule('IMPORT_REQUIRED_FIELD_UNMAPPED', 'Map at least one column');
  const missing = fields.filter((f) => f.required && !seen.has(f.key));
  if (missing.length)
    throw rule('IMPORT_REQUIRED_FIELD_UNMAPPED', `Map a column to: ${missing.map((f) => f.label).join(', ')}`, { fields: missing.map((f) => f.key) });
  if (batch.entityType === 'contacts' && !['firstName', 'lastName', 'email'].some((k) => seen.has(k)))
    throw rule('IMPORT_REQUIRED_FIELD_UNMAPPED', 'Map a column to at least one of: First name, Last name, Email', {
      fields: ['firstName', 'lastName', 'email'],
    });
}

export async function saveMapping(ctx: AppContext, actor: UserActor, id: string, input: z.infer<typeof mappingInput>) {
  admin(actor);
  return unitOfWork(ctx, actor, async (u) => {
    const batch = await lockBatch(u.tx, id);
    if (!['uploaded', 'validated', 'failed'].includes(batch.status))
      throw conflict('IMPORT_ALREADY_COMMITTED', 'This import is already committed; its mapping cannot change');
    checkMapping(batch, input.mapping);
    // A new mapping invalidates any earlier validation result.
    await u.tx
      .update(importRow)
      .set({ mappedData: null, validationErrors: [], warnings: [], duplicate: null, status: 'pending' })
      .where(eq(importRow.batchId, id));
    const [saved] = await u.tx
      .update(importBatch)
      .set({ mapping: input.mapping, status: 'uploaded', counts: { total: batch.rowCount }, validatedAt: null, failureReason: null, updatedAt: ctx.now() })
      .where(eq(importBatch.id, id))
      .returning();
    await u.audit('import.mapping_saved', { type: 'import_batch', id }, { mapping: input.mapping });
    return present(saved!);
  });
}

// ───────────── validation and duplicate detection (read-only) ─────────────
type CompanyPlan = { kind: 'companies'; input: z.infer<typeof companyInput>; normalizedName: string; normalizedDomain: string | null; ownerId: string };
type ContactPlan = {
  kind: 'contacts';
  input: Omit<z.infer<typeof contactInput>, 'companyId'>;
  normalizedEmail: string | null;
  companyId: string | null;
  ownerId: string;
};
type DealPlan = { kind: 'deals'; input: { name: string; amount?: string; closeDate?: string }; companyId: string; stageId: string; ownerId: string };
type Plan = CompanyPlan | ContactPlan | DealPlan;
interface RowEval {
  rowId: string;
  rowNumber: number;
  mapped: Record<string, string>;
  errors: ImportCellError[];
  warnings: ImportCellError[];
  duplicate: ImportDuplicate | null;
  status: Exclude<ImportRowStatus, 'pending'>;
  plan: Plan | null;
}

const dealFields = dealInput.pick({ name: true, amount: true, closeDate: true });
const contactFields = contactInput; // companyId is resolved separately and left out of the parsed object

/**
 * Validates every row with the same Zod contracts the API uses for manual creation, resolves references
 * (owner by email, company by domain or name, stage by name) and classifies duplicates against existing records and
 * within the file. Reads only; the same function runs for the preview and again inside the commit transaction.
 */
async function evaluate(db: DbOrTx, actor: UserActor, batch: Batch, rows: Row[]): Promise<RowEval[]> {
  const mapping = batch.mapping;
  if (!mapping) throw conflict('IMPORT_NOT_MAPPED', 'Map the columns first');
  const entity = batch.entityType;
  const fields = IMPORT_FIELDS[entity];
  const label = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
  const columnOf = (key: string): string | null => {
    const i = mapping.indexOf(key);
    return i < 0 ? null : batch.headers[i] || `Column ${i + 1}`;
  };

  // Reference data, loaded once.
  const users = await db
    .select({ id: appUserProfile.userId, email: appUserProfile.normalizedEmail })
    .from(appUserProfile)
    .where(eq(appUserProfile.status, 'active'));
  const userByEmail = new Map(users.map((x) => [x.email, x.id]));
  const [settings] = await db.select({ free: organizationSettings.freeMailDomains }).from(organizationSettings);
  const freeMail = new Set(settings?.free ?? []);
  const companies = await db
    .select({
      id: company.id,
      name: company.name,
      normalizedName: company.normalizedName,
      normalizedDomain: company.normalizedDomain,
      ownerId: company.ownerId,
    })
    .from(company)
    .where(isNull(company.archivedAt));
  type Co = (typeof companies)[number];
  const coByDomain = new Map<string, Co>();
  const coByName = new Map<string, Co[]>();
  for (const c of companies) {
    if (c.normalizedDomain) coByDomain.set(c.normalizedDomain, c);
    coByName.set(c.normalizedName, [...(coByName.get(c.normalizedName) ?? []), c]);
  }
  const stages = entity === 'deals' ? await db.select().from(pipelineStage).orderBy(asc(pipelineStage.sortOrder)) : [];
  const openStages = stages.filter((s) => s.kind === 'open');

  const mappedRows = rows.map((r) => {
    const mapped: Record<string, string> = {};
    mapping.forEach((key, i) => {
      if (key) mapped[key] = (r.rawData[i] ?? '').trim();
    });
    return mapped;
  });

  const contactByEmail = new Map<string, { id: string; label: string }>();
  if (entity === 'contacts') {
    const emails = [...new Set(mappedRows.map((m) => (m.email ? normalizeEmail(m.email) : '')).filter(Boolean))];
    for (const part of chunks(emails, 1000)) {
      const found = await db
        .select({ id: contact.id, email: contact.normalizedEmail, firstName: contact.firstName, lastName: contact.lastName })
        .from(contact)
        .where(and(isNull(contact.archivedAt), inArray(contact.normalizedEmail, part)));
      for (const c of found) if (c.email) contactByEmail.set(c.email, { id: c.id, label: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email });
    }
  }
  const dealByKey = new Map<string, { id: string; label: string }>();
  if (entity === 'deals') {
    const open = await db
      .select({ id: deal.id, name: deal.name, companyId: deal.companyId })
      .from(deal)
      .where(and(isNull(deal.archivedAt), eq(deal.status, 'open')));
    for (const d of open) dealByKey.set(`${d.companyId}|${normName(d.name)}`, { id: d.id, label: d.name });
  }

  // Keys seen earlier in this file (first valid occurrence wins, RULE-MIG-07).
  const fileDomain = new Map<string, number>();
  const fileCompanyName = new Map<string, { rowNumber: number; hasDomain: boolean }[]>();
  const fileEmail = new Map<string, number>();
  const fileDeal = new Map<string, number>();

  return rows.map((row, index): RowEval => {
    const mapped = mappedRows[index] as Record<string, string>;
    const errors: ImportCellError[] = [];
    const warnings: ImportCellError[] = [];
    const err = (field: string | null, message: string) => errors.push({ field, column: field ? columnOf(field) : null, message });
    const val = (key: string): string | undefined => (mapped[key] ? mapped[key] : undefined);
    const zodErrors = (issues: z.core.$ZodIssue[]) => {
      for (const issue of issues) {
        const key = typeof issue.path[0] === 'string' ? issue.path[0] : null;
        if (!key) err(null, issue.message);
        else if (issue.code === 'invalid_type' && val(key) === undefined) err(key, `${label(key)} is required`);
        else if (issue.code === 'custom') err(key, issue.message);
        else err(key, `${label(key)}: ${issue.message}`);
      }
    };

    if (row.rawData.every((c) => c.trim() === '')) err(null, 'The row is empty');
    if (row.rawData.slice(batch.headers.length).some((c) => c.trim() !== '')) err(null, 'The row has more values than the header has columns');

    // Owner: the mapped email when it belongs to an active user, otherwise the importing Admin (DR-MIG-03).
    let ownerId = actor.userId;
    const ownerRaw = val('ownerEmail');
    if (ownerRaw) {
      const found = userByEmail.get(normalizeEmail(ownerRaw));
      if (found) ownerId = found;
      else warnings.push({ field: 'ownerEmail', column: columnOf('ownerEmail'), message: `No active user has the email "${ownerRaw}"; you will be the owner` });
    }

    const resolveCompany = (raw: string): Co | null => {
      const d = normalizeDomain(raw);
      const byDomain = d ? coByDomain.get(d) : undefined;
      const named = byDomain ? [byDomain] : (coByName.get(normName(raw)) ?? []);
      const visible = named.filter((c) => canAccessOwner(actor, c.ownerId, 'read', 'companies'));
      if (visible.length === 1) return visible[0] as Co;
      if (visible.length > 1) err('company', `${visible.length} companies are named "${raw}". Use the company domain instead.`);
      else err('company', `No company with the name or domain "${raw}" exists. Import or create the company first.`);
      return null;
    };

    let plan: Plan | null = null;
    let duplicate: ImportDuplicate | null = null;

    if (entity === 'companies') {
      const parsed = companyInput.safeParse({
        name: val('name'),
        domain: val('domain'),
        industry: val('industry'),
        phone: val('phone'),
        website: val('website'),
      });
      if (!parsed.success) zodErrors(parsed.error.issues);
      else if (errors.length === 0) {
        const input = parsed.data;
        let nd = normalizeDomain(input.domain ?? input.website);
        if (input.domain && !normalizeDomain(input.domain))
          warnings.push({
            field: 'domain',
            column: columnOf('domain'),
            message: `"${input.domain}" is not a domain; it is kept as text but not used for matching`,
          });
        if (nd && freeMail.has(nd)) nd = null; // R3: never match on free-mail domains (same as manual creation)
        const nn = normName(input.name);
        plan = { kind: 'companies', input, normalizedName: nn, normalizedDomain: nd, ownerId };
        const existing = nd ? coByDomain.get(nd) : undefined;
        const firstDomainRow = nd ? fileDomain.get(nd) : undefined;
        if (existing) duplicate = { kind: 'existing', matchedOn: `domain ${nd}`, existingId: existing.id, existingLabel: existing.name, canCreate: false };
        else if (firstDomainRow !== undefined) duplicate = { kind: 'in_file', matchedOn: `domain ${nd}`, firstRowNumber: firstDomainRow, canCreate: false };
        else {
          // Name match applies unless both records carry (different) domains, which marks them as different companies.
          const byName = (coByName.get(nn) ?? []).find((c) => !(nd && c.normalizedDomain));
          const inFile = (fileCompanyName.get(nn) ?? []).find((c) => !(nd && c.hasDomain));
          if (byName) duplicate = { kind: 'existing', matchedOn: `name "${input.name}"`, existingId: byName.id, existingLabel: byName.name, canCreate: true };
          else if (inFile) duplicate = { kind: 'in_file', matchedOn: `name "${input.name}"`, firstRowNumber: inFile.rowNumber, canCreate: true };
        }
        if (nd && !fileDomain.has(nd)) fileDomain.set(nd, row.rowNumber);
        fileCompanyName.set(nn, [...(fileCompanyName.get(nn) ?? []), { rowNumber: row.rowNumber, hasDomain: Boolean(nd) }]);
      }
    } else if (entity === 'contacts') {
      const parsed = contactFields.safeParse({
        firstName: val('firstName'),
        lastName: val('lastName'),
        email: val('email'),
        phone: val('phone'),
        jobTitle: val('jobTitle'),
      });
      if (!parsed.success) zodErrors(parsed.error.issues);
      const companyRaw = val('company');
      const co = companyRaw ? resolveCompany(companyRaw) : null;
      if (parsed.success && errors.length === 0) {
        const { companyId: _unused, ...input } = parsed.data;
        const ne = input.email ? normalizeEmail(input.email) : null;
        plan = { kind: 'contacts', input, normalizedEmail: ne, companyId: co?.id ?? null, ownerId };
        if (ne) {
          const existing = contactByEmail.get(ne);
          const first = fileEmail.get(ne);
          // RULE-MIG-08: a second contact with the same email can never be created.
          if (existing) duplicate = { kind: 'existing', matchedOn: `email ${ne}`, existingId: existing.id, existingLabel: existing.label, canCreate: false };
          else if (first !== undefined) duplicate = { kind: 'in_file', matchedOn: `email ${ne}`, firstRowNumber: first, canCreate: false };
          else fileEmail.set(ne, row.rowNumber);
        }
      }
    } else {
      const parsed = dealFields.safeParse({ name: val('name'), amount: val('amount'), closeDate: val('closeDate') });
      if (!parsed.success) zodErrors(parsed.error.issues);
      const companyRaw = val('company');
      let co: Co | null = null;
      if (!companyRaw) err('company', 'Company is required');
      else co = resolveCompany(companyRaw);
      const stageRaw = val('stage');
      let stage = openStages[0];
      if (stageRaw) {
        stage = stages.find((s) => normName(s.name) === normName(stageRaw));
        if (!stage) err('stage', `There is no stage named "${stageRaw}". Open stages: ${openStages.map((s) => s.name).join(', ')}`);
        else if (stage.kind !== 'open') err('stage', `"${stage.name}" is a closed stage. Only open deals can be imported.`);
      } else if (!stage) err('stage', 'The pipeline has no open stage');
      if (parsed.success && co && stage && errors.length === 0) {
        plan = { kind: 'deals', input: parsed.data, companyId: co.id, stageId: stage.id, ownerId };
        const key = `${co.id}|${normName(parsed.data.name)}`;
        const existing = dealByKey.get(key);
        const first = fileDeal.get(key);
        const matchedOn = `open deal "${parsed.data.name}" for ${co.name}`;
        if (existing) duplicate = { kind: 'existing', matchedOn, existingId: existing.id, existingLabel: existing.label, canCreate: true };
        else if (first !== undefined) duplicate = { kind: 'in_file', matchedOn, firstRowNumber: first, canCreate: true };
        else fileDeal.set(key, row.rowNumber);
      }
    }

    const status = errors.length ? 'invalid' : duplicate ? 'duplicate' : 'valid';
    return {
      rowId: row.id,
      rowNumber: row.rowNumber,
      mapped,
      errors,
      warnings,
      duplicate: errors.length ? null : duplicate,
      status,
      plan: errors.length ? null : plan,
    };
  });
}

function countsOf(evals: RowEval[]): ImportCounts {
  return {
    total: evals.length,
    valid: evals.filter((e) => e.status === 'valid').length,
    invalid: evals.filter((e) => e.status === 'invalid').length,
    duplicate: evals.filter((e) => e.status === 'duplicate').length,
    duplicateCreatable: evals.filter((e) => e.status === 'duplicate' && e.duplicate?.canCreate).length,
    warnings: evals.filter((e) => e.warnings.length > 0).length,
  };
}

/** Validation run (BR-MIG-004). Stores the result on the import rows only — no CRM table is touched. */
export async function previewBatch(ctx: AppContext, actor: UserActor, id: string) {
  admin(actor);
  return unitOfWork(ctx, actor, async (u) => {
    const batch = await lockBatch(u.tx, id);
    if (!['uploaded', 'validated', 'failed'].includes(batch.status)) throw conflict('IMPORT_ALREADY_COMMITTED', 'This import is already committed');
    if (!batch.mapping) throw conflict('IMPORT_NOT_MAPPED', 'Map the columns first');
    checkMapping(batch, batch.mapping);
    const evals = await evaluate(u.tx, actor, batch, await loadRows(u.tx, id));
    for (const part of chunks(evals, 500)) {
      const payload = JSON.stringify(
        part.map((e) => ({ id: e.rowId, mapped_data: e.mapped, validation_errors: e.errors, warnings: e.warnings, duplicate: e.duplicate, status: e.status })),
      );
      await u.tx.execute(sql`
        update import_row r
           set mapped_data = x.mapped_data, validation_errors = x.validation_errors, warnings = x.warnings,
               duplicate = x.duplicate, status = x.status, outcome = 'pending'
          from jsonb_to_recordset(${payload}::jsonb)
               as x(id uuid, mapped_data jsonb, validation_errors jsonb, warnings jsonb, duplicate jsonb, status text)
         where r.id = x.id and r.batch_id = ${id}`);
    }
    const counts = countsOf(evals);
    const [saved] = await u.tx
      .update(importBatch)
      .set({ status: 'validated', counts, validatedAt: ctx.now(), failureReason: null, updatedAt: ctx.now() })
      .where(eq(importBatch.id, id))
      .returning();
    await u.audit('import.validated', { type: 'import_batch', id }, counts);
    return present(saved!);
  });
}

/** Error report (RULE-MIG-05): the original row plus result columns, for every row that is not cleanly valid. */
export async function errorReport(ctx: AppContext, actor: UserActor, id: string) {
  admin(actor);
  const batch = await loadBatch(ctx.db, id);
  if (batch.status === 'uploaded') throw conflict('IMPORT_NOT_VALIDATED', 'Run the validation first');
  const rows = (await loadRows(ctx.db, id)).filter((r) => r.status !== 'valid' || r.warnings.length > 0);
  const describe = (e: ImportCellError) => (e.column ? `${e.column}: ${e.message}` : e.message);
  const out: string[][] = [['Row', 'Result', 'Problems', ...batch.headers]];
  for (const r of rows) {
    const problems = [
      ...r.validationErrors.map(describe),
      ...(r.duplicate
        ? [
            r.duplicate.kind === 'existing'
              ? `Duplicate of existing record "${r.duplicate.existingLabel}" (${r.duplicate.matchedOn})`
              : `Duplicate of row ${r.duplicate.firstRowNumber} in this file (${r.duplicate.matchedOn})`,
          ]
        : []),
      ...r.warnings.map((w) => `Warning - ${describe(w)}`),
    ];
    const result = r.status === 'invalid' ? 'Invalid' : r.status === 'duplicate' ? 'Duplicate' : 'Valid with warnings';
    out.push([String(r.rowNumber), result, problems.join(' | '), ...batch.headers.map((_, i) => r.rawData[i] ?? '')]);
  }
  return {
    bytes: new TextEncoder().encode(`﻿${toCsv(out, { guardFormulas: true })}`),
    contentType: 'text/csv; charset=utf-8',
    fileName: `${batch.fileName.replace(/\.csv$/i, '').replace(/[^\w.-]+/g, '_')}-import-errors.csv`,
  };
}

// ───────────── commit (one transaction) ─────────────
const pgError = (error: unknown): { code?: string; constraint?: string; table?: string } => {
  const e = error as { code?: string; cause?: unknown } | null;
  if (e && typeof e === 'object' && typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e as { code: string };
  return e?.cause ? pgError(e.cause) : {};
};
function failureText(error: unknown): string {
  if (error instanceof DomainError) return error.message;
  const pg = pgError(error);
  if (pg.constraint === 'company_domain_uq') return 'A company with the same domain was created while the import was running';
  if (pg.constraint === 'contact_email_uq') return 'A contact with the same email was created while the import was running';
  if (pg.code) return `The database refused a record (code ${pg.code}${pg.constraint ? `, ${pg.constraint}` : ''})`;
  return error instanceof Error ? error.message : 'Unexpected error';
}

export interface CommitHooks {
  /** Test seam: called before each record is inserted (used to prove that a failure mid-commit rolls everything back). */
  beforeRecord?: (rowNumber: number) => void | Promise<void>;
}

/**
 * Commit (RULE-MIG-06/09). Everything happens in ONE transaction: the rows are re-evaluated against the current
 * data, then each accepted row becomes a record with the same normalised columns, defaults, audit entry and timeline
 * entry a manually created record gets, plus an import_record_link row that names the batch. If anything throws,
 * the transaction rolls back (zero records) and the batch is marked failed with the reason.
 */
export async function commitBatch(ctx: AppContext, actor: UserActor, id: string, input: z.infer<typeof commitInput>, hooks: CommitHooks = {}) {
  admin(actor);
  requirePerm(actor, 'record.create');
  let inserting = false;
  let currentRow: number | null = null;
  try {
    return await unitOfWork(ctx, actor, async (u) => {
      const batch = await lockBatch(u.tx, id);
      if (batch.status === 'committed' || batch.status === 'undone' || batch.status === 'partially_undone')
        throw conflict('IMPORT_ALREADY_COMMITTED', 'This import is already committed');
      if (batch.status !== 'validated') throw conflict('IMPORT_NOT_VALIDATED', 'Run the validation before importing');
      const rows = await loadRows(u.tx, id);
      const evals = await evaluate(u.tx, actor, batch, rows);
      // RULE-MIG-06/08: what the Admin reviewed must still be true. Otherwise refuse and ask for a new validation.
      const changed = evals.filter((e, i) => e.status !== rows[i]?.status || (e.duplicate?.canCreate ?? null) !== (rows[i]?.duplicate?.canCreate ?? null));
      if (changed.length)
        throw conflict('IMPORT_TARGET_CHANGED', 'Some records changed since the review. Run the validation again.', {
          rows: changed.slice(0, 50).map((e) => e.rowNumber),
        });
      const accepted = evals.filter(
        (e) => e.status === 'valid' || (e.status === 'duplicate' && input.duplicateStrategy === 'create' && e.duplicate?.canCreate),
      );
      if (accepted.length === 0) throw rule('IMPORT_NOTHING_TO_IMPORT', 'No row can be imported with these choices');

      inserting = true;
      const links: (typeof importRecordLink.$inferInsert)[] = [];
      const source = `import ${batch.fileName}`;
      for (const e of accepted) {
        currentRow = e.rowNumber;
        await hooks.beforeRecord?.(e.rowNumber);
        const plan = e.plan as Plan;
        const auditInfo = { source: 'import', importBatchId: id, row: e.rowNumber };
        if (plan.kind === 'companies') {
          const [row] = await u.tx
            .insert(company)
            .values({
              ...plan.input,
              normalizedName: plan.normalizedName,
              normalizedDomain: plan.normalizedDomain,
              ownerId: plan.ownerId,
              createdBy: actor.userId,
            })
            .returning();
          await u.audit('company.created', { type: 'company', id: row!.id }, auditInfo);
          await u.timeline({
            eventType: 'company_created',
            source: { type: 'company', id: row!.id },
            summary: `Company ${row!.name} imported (${source})`,
            anchors: [{ type: 'company', id: row!.id }],
          });
          links.push({ batchId: id, rowId: e.rowId, recordType: 'company', recordId: row!.id, recordLabel: row!.name, snapshotSha256: fingerprint(row!) });
        } else if (plan.kind === 'contacts') {
          const [row] = await u.tx
            .insert(contact)
            .values({
              ...plan.input,
              normalizedEmail: plan.normalizedEmail,
              companyId: plan.companyId,
              ownerId: plan.ownerId,
              createdBy: actor.userId,
              source: 'import',
            })
            .returning();
          const name = [row!.firstName, row!.lastName].filter(Boolean).join(' ') || row!.email || 'Unnamed contact';
          await u.audit('contact.created', { type: 'contact', id: row!.id }, auditInfo);
          await u.timeline({
            eventType: 'contact_imported',
            source: { type: 'contact', id: row!.id },
            summary: `Contact ${name} imported (${source})`,
            anchors: [{ type: 'contact', id: row!.id }],
          });
          links.push({ batchId: id, rowId: e.rowId, recordType: 'contact', recordId: row!.id, recordLabel: name, snapshotSha256: fingerprint(row!) });
        } else {
          // The same writer the manual "create deal" endpoint uses: stage check, currency, stage history, audit, timeline.
          const row = await insertDeal(ctx, u, { ...plan.input, companyId: plan.companyId, stageId: plan.stageId, ownerId: plan.ownerId, source: 'import' });
          links.push({ batchId: id, rowId: e.rowId, recordType: 'deal', recordId: row.id, recordLabel: row.name, snapshotSha256: fingerprint(row) });
        }
      }
      currentRow = null;
      for (const part of chunks(links, 500)) await u.tx.insert(importRecordLink).values(part);
      await u.tx.execute(sql`
        update import_row r
           set outcome = case when exists (select 1 from import_record_link l where l.row_id = r.id) then 'created' else 'skipped' end
         where r.batch_id = ${id}`);
      const counts: ImportCounts = { ...countsOf(evals), created: links.length, skipped: evals.length - links.length };
      const [saved] = await u.tx
        .update(importBatch)
        .set({ status: 'committed', duplicateStrategy: input.duplicateStrategy, counts, committedAt: ctx.now(), failureReason: null, updatedAt: ctx.now() })
        .where(eq(importBatch.id, id))
        .returning();
      await u.audit(
        'import.committed',
        { type: 'import_batch', id },
        { entityType: batch.entityType, fileName: batch.fileName, duplicateStrategy: input.duplicateStrategy, created: links.length, skipped: counts.skipped },
      );
      return present(saved!);
    });
  } catch (error) {
    if (!inserting) throw error; // refused before any insert (wrong status, target changed, not found): nothing to record
    const reason = `${currentRow ? `Row ${currentRow}: ` : ''}${failureText(error)}`.slice(0, 500);
    ctx.logger.error({ err: error, importBatchId: id }, 'import commit failed and was rolled back');
    await unitOfWork(ctx, actor, async (u) => {
      await u.tx.update(importBatch).set({ status: 'failed', failureReason: reason, updatedAt: ctx.now() }).where(eq(importBatch.id, id));
      await u.audit('import.failed', { type: 'import_batch', id }, { reason });
    });
    throw new DomainError('IMPORT_FAILED', 422, 'The import failed and nothing was imported', { detail: reason, meta: { reason } });
  }
}

// ───────────── undo ─────────────
type RecordType = Link['recordType'];
/** Tables that can point at a record. Any hit means something was attached after the import (RULE-MIG-10). */
const REFERENCES: Record<RecordType, { what: string; table: string; column: string; related?: boolean }[]> = {
  company: [
    { what: 'contact', table: 'contact', column: 'company_id' },
    { what: 'deal', table: 'deal', column: 'company_id' },
    { what: 'lead', table: 'lead_form_submission', column: 'company_id' },
    { what: 'note', table: 'note', column: 'related_id', related: true },
    { what: 'task', table: 'task', column: 'related_id', related: true },
    { what: 'logged activity', table: 'activity_log', column: 'related_id', related: true },
  ],
  contact: [
    { what: 'deal link', table: 'deal_contact', column: 'contact_id' },
    { what: 'share link', table: 'share_link', column: 'contact_id' },
    { what: 'signer', table: 'signer', column: 'contact_id' },
    { what: 'proposal viewer', table: 'viewer_identity', column: 'contact_id' },
    { what: 'lead', table: 'lead_form_submission', column: 'contact_id' },
    { what: 'note', table: 'note', column: 'related_id', related: true },
    { what: 'task', table: 'task', column: 'related_id', related: true },
    { what: 'logged activity', table: 'activity_log', column: 'related_id', related: true },
  ],
  deal: [
    { what: 'contact link', table: 'deal_contact', column: 'deal_id' },
    { what: 'proposal', table: 'proposal', column: 'deal_id' },
    { what: 'share link', table: 'share_link', column: 'deal_id' },
    { what: 'signature request', table: 'signature_request', column: 'deal_id' },
    { what: 'proposal view', table: 'view_session', column: 'deal_id' },
    { what: 'deal flag', table: 'deal_flag', column: 'deal_id' },
    { what: 'AI draft', table: 'ai_generation', column: 'deal_id' },
    { what: 'notification', table: 'notification', column: 'deal_id' },
    { what: 'lead', table: 'lead_form_submission', column: 'deal_id' },
    { what: 'note', table: 'note', column: 'related_id', related: true },
    { what: 'task', table: 'task', column: 'related_id', related: true },
    { what: 'logged activity', table: 'activity_log', column: 'related_id', related: true },
  ],
};
const RECORD_TABLE = { company, contact, deal } as const;
const KIND = { company: 'companies', contact: 'contacts', deal: 'deals' } as const;

async function referencesTo(db: DbOrTx, type: RecordType, recordId: string): Promise<string[]> {
  const parts: SQL[] = REFERENCES[type].map(
    (r) =>
      sql`select ${r.what}::text as what, count(*)::int as n from ${sql.identifier(r.table)} where ${sql.identifier(r.column)} = ${recordId}${
        r.related ? sql` and related_type = ${type}` : sql``
      }`,
  );
  const res = await db.execute<{ what: string; n: number }>(sql.join(parts, sql` union all `));
  return res.rows.filter((r) => r.n > 0).map((r) => `${r.n} ${r.what}${r.n === 1 ? '' : 's'}`);
}

/** Decides, without changing anything, whether undo may remove this record. */
async function classify(db: DbOrTx, actor: UserActor, link: Link, lock: boolean): Promise<{ outcome: ImportUndoOutcome; detail: string | null }> {
  const table = RECORD_TABLE[link.recordType];
  const query = db.select().from(table).where(eq(table.id, link.recordId));
  const [row] = (await (lock ? query.for('update') : query)) as (Record<string, unknown> & { ownerId: string })[];
  if (!row) return { outcome: 'already_gone', detail: 'The record no longer exists' };
  if (!canAccessOwner(actor, row.ownerId, 'write', KIND[link.recordType]))
    return { outcome: 'kept_modified', detail: 'You are not allowed to change this record' };
  if (fingerprint(row) !== link.snapshotSha256.trim()) return { outcome: 'kept_modified', detail: 'Edited after the import' };
  const refs = await referencesTo(db, link.recordType, link.recordId);
  if (refs.length) return { outcome: 'kept_referenced', detail: `Used by ${refs.join(', ')} added after the import` };
  return { outcome: 'removed', detail: null };
}

const undoable = (status: ImportBatchStatus) => status === 'committed' || status === 'partially_undone';
const pendingLinks = (db: DbOrTx, batchId: string) =>
  db.select().from(importRecordLink).where(eq(importRecordLink.batchId, batchId)).orderBy(asc(importRecordLink.createdAt), asc(importRecordLink.id));
const settled = (l: Link) => l.undoOutcome === 'removed' || l.undoOutcome === 'already_gone';
const item = (l: Link, outcome: ImportUndoOutcome, detail: string | null): ImportUndoItem => ({
  recordType: l.recordType,
  recordId: l.recordId,
  label: l.recordLabel,
  outcome,
  detail,
});

/** What Undo would do right now — shown to the Admin before they confirm. Changes nothing. */
export async function undoPreview(ctx: AppContext, actor: UserActor, id: string) {
  admin(actor);
  const batch = await loadBatch(ctx.db, id);
  if (!undoable(batch.status))
    throw conflict(
      batch.status === 'undone' ? 'IMPORT_ALREADY_UNDONE' : 'IMPORT_NOT_COMMITTED',
      batch.status === 'undone' ? 'This import is already undone' : 'Only a committed import can be undone',
    );
  const items: ImportUndoItem[] = [];
  for (const link of await pendingLinks(ctx.db, id)) {
    if (settled(link)) continue;
    const c = await classify(ctx.db, actor, link, false);
    items.push(item(link, c.outcome, c.detail));
  }
  return {
    batchId: id,
    entityType: batch.entityType,
    willRemove: items.filter((i) => i.outcome === 'removed').length,
    willKeep: items.filter((i) => i.outcome === 'kept_modified' || i.outcome === 'kept_referenced').length,
    alreadyGone: items.filter((i) => i.outcome === 'already_gone').length,
    items,
  };
}

/**
 * Undo (BR-MIG-005, RULE-MIG-10): hard-deletes exactly the records this batch created, in one transaction. A record
 * that was edited since, or that something now points at, is kept and listed in the report instead.
 */
export async function undoBatch(ctx: AppContext, actor: UserActor, id: string) {
  admin(actor);
  return unitOfWork(ctx, actor, async (u) => {
    const batch = await lockBatch(u.tx, id);
    if (batch.status === 'undone') throw conflict('IMPORT_ALREADY_UNDONE', 'This import is already undone');
    if (!undoable(batch.status)) throw conflict('IMPORT_NOT_COMMITTED', 'Only a committed import can be undone');
    const links = await pendingLinks(u.tx, id);
    const items: ImportUndoItem[] = [];
    for (const link of links) {
      if (settled(link)) {
        items.push(item(link, link.undoOutcome as ImportUndoOutcome, link.undoDetail));
        continue;
      }
      let { outcome, detail } = await classify(u.tx, actor, link, true);
      if (outcome === 'removed') {
        const table = RECORD_TABLE[link.recordType];
        try {
          // Savepoint: a reference this module does not know about (foreign key) keeps the record instead of failing the undo.
          await u.tx.transaction(async (sp) => {
            if (link.recordType === 'deal') await sp.execute(sql`select import_undo_purge_deal_history(${id}::uuid, ${link.recordId}::uuid)`);
            await sp.delete(table).where(eq(table.id, link.recordId));
          });
          await u.audit(
            `${link.recordType}.deleted`,
            { type: link.recordType, id: link.recordId },
            { reason: 'import_undo', importBatchId: id, label: link.recordLabel },
          );
        } catch (error) {
          const pg = pgError(error);
          if (pg.code !== '23503') throw error;
          outcome = 'kept_referenced';
          detail = `Used by other records${pg.table ? ` (${pg.table})` : ''} added after the import`;
        }
      }
      await u.tx.update(importRecordLink).set({ undoOutcome: outcome, undoDetail: detail }).where(eq(importRecordLink.id, link.id));
      items.push(item(link, outcome, detail));
    }
    const removed = items.filter((i) => i.outcome === 'removed' || i.outcome === 'already_gone').length;
    const report: ImportUndoReport = { removed, kept: items.length - removed, items };
    const status: ImportBatchStatus = report.kept === 0 ? 'undone' : 'partially_undone';
    const [saved] = await u.tx
      .update(importBatch)
      .set({ status, undoneAt: ctx.now(), undoneBy: actor.userId, undoReport: report, updatedAt: ctx.now() })
      .where(eq(importBatch.id, id))
      .returning();
    await u.audit('import.undone', { type: 'import_batch', id }, { removed: report.removed, kept: report.kept, status });
    return present(saved!);
  });
}
