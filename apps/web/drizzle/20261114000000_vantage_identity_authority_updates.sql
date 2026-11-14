-- Identity UPDATE classification, reviewed against require-workspace-context,
-- active-workspace, authz/resolve, authz/scope, rag/access, and workspace invitations.
-- Keep email (invitation identity) and legacy role/status conservatively covered.
-- users authority: id,userId,company_id,email,role,status
-- users incidental: name,last_active_at,created_at,updated_at,display_name,title,pronouns,time_zone,bio,provider_photo_checked_at
-- memberships authority: id,user_id,company_id,role,status
-- memberships incidental: last_opened_at,created_at,updated_at,profile_display_name,profile_title
-- The schema classification test requires every column to appear in exactly one list.
-- last_opened_at can choose a fallback workspace, whose identity is independently
-- checked against the expected actor at every authority boundary.
-- AFTER preserves the ON CONFLICT DO NOTHING and document-row/epoch lock ordering
-- fix. INSERT/DELETE and actual identity/permission changes still use the existing
-- OLD+NEW tenant invalidation function, inside the writing transaction.
-- Document, upload/version, chunk, policy, preference, and ACL table writes keep
-- their existing company-wide invalidation. This is only an identity-table filter.
DROP TRIGGER vantage_authority_change ON pdr_ai_v2_users;
--> statement-breakpoint
CREATE TRIGGER vantage_authority_change AFTER INSERT OR DELETE ON pdr_ai_v2_users
FOR EACH ROW EXECUTE FUNCTION pdr_ai_v2_vantage_bump_authority();
--> statement-breakpoint
CREATE TRIGGER vantage_authority_update AFTER UPDATE ON pdr_ai_v2_users
FOR EACH ROW WHEN (
    ROW(OLD.id, OLD."userId", OLD.company_id, OLD.email, OLD.role, OLD.status)
    IS DISTINCT FROM
    ROW(NEW.id, NEW."userId", NEW.company_id, NEW.email, NEW.role, NEW.status)
) EXECUTE FUNCTION pdr_ai_v2_vantage_bump_authority();
--> statement-breakpoint
DROP TRIGGER vantage_authority_change ON pdr_ai_v2_user_company_memberships;
--> statement-breakpoint
CREATE TRIGGER vantage_authority_change AFTER INSERT OR DELETE ON pdr_ai_v2_user_company_memberships
FOR EACH ROW EXECUTE FUNCTION pdr_ai_v2_vantage_bump_authority();
--> statement-breakpoint
CREATE TRIGGER vantage_authority_update AFTER UPDATE ON pdr_ai_v2_user_company_memberships
FOR EACH ROW WHEN (
    ROW(OLD.id, OLD.user_id, OLD.company_id, OLD.role, OLD.status)
    IS DISTINCT FROM
    ROW(NEW.id, NEW.user_id, NEW.company_id, NEW.role, NEW.status)
) EXECUTE FUNCTION pdr_ai_v2_vantage_bump_authority();
