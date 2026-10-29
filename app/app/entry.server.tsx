import { renderToReadableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;

// Cloudflare Workers entry: web streams instead of Node streams.
export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), streamTimeout + 1000);

  const body = await renderToReadableStream(
    <ServerRouter context={reactRouterContext} url={request.url} />,
    {
      signal: controller.signal,
      onError(error: unknown) {
        responseStatusCode = 500;
        console.error(error);
      },
    },
  );
  body.allReady.finally(() => clearTimeout(timeout));

  // Bots and crawlers get the full document at once.
  if (isbot(request.headers.get("user-agent") ?? "")) await body.allReady;

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, { headers: responseHeaders, status: responseStatusCode });
}
