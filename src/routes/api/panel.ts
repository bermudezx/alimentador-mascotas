import { createFileRoute } from "@tanstack/react-router";

const JAVA = "http://127.0.0.1:8090/api/panel";

async function forward(request: Request) {
  try {
    const init: RequestInit = {
      method: request.method,
      headers: { "content-type": "application/json" },
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.text();
    }
    const response = await fetch(JAVA, init);
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch {
    return Response.json({ online: false }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/panel")({
  server: {
    handlers: {
      GET: ({ request }) => forward(request),
      POST: ({ request }) => forward(request),
    },
  },
});
