/**
 * MCP client harness.
 * Spawns the three MCP servers over stdio and hands the agents typed `call`
 * handles. This is how the Fastify pipeline actually exercises the MCP layer —
 * every agent talks to a real MCP server, never to in-process shortcuts.
 */

import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PROJECT_ROOT } from '../mcp-servers/shared/index.js';

async function makeClient(name, serverRelPath) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(PROJECT_ROOT, serverRelPath)],
  });
  const client = new Client({ name: `contract-reviewer-${name}`, version: '1.0.0' });
  await client.connect(transport);

  return {
    name,
    /** Call an MCP tool and return its parsed JSON payload. */
    async call(tool, args = {}) {
      const res = await client.callTool({ name: tool, arguments: args });
      const text = res?.content?.[0]?.text ?? '';
      try {
        return JSON.parse(text);
      } catch {
        return { status: 'error', message: `Unparseable response from ${name}.${tool}`, raw: text };
      }
    },
    async close() {
      await client.close();
    },
  };
}

/**
 * Spawn all three MCP servers and return their clients.
 * @returns {Promise<{db:object, knowledge:object, parser:object, closeAll:Function}>}
 */
export async function createClients() {
  const [db, knowledge, parser] = await Promise.all([
    makeClient('db', 'mcp-servers/review-db-mcp/server.js'),
    makeClient('knowledge', 'mcp-servers/legal-knowledge-mcp/server.js'),
    makeClient('parser', 'mcp-servers/contract-parser-mcp/server.js'),
  ]);

  return {
    db,
    knowledge,
    parser,
    async closeAll() {
      await Promise.allSettled([db.close(), knowledge.close(), parser.close()]);
    },
  };
}
