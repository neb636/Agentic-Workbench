import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { STUDIO_ORIGIN } from '../shared/labs';

const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
/** Keep the packaged renderer on the same exact origin trusted by the game labs. */
export class StudioServer {
  private server?: Server;
  async start(directory: string, port = Number(new URL(STUDIO_ORIGIN).port)): Promise<void> {
    const root = path.resolve(directory);
    const server = createServer(async (request, response) => {
      try {
        if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
        const pathname = decodeURIComponent(new URL(request.url || '/', STUDIO_ORIGIN).pathname);
        const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
        if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
        const body = await readFile(file);
        response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : body);
      } catch { response.writeHead(404).end(); }
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
  }
  stop() { this.server?.close(); this.server?.closeAllConnections(); this.server = undefined; }
}
