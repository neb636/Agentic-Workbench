import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { validateProposal, type LabProposal } from '../shared/labs';
import { executablePath } from './executables';

export const labRequestSchema = z.object({
  id: z.string().uuid(), provider: z.enum(['codex', 'claude']), prompt: z.string().trim().min(1).max(12000),
  snapshot: z.object({
    kind: z.enum(['camera', 'feel']), href: z.string().max(16000), context: z.record(z.string(), z.unknown()),
    controls: z.array(z.object({ key: z.string().max(200), label: z.string().max(500), value: z.number().finite(), min: z.number().finite(), max: z.number().finite(), step: z.number().positive(), defaultValue: z.number().finite().optional(), note: z.string().optional(), file: z.string().optional() })).max(100),
  }),
});
const outputSchema = {
  type: 'object', additionalProperties: false, required: ['explanation', 'changes'], properties: {
    explanation: { type: 'string' }, changes: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['key', 'value'], properties: { key: { type: 'string' }, value: { type: 'number' } },
    } },
  },
};
export function labPrompt(input: z.infer<typeof labRequestSchema>): string {
  return `You tune Kaylee's Gamepack for Dad. Return JSON matching the supplied schema. No tools, commands or file edits.\nChoose conservative absolute values only for the supplied controls, within their bounds. Explain what changed and what Dad should play/check. If the request cannot be addressed by these controls return no changes and explain why. Do not invent controls or claim you observed the screen. Preserve all other controls.\nCurrent lab snapshot:\n${JSON.stringify(input.snapshot)}\nDad's request:\n${input.prompt}`;
}
function stop(child: ChildProcess) {
  if (!child.pid) return;
  try { if (process.platform === 'win32') child.kill('SIGTERM'); else process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
}
/** One bounded, cancellable CLI job per view. No shell; no renderer-supplied executable or cwd. */
export class LabAi {
  private jobs = new Map<string, { owner: number; child?: ChildProcess; cancelled: boolean }>();
  cancel(id: string, owner: number) {
    const job = this.jobs.get(id);
    if (job?.owner !== owner) return;
    job.cancelled = true;
    if (job.child) stop(job.child);
  }
  cancelOwner(owner: number) { for (const [id, job] of this.jobs) if (job.owner === owner) this.cancel(id, owner); }
  async run(raw: unknown, owner: number): Promise<LabProposal> {
    const input = labRequestSchema.parse(raw);
    if (this.jobs.has(input.id)) throw new Error('Request already running');
    if ([...this.jobs.values()].filter(j => j.owner === owner).length >= 3) throw new Error('Three AI jobs are already running.');
    const binary = executablePath(input.provider);
    if (!binary) throw new Error(`Install and sign into ${input.provider} CLI first.`);
    const job: { owner: number; child?: ChildProcess; cancelled: boolean } = { owner, cancelled: false };
    this.jobs.set(input.id, job);
    let dir: string | undefined;
    try {
      dir = await fs.mkdtemp(path.join(tmpdir(), 'kaylee-lab-'));
      const schema = path.join(dir, 'schema.json'), output = path.join(dir, 'result.json');
      await fs.writeFile(schema, JSON.stringify(outputSchema));
      if (job.cancelled) throw new Error('Cancelled');
      const args = input.provider === 'codex'
        ? ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--output-schema', schema, '--output-last-message', output, '-']
        : ['--print', '--output-format', 'json', '--json-schema', JSON.stringify(outputSchema), '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--no-session-persistence'];
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(binary, args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
        job.child = child;
        let out = '', err = '', size = 0;
        const timer = setTimeout(() => { stop(child); reject(new Error('AI timed out after 3 minutes. Try a smaller request.')); }, 180000);
        const collect = (text: Buffer, stderr: boolean) => {
          size += text.length;
          if (size > 2 * 1024 * 1024) { stop(child); reject(new Error('AI response exceeded the output limit')); return; }
          if (stderr) err = (err + text).slice(-4000); else out += text;
        };
        child.stdout.on('data', data => collect(data, false));
        child.stderr.on('data', data => collect(data, true));
        child.stdin.on('error', () => undefined);
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => {
          clearTimeout(timer);
          if (job.cancelled) reject(new Error('Cancelled'));
          else if (code !== 0) {
            let detail = err || out.slice(-2000);
            if (input.provider === 'claude') { try { const result = JSON.parse(out); if (typeof result.result === 'string') detail = result.result; } catch { /* Plain CLI failure. */ } }
            reject(new Error(`${input.provider} exited ${code}: ${detail}`));
          }
          else resolve(out);
        });
        child.stdin.end(labPrompt(input));
      });
      const decoded = JSON.parse(input.provider === 'codex' ? await fs.readFile(output, 'utf8') : stdout);
      if (input.provider === 'claude' && decoded.is_error) throw new Error(decoded.result || 'Claude request failed');
      return validateProposal(input.snapshot, input.provider === 'claude' ? decoded.structured_output ?? JSON.parse(decoded.result) : decoded);
    } finally {
      this.jobs.delete(input.id);
      if (dir) await fs.rm(dir, { recursive: true, force: true });
    }
  }
}
