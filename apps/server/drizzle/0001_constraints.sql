-- Hand-written constraints that Drizzle cannot express (DATABASE-DESIGN §1.4, §6, §16; ADR-025, ADR-026).

ALTER TABLE organization_settings ADD CONSTRAINT org_singleton CHECK (id = 1);
ALTER TABLE deal ADD CONSTRAINT deal_lost_reason CHECK (status <> 'lost' OR lost_reason_id IS NOT NULL);
ALTER TABLE deal ADD CONSTRAINT deal_status_chk CHECK (status IN ('open','won','lost'));
ALTER TABLE deal ADD CONSTRAINT deal_amount_chk CHECK (amount IS NULL OR amount >= 0);
ALTER TABLE proposal ADD CONSTRAINT proposal_status_chk CHECK (status IN ('draft','sent','viewed','accepted','signed','declined','expired','void'));
ALTER TABLE proposal ADD CONSTRAINT proposal_void_reason CHECK (status <> 'void' OR void_reason IS NOT NULL);
ALTER TABLE proposal_version ADD CONSTRAINT pv_state_chk CHECK (state IN ('draft','sent','superseded','signed'));
ALTER TABLE proposal_version ADD CONSTRAINT pv_sent_fields CHECK (state = 'draft' OR (sent_at IS NOT NULL AND frozen_snapshot IS NOT NULL AND snapshot_sha256 IS NOT NULL AND pdf_file_id IS NOT NULL AND pdf_sha256 IS NOT NULL));
ALTER TABLE signature_request ADD CONSTRAINT sr_status_chk CHECK (status IN ('pending','sent','viewed','signed','declined','expired','voided'));
ALTER TABLE app_user_profile ADD CONSTRAINT user_role_chk CHECK (role IN ('admin','sales_manager','salesperson'));
ALTER TABLE buyer_response ADD CONSTRAINT decline_reason_required CHECK (response <> 'decline' OR length(coalesce(reason,'')) >= 1);

-- BR-SIG-011 / ADR-025: a sent version is immutable below the application.
CREATE FUNCTION proposal_version_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.state <> 'draft' AND (
       NEW.content IS DISTINCT FROM OLD.content OR NEW.pricing IS DISTINCT FROM OLD.pricing OR
       NEW.totals IS DISTINCT FROM OLD.totals OR NEW.term_months IS DISTINCT FROM OLD.term_months OR
       NEW.frozen_snapshot IS DISTINCT FROM OLD.frozen_snapshot OR NEW.snapshot_sha256 IS DISTINCT FROM OLD.snapshot_sha256 OR
       NEW.pdf_file_id IS DISTINCT FROM OLD.pdf_file_id OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256) THEN
    RAISE EXCEPTION 'VERSION_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.state = 'signed' AND NEW.state <> 'signed' THEN
    RAISE EXCEPTION 'VERSION_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER proposal_version_immutable BEFORE UPDATE ON proposal_version FOR EACH ROW EXECUTE FUNCTION proposal_version_immutable();
CREATE FUNCTION proposal_version_no_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.state <> 'draft' THEN RAISE EXCEPTION 'VERSION_IMMUTABLE' USING ERRCODE = 'P0001'; END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER proposal_version_no_delete BEFORE DELETE ON proposal_version FOR EACH ROW EXECUTE FUNCTION proposal_version_no_delete();

-- Least privilege for the application role (crm_app): DML only; append-only tables are INSERT/SELECT.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_app;
REVOKE UPDATE, DELETE ON audit_log, timeline_event, timeline_event_anchor, signature_event, deal_stage_history, ai_usage, download_event FROM crm_app;
REVOKE ALL ON schema_migration FROM crm_app;
