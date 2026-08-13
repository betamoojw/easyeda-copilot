import { defineConfig } from 'tsup';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sdkDistDir = dirname(dirname(require.resolve('@modelcontextprotocol/sdk/package.json')));

const sdkEsmPath = (...parts: string[]) =>
    join(sdkDistDir, 'esm', ...parts);

export default defineConfig({
    entry: [
        'src/index.ts',
        'src/pcb-preview/cli.ts',
        'src/pcb-preview/index.ts',
        'src/routing/easyeda-autoroute-adapter.ts',
        'src/routing/easyeda-drc-adapter.ts',
        'src/routing/run-easyeda-routing.ts',
    ],
    format: ['esm'],
    clean: true,
    dts: false,
    sourcemap: false,
    noExternal: ['@modelcontextprotocol/sdk', '@copilot/shared', '@easyeda-copilot/router'],
    esbuildPlugins: [
        {
            name: 'mcp-sdk-extensionless-imports',
            setup(build) {
                build.onResolve({ filter: /^@modelcontextprotocol\/sdk\/server\/mcp$/ }, () => ({
                    path: sdkEsmPath('server', 'mcp.js'),
                }));

                build.onResolve({ filter: /^@modelcontextprotocol\/sdk\/server\/stdio$/ }, () => ({
                    path: sdkEsmPath('server', 'stdio.js'),
                }));
            },
        },
    ],
});
