/*
 * src/roles.js  (kse-sentinel-ops, Oct 14 2026)
 *
 * Who may see or do what, mirroring the backend's tables:
 * engine/shared/dapi_admin.py (Data API admin), the secrets routes, the team
 * routes and the client MFA reset. The console hides or disables what a role
 * cannot use; the backend refuses it anyway.
 */
export const ROLE_LABEL = {
  owner: "Owner", reviewer: "Onboarding", walkthrough: "Walkthrough",
  support: "Support", finance: "Finance", frontend_engineer: "Frontend engineer",
};

const RULES = {
  dapiRead: ["owner", "reviewer", "support", "finance"],
  dapiAudit: ["owner", "reviewer"],
  tenantWrite: ["owner", "reviewer"],
  keyWrite: ["owner", "reviewer"],
  webhookResume: ["owner", "reviewer", "support"],
  licenceRequest: ["owner"],
  licenceDecide: ["owner", "reviewer", "finance"],
  secretsRead: ["owner", "reviewer"],
  secretsWrite: ["owner"],
  teamManage: ["owner"],
  clientMfaReset: ["owner", "reviewer", "support"],
};

export const can = (role, what) => (RULES[what] || []).includes(role);
