export interface RefreshPolicy {
  attendanceQuota: boolean;
  throttleMs: number;
}

// Cost controls vary by transport; a brief tap cooldown still protects JUET.
export const REFRESH_POLICIES = {
  proxy: { attendanceQuota: true, throttleMs: 20_000 },
  native: { attendanceQuota: false, throttleMs: 2_000 },
} as const satisfies Record<string, RefreshPolicy>;

export function selectRefreshPolicy(usesProxy: boolean, quotaMode = "auto"): RefreshPolicy {
  const policy = usesProxy ? REFRESH_POLICIES.proxy : REFRESH_POLICIES.native;
  if (quotaMode === "on" || quotaMode === "off") {
    return { ...policy, attendanceQuota: quotaMode === "on" };
  }
  return policy;
}
