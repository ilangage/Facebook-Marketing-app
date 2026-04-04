import cron from "node-cron";
import { runLoopTick } from "./loop-engine.js";

export function startScheduler() {
  const schedule = process.env.CRON_SCHEDULE || "*/5 * * * *";
  const enabled = process.env.CRON_ENABLE !== "false";

  if (!enabled) {
    console.log("[cron] disabled (set CRON_ENABLE=false)");
    return;
  }

  cron.schedule(schedule, async () => {
    try {
      await runLoopTick();
      console.log(`[cron] loop tick ok ${new Date().toISOString()}`);
    } catch (error) {
      console.error("[cron] loop tick failed", error.message);
    }
  });

  console.log(`[cron] scheduler started: ${schedule} (CRON_ENABLE=false to disable)`);
}
