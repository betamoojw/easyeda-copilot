import findUp from "find-up";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const TEMP_DIR = join(tmpdir(), 'easyeda-copilot-mcp');
export const ROOT_DIR = dirname(findUp.sync('package.json', {
    cwd: __dirname
})!)
export const DOCS_DIR = join(ROOT_DIR, 'docs');
export const SKILL_DOC_PATH = join(DOCS_DIR, 'SKILL.md');
const require = createRequire(import.meta.url);
export const ROUTER_DSL_DOC_PATH = join(
    dirname(require.resolve('eda-copilot-router/package.json')),
    'docs',
    'routing-dsl.d.ts',
);
