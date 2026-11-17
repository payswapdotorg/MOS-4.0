/**
 * mos services 模块清单（architecture-governance managed 模块）。
 * 修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const mosServicesModule = {
  id: "mos-services",
  requires: ["mos", "rpc", "services", "shared"],
  provides: ["mos-connection-service", "mos-research-service"],
  publicEntrypoints: ["index.ts"],
} as const;
