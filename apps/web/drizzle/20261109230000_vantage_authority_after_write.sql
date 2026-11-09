-- Bump authority only for writes that actually occur. A BEFORE INSERT trigger
-- also runs for INSERT ... ON CONFLICT DO NOTHING; that no-op retry could hold
-- the epoch while waiting for an existing document row, opposite the version
-- writer's document-row -> epoch order, causing a deadlock.
-- AFTER row triggers still execute inside the writing transaction, before commit.
-- An admission holding the epoch can therefore precede a pending write, but no
-- source/ACL write can commit without publishing its epoch change.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY[
 'pdr_ai_v2_users','pdr_ai_v2_user_company_memberships','pdr_ai_v2_workspace_roles',
 'pdr_ai_v2_workspace_groups','pdr_ai_v2_workspace_group_members',
 'pdr_ai_v2_folder_settings','pdr_ai_v2_folder_grants','pdr_ai_v2_document_settings','pdr_ai_v2_document_grants',
 'pdr_ai_v2_category','pdr_ai_v2_document','pdr_ai_v2_document_versions','pdr_ai_v2_document_context_chunks',
 'pdr_ai_v2_vantage_weekly_review_policy','pdr_ai_v2_vantage_weekly_review_preferences'
 ] LOOP
 EXECUTE format('DROP TRIGGER vantage_authority_change ON %I',tab);
 EXECUTE format('CREATE TRIGGER vantage_authority_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION pdr_ai_v2_vantage_bump_authority()',tab);
 END LOOP;
END $$;

