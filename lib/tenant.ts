export const tenant = {
  slug: process.env.OTIS_TENANT_SLUG ?? null,
  displayName: process.env.OTIS_TENANT_DISPLAY_NAME ?? "Otis",
  publicUrl: process.env.OTIS_TENANT_PUBLIC_URL ?? null,
  logoUrl: process.env.OTIS_LOGO_URL ?? null,
  primaryColor: process.env.OTIS_PRIMARY_COLOR ?? null,
};

const REQUIRED_FOR_TENANT = [
  "OTIS_TENANT_SLUG",
  "OTIS_TENANT_PUBLIC_URL",
  "CASTLE_DEPLOYMENT_ID",
  "CASTLE_API_URL",
] as const;

export function requireTenantEnv(): void {
  const isTenantMode =
    process.env.OTIS_TENANT_SLUG != null ||
    process.env.TENANT_MODE === "tenant";
  if (!isTenantMode) return;

  const missing = REQUIRED_FOR_TENANT.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[tenant] Missing required env vars for tenant deploy: ${missing.join(", ")}`,
    );
  }
}
