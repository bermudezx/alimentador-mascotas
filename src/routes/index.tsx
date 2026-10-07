import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url);
        url.pathname = "/panel/index.html";
        return Response.redirect(url, 307);
      },
    },
  },
  component: function Home() {
    if (typeof window !== "undefined") window.location.replace("/panel/index.html");
    return null;
  },
});
