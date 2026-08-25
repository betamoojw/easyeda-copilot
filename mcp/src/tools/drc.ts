import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import * as z from 'zod/v4';
import { PcbDrcBundleSchema } from '@copilot/shared/types/pcb/drc.js';
import { Bridge } from "../bridge";
import { summarizeEasyEdaDrcBundle } from '../routing/easyeda-drc-adapter';
import { textResult } from "../utils/tool-result";

export function registerDrcTools(server: McpServer, bridge: Bridge) {
    server.registerTool(
        'get_pcb_drc_rules',
        {
            title: 'Get PCB DRC Rules',
            description: 'Return a compact routing-relevant view of the current EasyEDA PCB DRC rules: global limits, net classes, differential pairs, equal-length groups, and explicit net overrides. Open the target PCB document first.',
            inputSchema: z.object({}),
        },
        async () => {
            const bundle = PcbDrcBundleSchema().parse(await bridge.requestEasyEda('get-pcb-drc-rules'));
            return textResult(summarizeEasyEdaDrcBundle(bundle));
        },
    );

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
