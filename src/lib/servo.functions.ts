import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { commandConfig, commandPower, commandSpeed, readPanel } from "@/lib/servo-db.server";

export const getPanel = createServerFn({ method: "GET" }).handler(async () => readPanel());

export const setPower = createServerFn({ method: "POST" })
  .validator(z.object({ action: z.enum(["on", "off"]) }))
  .handler(async ({ data }) => commandPower(data.action));

export const setSpeedRemote = createServerFn({ method: "POST" })
  .validator(z.object({ speed: z.number().min(0).max(100) }))
  .handler(async ({ data }) => commandSpeed(data.speed));

export const setConfig = createServerFn({ method: "POST" })
  .validator(
    z.object({
      direction: z.enum(["cw", "ccw"]).optional(),
      autoStopSec: z.number().optional(),
    }),
  )
  .handler(async ({ data }) => commandConfig(data));
