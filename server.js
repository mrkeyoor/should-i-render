#!/usr/bin/env node
// should-i-render MCP server. Stdio transport, bundled component snapshot,
// nine read-only tools, and a hard approximate 500-token response clamp.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { listTools, runTool } from './tools.js'

const server = new Server(
  { name: 'should-i-render', version: '0.2.4' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools() }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await runTool(request.params.name, request.params.arguments || {})
    return {
      content: [{ type: 'text', text: result.text }],
      structuredContent: result.structuredContent,
    }
  } catch (error) {
    const message = /cannot read template data file/i.test(String(error.message || error))
      ? 'should-i-render cannot read its bundled template catalog. Reinstall the package.'
      : /cannot read palette data file/i.test(String(error.message || error))
      ? 'should-i-render cannot read its bundled palette catalog. Reinstall the package.'
      : /cannot read data file/i.test(String(error.message || error))
        ? 'should-i-render cannot read its bundled component snapshot. Reinstall it or set SHOULD_I_RENDER_DATA to a valid components.json.'
      : `should-i-render error: ${error.message || error}`
    return { content: [{ type: 'text', text: message }], isError: true }
  }
})

async function main() {
  await server.connect(new StdioServerTransport())
  process.stderr.write('should-i-render MCP server running on stdio\n')
}

process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))

main().catch((error) => {
  process.stderr.write(`should-i-render failed to start: ${error.message || error}\n`)
  process.exit(1)
})
