// Explicit integration check against the user's configured local Gemma provider.
// Reads Hopkins in place; writes generated output and diagnostics only to a new temp folder.
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PI_CODING_AGENT_DIR = 'C:/Users/bacon21/.pi/pilegal';
const { ModelRuntime, ModelRegistry } = await import('@earendil-works/pi-coding-agent');
const { runCaseSummarizer } = await import('../extensions/case-summarizer/summarize.ts');
const agentDir = process.env.PI_CODING_AGENT_DIR;
const runtime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'),
  allowModelNetwork: false, refreshOnCreate: false });
await runtime.refresh({ providers: ['lmstudio'], allowNetwork: false });
const registry = new ModelRegistry(runtime);
const model = registry.find('lmstudio', 'google/gemma-4-26b-a4b-qat');
if (!model) throw new Error('The session Gemma model was not found.');
const directory = mkdtempSync(join(tmpdir(), 'summary-gemma-live-'));
const cwd = 'C:/Users/bacon21/RentCase/Matters/1 Claims And Defenses';
const source = 'Cases/hopkins-v-deneweth-dugan-parfitt-pc-mich-court-of-appeals-2016-16374420496855965477.html';
console.log(JSON.stringify({ directory, model: model.id, source }));
let calls = 0;
const requests = [];
const endpoints = [];
const ctx = { cwd, model, modelRegistry: {
  hasConfiguredAuth: current => registry.hasConfiguredAuth(current),
  complete: async (...args) => {
    const id = ++calls;
    const [requestModel, context, options] = args;
    const response = await registry.complete(requestModel, context, { ...options,
      onPayload: async (...payloadArgs) => {
        const next = await options.onPayload?.(...payloadArgs);
        const payload = next ?? payloadArgs[0];
        const format = payload.response_format;
        const record = { call: id, api: requestModel.api, responseFormat: format?.type,
          schemaName: format?.json_schema?.name, strict: format?.json_schema?.strict };
        requests.push(record);
        appendFileSync(join(directory, 'requests.jsonl'), JSON.stringify(record) + '\n');
        return payload;
      },
      fetch: async (...fetchArgs) => {
        const input = fetchArgs[0];
        const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname;
        endpoints.push(path);
        return (options.fetch ?? globalThis.fetch)(...fetchArgs);
      },
    });
    appendFileSync(join(directory, 'responses.jsonl'), JSON.stringify({ id, response }) + '\n');
    console.log(JSON.stringify({ call: id, stopReason: response.stopReason,
      textCharacters: response.content.filter(part => part.type === 'text').map(part => part.text).join('').length }));
    return response;
  },
} };
let result;
try {
  const output = await runCaseSummarizer({ source_path: source, audience: 'attorney' }, AbortSignal.timeout(360000),
    update => console.log(update.content.map(part => part.text ?? '').join(' ')), ctx);
  writeFileSync(join(directory, 'hopkins-summary.md'), output.markdown);
  writeFileSync(join(directory, 'details.json'), JSON.stringify(output.details, null, 2));
  result = { status: output.details.status, directory, model: model.id, calls: output.details.callsCompleted,
    requests, endpoints,
    modelCallFormats: output.details.modelCalls.map(call => ({ stage: call.stage, api: call.api, format: call.responseFormat })),
    warnings: output.details.validationWarnings, caseIdentity: output.details.summary.case_identity,
    retriedStages: output.details.modelCalls.filter(call => call.validationError).map(call => ({ stage: call.stage, error: call.validationError })) };
} catch (error) {
  result = { status: 'failed', directory, model: model.id, calls, requests, endpoints, error: error.message };
  process.exitCode = 1;
}
writeFileSync(new URL('./summarizer-gemma-structured-live-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
