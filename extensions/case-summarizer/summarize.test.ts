import registerSummarizer from "./index.ts";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { CaseSummaryResponseSchema, SummaryAuditResponseSchema, caseSummaryJsonShape, parseCaseSummary, parseSummaryAudit, summaryAuditJsonShape } from "./schema.ts";
import { PART_OVERLAP_TOKENS, PART_TOKEN_LIMIT, runCaseSummarizer, splitSourceIntoOverlappingParts } from "./summarize.ts";
import { loadCaseSource, type LoadedCaseSource } from "./source.ts";
import { runValidatedModelCall, SummaryResponseError, type ValidatedModelCallRecord } from "./validated-model.ts";
import { runModelCall } from "./model-runner.ts";

const sourceText = "Synthetic opinion used only to test the summarizer. The trial court's judgment was affirmed. ".repeat(5);
const summary = () => {
  const value = JSON.parse(caseSummaryJsonShape());
  value.case_identity.name = "Synthetic Case";
  value.key_quotes = [];
  return value;
};
const audit = { disagreements: [], findings: [], required_corrections: [] };
type Response = { text: string; stopReason?: string };
type Invocation = { stage: string; attempt: number; prompt: string; maxTokens: number; api: string; payload: any; systemPrompt: string; sessionId?: string; cacheRetention?: string };

function fakeContext(cwd: string, respond: (call: Invocation) => Response | Promise<Response>) {
  const invocations: Invocation[] = [];
  const ctx = { cwd, model: { provider: "fixture", id: "model", api: "openai-responses", contextWindow: 200_000, maxTokens: 9_000 },
    modelRegistry: { hasConfiguredAuth: () => true,
      complete: async (model: { api: string }, context: { systemPrompt: string; messages: Array<{ content: Array<{ text: string }> }> },
        options: { maxTokens: number; sessionId?: string; cacheRetention?: string; onPayload?: (payload: unknown) => unknown | Promise<unknown> }) => {
        const prompt = context.messages[0].content[0].text;
        const stage = prompt.match(/Candidate role: ([^\n]+)/)?.[1]
          ?? prompt.match(/Multipart segment: ([^\n]+)/)?.[1]
          ?? (prompt.includes("fourth-call auditor") || prompt.includes("auditing ordered partial summaries") ? "audit" : "final");
        const payload = { messages: context.messages, max_tokens: options.maxTokens };
        const call = { stage, attempt: invocations.filter(item => item.stage === stage).length + 1, prompt, maxTokens: options.maxTokens,
          systemPrompt: context.systemPrompt, sessionId: options.sessionId, cacheRetention: options.cacheRetention,
          api: model.api, payload: options.onPayload ? await options.onPayload(payload) : payload };
        invocations.push(call);
        const response = await respond(call);
        return { content: response.text ? [{ type: "text", text: response.text }] : [], stopReason: response.stopReason ?? "stop", usage: {} };
      },
    },
  } as unknown as ExtensionContext;
  return { ctx, invocations };
}
const valid = (call: Invocation): Response => ({ text: JSON.stringify(call.stage === "audit" ? audit : summary()) });
async function fixture(fn: (root: string) => Promise<void>) {
  const parent = realpathSync(tmpdir());
  const root = realpathSync(mkdtempSync(join(parent, "summary-response-")));
  try { writeFileSync(join(root, "opinion.txt"), sourceText); await fn(root); }
  finally {
    assert.equal(dirname(root).toLowerCase(), parent.toLowerCase());
    assert.ok(basename(root).startsWith("summary-response-"));
    rmSync(root, { recursive: true, force: true });
  }
}

test("model format examples are concrete JSON accepted by the summary and audit parsers", () => {
  const parsed = parseCaseSummary(caseSummaryJsonShape(), "example");
  assert.equal(typeof parsed.executive_summary[0], "object");
  assert.deepEqual(parsed.executive_summary[0].source_blocks, ["P00001"]);
  assert.equal(parseSummaryAudit(summaryAuditJsonShape()).findings[0].category, "source_accuracy");
});

test("provider schemas reject missing fields, bare strings, and extra properties", () => {
  assert.equal(Check(CaseSummaryResponseSchema, summary()), true);
  assert.equal(Check(SummaryAuditResponseSchema, audit), true);
  assert.equal(Check(SummaryAuditResponseSchema, JSON.parse(summaryAuditJsonShape())), true);
  for (const change of [
    (value: any) => { value.executive_summary = ["Unsupported plain string"]; },
    (value: any) => { delete value.holdings; },
    (value: any) => { value.executive_summary[0].source_blocks = []; },
    (value: any) => { value.executive_summary[0].confidence = "certain"; },
    (value: any) => { value.case_identity.unrequested = "extra"; },
  ]) {
    const value = summary(); change(value);
    assert.equal(Check(CaseSummaryResponseSchema, value), false);
  }
  assert.equal(Check(SummaryAuditResponseSchema, { ...audit, findings: ["Not an object"] }), false);
});

test("all five LM Studio stages request strict JSON schemas without mutating the active model", () => fixture(async root => {
  const { ctx, invocations } = fakeContext(root, valid);
  Object.assign(ctx.model!, { provider: "lmstudio", baseUrl: "http://localhost:1234/v1", compat: { supportsDeveloperRole: false } });
  const activeBefore = JSON.stringify(ctx.model);
  const output = await runCaseSummarizer({ source_path: "opinion.txt" }, undefined, undefined, ctx);
  assert.equal(invocations.length, 5);
  for (const call of invocations) {
    assert.equal(call.api, "openai-completions");
    assert.equal(call.payload.response_format.type, "json_schema");
    const format = call.payload.response_format.json_schema;
    assert.equal(format.strict, true);
    assert.equal(format.name, call.stage === "audit" ? "case_summary_audit" : "case_summary");
    assert.deepEqual(format.schema, call.stage === "audit" ? SummaryAuditResponseSchema : CaseSummaryResponseSchema);
    assert.ok(call.payload.messages.length);
  }
  assert.equal(JSON.stringify(ctx.model), activeBefore);
  assert.equal(output.details.modelCalls.every(call => call.api === "openai-completions" && call.responseFormat === "json_schema"), true);
}));

test("LM Studio response retries preserve schema enforcement and source-reference checks", () => fixture(async root => {
  const { ctx, invocations } = fakeContext(root, call => {
    if (call.stage === "legal-structure" && call.attempt === 1) {
      const value = summary(); value.holdings[0].source_blocks = ["P99999"];
      return { text: JSON.stringify(value) };
    }
    return valid(call);
  });
  Object.assign(ctx.model!, { provider: "lmstudio", api: "openai-completions" });
  const output = await runCaseSummarizer({ source_path: "opinion.txt" }, undefined, undefined, ctx);
  assert.equal(output.details.callsCompleted, 6);
  const retried = invocations.filter(call => call.stage === "legal-structure");
  assert.equal(retried.length, 2);
  assert.deepEqual(retried[1].payload.response_format, retried[0].payload.response_format);
  assert.equal(retried[1].api, "openai-completions");
  assert.match(retried[1].prompt, /unknown source blocks/);
}));

test("a schema rejection never silently falls back to ordinary text", async () => {
  const { ctx, invocations } = fakeContext(".", () => { throw new Error("Server rejected response_format schema"); });
  Object.assign(ctx.model!, { provider: "lmstudio" });
  await assert.rejects(() => runModelCall(ctx, "fixture", { systemPrompt: "", userPrompt: "",
    responseSchema: { name: "case_summary", schema: CaseSummaryResponseSchema } }, 500), /Server rejected response_format/);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].api, "openai-completions");
});

test("other providers and requests without a summary schema keep their configured API", () => fixture(async root => {
  const { ctx, invocations } = fakeContext(root, valid);
  const output = await runCaseSummarizer({ source_path: "opinion.txt" }, undefined, undefined, ctx);
  assert.equal(invocations.every(call => call.api === "openai-responses" && !call.payload.response_format), true);
  assert.equal(output.details.modelCalls.every(call => call.responseFormat === "text"), true);
  Object.assign(ctx.model!, { provider: "lmstudio" });
  const other = await runModelCall(ctx, "other-tool", { systemPrompt: "", userPrompt: "" }, 500);
  assert.equal(other.record.api, "openai-responses");
  assert.equal(other.record.responseFormat, "text");
  assert.equal(invocations.at(-1)!.payload.response_format, undefined);
}));

test("context preflight includes the provider schema before making a model request", async () => {
  const { ctx, invocations } = fakeContext(".", valid);
  Object.assign(ctx.model!, { provider: "lmstudio", contextWindow: 3_000 });
  await assert.rejects(() => runModelCall(ctx, "fixture", { systemPrompt: "", userPrompt: "",
    responseSchema: { name: "case_summary", schema: CaseSummaryResponseSchema } }, 500), /exceed the active model context window/);
  assert.equal(invocations.length, 0);
  await runModelCall(ctx, "other-tool", { systemPrompt: "", userPrompt: "" }, 500);
  assert.equal(invocations.length, 1);
});

test("a valid summary still takes five calls and can be saved without altering its opinion", () => fixture(async root => {
  const { ctx, invocations } = fakeContext(root, valid);
  const output = await runCaseSummarizer({ source_path: "opinion.txt", output_path: "brief.md" }, undefined, undefined, ctx);
  assert.equal(invocations.length, 5);
  assert.equal(output.details.callsCompleted, 5);
  assert.equal(output.details.modelCalls.every(call => call.attempt === 1 && !call.validationError), true);
  assert.equal(output.details.summary.treatment_status, "not_checked");
  assert.match(readFileSync(join(root, "brief.md"), "utf8"), /Synthetic Case/);
  assert.equal(readFileSync(join(root, "opinion.txt"), "utf8"), sourceText);
}));

test("multipart splitting uses 120k-token parts with deterministic overlap", () => {
  const blocks = Array.from({ length: 7 }, (_, index) => ({
    id: `P${String(index + 1).padStart(5, "0")}`,
    text: String(index + 1).repeat(4_000),
  }));
  const source = {
    sourcePath: "opinion.md", rawSha256: "raw", textSha256: "text", rawBytes: 28_000,
    normalizedText: blocks.map(block => block.text).join("\n\n"), blocks, estimatedTokens: 7_000,
  } as LoadedCaseSource;
  const parts = splitSourceIntoOverlappingParts(source, 3_000, 1_000);
  assert.deepEqual(parts.map(part => part.blocks.map(block => block.id)), [
    ["P00001", "P00002", "P00003"],
    ["P00003", "P00004", "P00005"],
    ["P00005", "P00006", "P00007"],
  ]);
  assert.equal(PART_TOKEN_LIMIT, 120_000);
  assert.equal(PART_OVERLAP_TOKENS, 2_000);
});

test("a large Markdown opinion uses overlapping multipart summaries before audit and reconstruction", async () => {
  const parent = realpathSync(tmpdir());
  const root = realpathSync(mkdtempSync(join(parent, "summary-multipart-")));
  try {
    const longText = "A legally material paragraph discussing facts, rules, reasoning, and disposition. ".repeat(9_000);
    writeFileSync(join(root, "long-opinion.md"), longText);
    const loaded = await loadCaseSource({ cwd: root, sourcePath: "long-opinion.md" });
    assert.ok(loaded.estimatedTokens > 170_000);
    const { ctx, invocations } = fakeContext(root, call => {
      if (call.stage === "audit") return { text: JSON.stringify(audit) };
      const value = summary();
      const firstBlock = call.prompt.match(/"blocks":\[\{"id":"(P\d+)"/)?.[1] ?? "P00001";
      for (const section of Object.keys(value)) {
        if (Array.isArray(value[section])) {
          for (const item of value[section]) if (item?.source_blocks) item.source_blocks = [firstBlock];
        }
      }
      return { text: JSON.stringify(value) };
    });
    Object.assign(ctx.model!, { contextWindow: 265_000 });
    const output = await runCaseSummarizer({ source_path: "long-opinion.md" }, undefined, undefined, ctx);
    assert.equal(output.details.pipeline, "overlapping_parts_then_combined_audit_then_reconstruction");
    assert.ok(output.details.multipart && output.details.multipart.partCount >= 2);
    assert.equal(output.details.multipart?.partTokenLimit, 120_000);
    assert.equal(output.details.multipart?.overlapTokens, 2_000);
    assert.equal(invocations.length, output.details.multipart!.partCount + 2);
    const parts = splitSourceIntoOverlappingParts(loaded);
    const partContexts = invocations.slice(0, parts.length).map(call => JSON.parse(call.prompt.match(/^PART_CONTEXT_JSON=(.+)$/m)![1]));
    for (const [index, context] of partContexts.entries()) {
      assert.equal(context.source_scope, "partial_opinion");
      assert.equal(context.part_number, index + 1);
      assert.equal(context.total_parts, parts.length);
      assert.equal(context.first_block, parts[index].blocks[0].id);
      assert.equal(context.last_block, parts[index].blocks.at(-1)!.id);
      assert.equal(context.has_previous_part, index > 0);
      assert.equal(context.has_next_part, index + 1 < parts.length);
      const neighbors = new Set([...(parts[index - 1]?.blocks ?? []), ...(parts[index + 1]?.blocks ?? [])].map(block => block.id));
      assert.deepEqual(context.overlap_block_ids, parts[index].blocks.filter(block => neighbors.has(block.id)).map(block => block.id));
      assert.ok(context.overlap_block_ids.length > 0);
    }
    for (const invocation of invocations.slice(-2)) {
      const partials = JSON.parse(invocation.prompt.match(/^PARTIAL_SUMMARIES_JSON=(.+)$/m)![1]);
      assert.deepEqual(partials.map(({ summary: _summary, ...context }: any) => context), partContexts);
      assert.ok(partials.every((partial: any) => partial.summary.executive_summary.length > 0));
    }
  } finally {
    assert.equal(dirname(root).toLowerCase(), parent.toLowerCase());
    rmSync(root, { recursive: true, force: true });
  }
});

for (const kind of ["bare section string", "invalid JSON", "unknown source block", "empty response"] as const) {
  test(`${kind} retries only the failed candidate and retains the other analyses`, () => fixture(async root => {
    const { ctx, invocations } = fakeContext(root, call => {
      if (call.stage !== "legal-structure" || call.attempt !== 1) return valid(call);
      const bad = summary();
      if (kind === "bare section string") bad.executive_summary = ["A plain string lacks source references."];
      if (kind === "unknown source block") bad.executive_summary[0].source_blocks = ["P99999"];
      return { text: kind === "empty response" ? "" : kind === "invalid JSON"
        ? JSON.stringify(bad).replace('"source_blocks":', '"source_blocks" ') : JSON.stringify(bad) };
    });
    const updates: string[] = [];
    const output = await runCaseSummarizer({ source_path: "opinion.txt" }, undefined, update => { updates.push(JSON.stringify(update)); }, ctx);
    assert.equal(output.details.callsAttempted, 6);
    assert.equal(invocations.filter(call => call.stage === "legal-structure").length, 2);
    for (const stage of ["facts-and-procedure", "skeptical-analysis", "audit", "final"]) {
      assert.equal(invocations.filter(call => call.stage === stage).length, 1, stage);
    }
    assert.match(invocations.find(call => call.attempt === 2)!.prompt, /RESPONSE VALIDATION FEEDBACK/);
    assert.equal(output.details.modelCalls.filter(call => call.validationError).length, 1);
    assert.ok(updates.some(update => update.includes('retrying')));
    assert.equal(output.details.summary.executive_summary[0].source_blocks[0], "P00001");
  }));
}

test("audit and final reconstruction each receive their own bounded validation retry", () => fixture(async root => {
  const { ctx, invocations } = fakeContext(root, call => {
    if (call.attempt === 1 && call.stage === "audit") return { text: '{"findings":[' };
    if (call.attempt === 1 && call.stage === "final") {
      const bad = summary(); bad.holdings = ["Not a supported-statement object"]; return { text: JSON.stringify(bad) };
    }
    return valid(call);
  });
  const output = await runCaseSummarizer({ source_path: "opinion.txt" }, undefined, undefined, ctx);
  assert.equal(output.details.callsCompleted, 7);
  assert.equal(invocations.filter(call => call.stage === "audit").length, 2);
  assert.equal(invocations.filter(call => call.stage === "final").length, 2);
  assert.equal(output.details.modelCalls.filter(call => call.validationError).length, 2);
}));

test("a token-limited response is retried with a larger budget within the model limit", () => fixture(async root => {
  const { ctx, invocations } = fakeContext(root, call => ({ ...valid(call),
    stopReason: call.stage === "legal-structure" && call.attempt === 1 ? "length" : "stop" }));
  const output = await runCaseSummarizer({ source_path: "opinion.txt" }, undefined, undefined, ctx);
  assert.equal(output.details.callsCompleted, 6);
  const attempts = invocations.filter(call => call.stage === "legal-structure");
  assert.equal(attempts[0].maxTokens, 5_000);
  assert.equal(attempts[1].maxTokens, 9_000);
  assert.match(output.details.modelCalls.find(call => call.validationError)!.validationError!, /output token limit/);
}));

test("repeated invalid summaries fail with stage and model information, not fabricated references", () => fixture(async root => {
  const { ctx, invocations } = fakeContext(root, call => {
    if (call.stage !== "legal-structure") return valid(call);
    const bad = summary(); bad.executive_summary = ["A string cannot establish source support."];
    return { text: JSON.stringify(bad) };
  });
  await assert.rejects(() => runCaseSummarizer({ source_path: "opinion.txt", output_path: "brief.md" }, undefined, undefined, ctx), error => {
    assert.ok(error instanceof SummaryResponseError);
    assert.equal(error.stage, "candidate:legal-structure");
    assert.match(error.message, /after 2 attempts \(fixture\/model\)/);
    assert.match(error.message, /not a source_path or tool-argument error/);
    return true;
  });
  assert.equal(invocations.filter(call => call.stage === "legal-structure").length, 2);
  assert.equal(invocations.some(call => call.stage === "audit" || call.stage === "final"), false);
  assert.equal(existsSync(join(root, "brief.md")), false);
}));

test("cancellation stops a pending response retry", async () => {
  const controller = new AbortController();
  const { ctx, invocations } = fakeContext(".", () => ({ text: "not JSON" }));
  const records: ValidatedModelCallRecord[] = [];
  await assert.rejects(() => runValidatedModelCall(ctx, { stage: "fixture", prompt: { systemPrompt: "", userPrompt: "" },
    maxOutputTokens: 500, signal: controller.signal, validate: text => JSON.parse(text), onCall: record => records.push(record),
    onRetry: () => controller.abort(new Error("Test cancellation")),
  }), /Test cancellation/);
  assert.equal(invocations.length, 1);
  assert.equal(records.length, 1);
});

test("transport failures are not mistaken for invalid JSON and are not automatically retried", async () => {
  const { ctx, invocations } = fakeContext(".", () => { throw new Error("Provider connection unavailable"); });
  await assert.rejects(() => runValidatedModelCall(ctx, { stage: "fixture", prompt: { systemPrompt: "", userPrompt: "" },
    maxOutputTokens: 500, validate: text => JSON.parse(text), onCall: () => {}, onRetry: () => { assert.fail("Unexpected retry"); },
  }), /Provider connection unavailable/);
  assert.equal(invocations.length, 1);
});


test("summary stages run serially with a shared prefix and isolated candidate inputs", () => fixture(async root => {
  let active = 0;
  let peak = 0;
  const { ctx, invocations } = fakeContext(root, async call => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>(resolve => setImmediate(resolve));
    active--;
    if (call.stage === "audit") return valid(call);
    const value = summary();
    value.case_identity.name = "PRIVATE_CANDIDATE_" + call.stage;
    return { text: JSON.stringify(value) };
  });
  await runCaseSummarizer({ source_path: "opinion.txt" }, undefined, undefined, ctx);
  assert.equal(peak, 1);
  assert.deepEqual(invocations.map(call => call.stage), ["legal-structure", "facts-and-procedure", "skeptical-analysis", "audit", "final"]);
  const prefix = invocations[0].prompt.split("\n").slice(0, 2).join("\n");
  assert.ok(prefix.startsWith("SOURCE_JSON="));
  assert.ok(prefix.includes(sourceText.trim()));
  for (const call of invocations) {
    assert.ok(call.prompt.startsWith(prefix));
    assert.equal(call.systemPrompt, invocations[0].systemPrompt);
    assert.equal(call.cacheRetention, "short");
    assert.ok(call.sessionId);
    assert.equal(call.sessionId, invocations[0].sessionId);
  }
  for (const call of invocations.slice(0, 3)) assert.doesNotMatch(call.prompt, /PRIVATE_CANDIDATE_|CANDIDATES_JSON=|AUDIT_JSON=/);
  assert.match(invocations[3].prompt, /PRIVATE_CANDIDATE_legal-structure/);
  await runCaseSummarizer({ source_path: "opinion.txt" }, undefined, undefined, ctx);
  assert.notEqual(invocations[5].sessionId, invocations[0].sessionId);
}));

test("exhausted candidate recovery prevents subsequent analyses from starting", () => fixture(async root => {
  const { ctx, invocations } = fakeContext(root, call => call.stage === "facts-and-procedure" ? { text: "invalid" } : valid(call));
  await assert.rejects(() => runCaseSummarizer({ source_path: "opinion.txt" }, undefined, undefined, ctx), SummaryResponseError);
  assert.deepEqual(invocations.map(call => call.stage), ["legal-structure", "facts-and-procedure", "facts-and-procedure"]);
  assert.equal(new Set(invocations.map(call => call.sessionId)).size, 1);
  assert.ok(invocations.every(call => call.cacheRetention === "short"));
}));

test("cancellation after an analysis prevents the next stage and output save", () => fixture(async root => {
  const controller = new AbortController();
  const { ctx, invocations } = fakeContext(root, call => {
    controller.abort(new Error("Stop summary"));
    return valid(call);
  });
  await assert.rejects(() => runCaseSummarizer({ source_path: "opinion.txt", output_path: "brief.md" }, controller.signal, undefined, ctx), /Stop summary/);
  assert.equal(invocations.length, 1);
  assert.equal(existsSync(join(root, "brief.md")), false);
}));

test("other model-runner callers keep caching disabled by default", async () => {
  const { ctx, invocations } = fakeContext(".", valid);
  for (let i = 0; i < 2; i++) await runModelCall(ctx, "other", { systemPrompt: "", userPrompt: "" }, 500);
  assert.ok(invocations.every(call => call.cacheRetention === "none"));
  assert.notEqual(invocations[0].sessionId, invocations[1].sessionId);
});


for (const extension of ["html", "md"]) {
  test(`a ${extension} opinion automatically saves a Markdown summary and preserves prior versions`, () => fixture(async root => {
    const input = extension === "html" ? `<html><body><article><p>${sourceText}</p></article></body></html>` : sourceText;
    const filename = `selected.case.${extension}`;
    writeFileSync(join(root, filename), input);
    const { ctx } = fakeContext(root, valid);
    const first = await runCaseSummarizer({ source_path: filename }, undefined, undefined, ctx);
    const expected = join(root, "selected.case.Summary.md");
    assert.equal(first.details.outputPath, expected);
    assert.equal(readFileSync(expected, "utf8"), first.markdown);
    assert.match(first.markdown, /Executive summary/);
    assert.match(first.markdown, /Reasoning/);
    const second = await runCaseSummarizer({ source_path: filename }, undefined, undefined, ctx);
    assert.equal(second.details.outputPath, join(root, "selected.case.Summary.2.md"));
    assert.equal(readFileSync(expected, "utf8"), first.markdown);
    assert.equal(readFileSync(second.details.outputPath, "utf8"), second.markdown);
    assert.equal(readFileSync(join(root, filename), "utf8"), input);
  }));
}

test("explicit summary output paths retain JSON support and never overwrite existing work", () => fixture(async root => {
  const { ctx } = fakeContext(root, valid);
  const first = await runCaseSummarizer({ source_path: "opinion.txt", output_path: "custom.json" }, undefined, undefined, ctx);
  assert.deepEqual(JSON.parse(readFileSync(first.details.outputPath, "utf8")), first.details.summary);
  const saved = readFileSync(first.details.outputPath, "utf8");
  await assert.rejects(() => runCaseSummarizer({ source_path: "opinion.txt", output_path: "custom.json" }, undefined, undefined, ctx), { code: "EEXIST" });
  assert.equal(readFileSync(first.details.outputPath, "utf8"), saved);
  assert.equal(existsSync(join(root, "opinion.Summary.md")), false);
}));


test("registered summarizer emits Pi lifecycle and stage updates", () => fixture(async root => {
  const tools: any[] = [];
  registerSummarizer({ registerTool: (tool: any) => tools.push(tool) } as never);
  const { ctx } = fakeContext(root, valid);
  const updates: any[] = [];
  await tools[0].execute("summary-progress", { source_path: "opinion.txt" }, undefined,
    (update: any) => updates.push(update.details), ctx);
  assert.equal(updates[0].phase, "starting");
  assert.equal(updates.at(-1).phase, "completed");
  assert.ok(updates.every(u => u.tool === "summarize_case" && u.toolCallId === "summary-progress"));
  assert.equal(updates.filter(u => u.status === "analyzing").length, 3);
  const failure: any[] = [];
  await assert.rejects(() => tools[0].execute("summary-failed", { source_path: "missing.html" }, undefined,
    (update: any) => failure.push(update.details), ctx));
  assert.equal(failure.at(-1).status, "failed");
}));
