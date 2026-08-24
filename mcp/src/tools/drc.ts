import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import * as z from 'zod/v4';
import { Bridge } from "../bridge";
import { textResult } from "../utils/tool-result";

export function registerDrcTools(server: McpServer, bridge: Bridge) {
    server.registerTool(
        'check_pcb_drc',
        {
            title: 'Check PCB DRC',
            description: 'Run EasyEDA PCB DRC check on the currently opened PCB document. Returns simplified DRC violations grouped by category. The limit is split evenly across rule groups within each category to avoid huge responses. Open the target PCB document first.',
            inputSchema: z.object({
                limit: z.number().min(1).max(200).default(24).describe('Maximum number of violations to return per category, split across rule groups.'),
            }),
        },
        async ({ limit }) => {
            const result = await bridge.requestEasyEda('check-pcb-drc', { limit }, 300000);
            return textResult(result);
        },
    );
}
