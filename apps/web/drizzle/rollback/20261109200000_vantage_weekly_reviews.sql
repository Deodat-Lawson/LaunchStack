-- Operator rollback only, AFTER the Weekly Review feature kill switch is off.
-- Additive report/history tables are deliberately retained: dropping them would
-- destroy accepted evidence. The previous application build ignores these tables.
-- The normal forward-only migration runner does not automatically execute this file.
-- On this database session, explicitly attest the stopped deployment with:
-- SET app.vantage_weekly_review_enabled='off';
-- This is an operator attestation, not a read of Node's environment. Disable the
-- application feature first. After rollback, DO NOT enable the new application
-- path until the authority triggers have been reinstalled and verified.
DO $$ DECLARE tab text; BEGIN
 IF current_setting('app.vantage_weekly_review_enabled',true) IS DISTINCT FROM 'off' THEN
   RAISE EXCEPTION 'Weekly Review rollback requires explicit disabled-feature attestation' USING ERRCODE='23514';
 END IF;
 FOREACH tab IN ARRAY ARRAY[
 'pdr_ai_v2_users','pdr_ai_v2_user_company_memberships','pdr_ai_v2_workspace_roles',
 'pdr_ai_v2_workspace_groups','pdr_ai_v2_workspace_group_members',
 'pdr_ai_v2_folder_settings','pdr_ai_v2_folder_grants','pdr_ai_v2_document_settings','pdr_ai_v2_document_grants',
 'pdr_ai_v2_category','pdr_ai_v2_document','pdr_ai_v2_document_versions','pdr_ai_v2_document_context_chunks',
 'pdr_ai_v2_vantage_weekly_review_policy','pdr_ai_v2_vantage_weekly_review_preferences'
 ] LOOP EXECUTE format('DROP TRIGGER IF EXISTS vantage_authority_change ON %I',tab); END LOOP;
END $$;

