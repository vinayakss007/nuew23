import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

const LOG_FILE = path.join(process.cwd(), 'nucrm.log');

export async function GET(request: NextRequest) {
  // Create log file if it doesn't exist
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '', 'utf8');
  }

  const headers = new Headers();
  headers.set('Content-Type', 'text/event-stream');
  headers.set('Cache-Control', 'no-cache');
  headers.set('Connection', 'keep-alive');

  const stream = new ReadableStream({
    start(controller) {
      // Send existing logs (last 50)
      try {
        const content = fs.readFileSync(LOG_FILE, 'utf8');
        const lines = content.split('\n').filter(Boolean).slice(-50);
        
        lines.forEach(line => {
          try {
            const log = JSON.parse(line);
            controller.enqueue(`data: ${JSON.stringify(log)}\n\n`);
          } catch {
            controller.enqueue(`data: ${JSON.stringify({ message: line, level: 'info', ts: new Date().toISOString() })}\n\n`);
          }
        });
      } catch {}

      // Watch for new content
      let currentSize = fs.statSync(LOG_FILE).size;
      
      const interval = setInterval(() => {
        try {
          const stats = fs.statSync(LOG_FILE);
          if (stats.size > currentSize) {
            const fd = fs.openSync(LOG_FILE, 'r');
            const buffer = Buffer.alloc(stats.size - currentSize);
            fs.readSync(fd, buffer, 0, buffer.length, currentSize);
            fs.closeSync(fd);
            
            const newContent = buffer.toString('utf8');
            const newLines = newContent.split('\n').filter(Boolean);
            
            newLines.forEach(line => {
              try {
                const log = JSON.parse(line);
                controller.enqueue(`data: ${JSON.stringify(log)}\n\n`);
              } catch {
                controller.enqueue(`data: ${JSON.stringify({ message: line, level: 'info', ts: new Date().toISOString() })}\n\n`);
              }
            });
            
            currentSize = stats.size;
          }
        } catch {}
      }, 500);

      // Cleanup on client disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, { headers });
}
