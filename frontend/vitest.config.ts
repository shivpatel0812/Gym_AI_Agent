import { defineConfig } from "vitest/config";

// chartUtils is deliberately free of React and react-native imports so the
// chart logic — where the gap, trend and bodyweight rules live — can be tested
// without a native renderer in the loop.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
