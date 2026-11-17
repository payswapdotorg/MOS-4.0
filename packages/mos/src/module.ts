/**
 * mos 模块清单（architecture-governance managed 模块）。
 * 修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const mosModule = {
  id: "mos",
  requires: [],
  provides: ["mos"],
  publicEntrypoints: [
    "index.ts",
    "contract.ts",
    "capability/index.ts",
    "quota/index.ts",
    "youtube/index.ts",
    "research/index.ts",
  ],
} as const;
