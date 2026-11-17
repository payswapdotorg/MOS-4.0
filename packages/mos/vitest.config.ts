import { defineConfig } from "vitest/config";

// MOS 单测项目：根 vitest projects 引用本文件（`pnpm test:mos`）。
// 纯 TS 单元测试（官方 API 用注入的 fetch 模拟，不打真实网络）。
export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: "mos",
    include: ["test/**/*.test.ts"],
    maxWorkers: 2,
    sequence: { groupOrder: 3 },
  },
});
