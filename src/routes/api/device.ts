import { createFileRoute } from "@tanstack/react-router";
import { boardCheckIn, readPanel } from "@/lib/servo-db.server";

function command(snapshot: Awaited<ReturnType<typeof readPanel>>) {
  return {
    running: snapshot.running,
    speed: snapshot.speed,
    direction: snapshot.direction,
    autoStopSec: snapshot.autoStopSec,
    boardOnline: snapshot.boardOnline,
  };
}

export const Route = createFileRoute("/api/device")({
  server: {
    handlers: {
      GET: async () => Response.json(command(await readPanel())),
      POST: async ({ request }) => {
        let body: unknown = {};
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
        const snapshot = await boardCheckIn(payload);
        return Response.json(command(snapshot));
      },
    },
  },
});
