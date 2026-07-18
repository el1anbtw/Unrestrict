import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const fixture = await readFile(path.join(import.meta.dirname, "fixtures", "matrix.html"));
const port = Number(process.env.UNRESTRICT_FIXTURE_PORT || 8765);

const server = createServer((request, response) => {
  if (request.url === "/" || request.url === "/matrix.html") {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    response.end(fixture);
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Unrestrict fixture: http://127.0.0.1:${port}/matrix.html`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
