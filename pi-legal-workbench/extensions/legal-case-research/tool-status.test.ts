import assert from "node:assert/strict";
import test from "node:test";
import { runWithToolStatus } from "./tool-status.ts";

test("runWithToolStatus emits start, scoped progress, and completion updates", async () => {
  const updates: any[] = [];
  const output = await runWithToolStatus({
    tool: "legal_search",
    toolCallId: "call-17",
    onUpdate: (update) => updates.push(update),
    operation: async (onUpdate) => {
      onUpdate?.({
        content: [{ type: "text", text: "Searching Scholar page 1." }],
        details: { phase: "search", page: 1 },
      });
      return { content: [], details: { status: "stopped" } };
    },
  });

  assert.equal(output.details.status, "stopped");
  assert.equal(updates.length, 3);
  assert.deepEqual(updates.map((update) => update.details.phase), ["starting", "search", "completed"]);
  assert.deepEqual(updates.map((update) => update.details.status), ["running", "running", "completed"]);
  assert.ok(updates.every((update) => update.details.tool === "legal_search"));
  assert.ok(updates.every((update) => update.details.toolCallId === "call-17"));
  assert.equal(updates[1].details.message, "Searching Scholar page 1.");
  assert.equal(updates[2].details.resultStatus, "stopped");
});

test("runWithToolStatus emits failure and rethrows", async () => {
  const updates: any[] = [];
  await assert.rejects(
    () => runWithToolStatus({
      tool: "direct_download",
      toolCallId: "call-18",
      onUpdate: (update) => updates.push(update),
      operation: async () => {
        throw new Error("selection expired");
      },
    }),
    /selection expired/,
  );

  assert.deepEqual(updates.map((update) => update.details.status), ["running", "failed"]);
  assert.equal(updates[1].details.phase, "failed");
  assert.equal(updates[1].details.error, "selection expired");
});

test("runWithToolStatus reports cancellation when the signal is aborted", async () => {
  const controller = new AbortController();
  const updates: any[] = [];
  controller.abort();

  await assert.rejects(() => runWithToolStatus({
    tool: "legal_cited_by",
    toolCallId: "call-19",
    signal: controller.signal,
    onUpdate: (update) => updates.push(update),
    operation: async () => {
      throw new Error("Operation aborted.");
    },
  }));

  assert.deepEqual(updates.map((update) => update.details.status), ["running", "cancelled"]);
});

test("runWithToolStatus never reports completed after a normally returning abort", async () => {
  const controller = new AbortController();
  const updates: any[] = [];
  const output = await runWithToolStatus({
    tool: "legal_search",
    toolCallId: "call-19b",
    signal: controller.signal,
    onUpdate: (update) => updates.push(update),
    operation: async () => {
      controller.abort();
      return { content: [], details: { status: "stopped" } };
    },
  });

  assert.equal(output.details.status, "stopped");
  assert.deepEqual(updates.map((update) => update.details.status), ["running", "cancelled"]);
  assert.equal(updates[1].details.resultStatus, "stopped");
});

test("status callback failures do not break a tool call", async () => {
  const output = await runWithToolStatus({
    tool: "legal_jurisdictions",
    toolCallId: "call-20",
    onUpdate: () => {
      throw new Error("UI unavailable");
    },
    operation: async (onUpdate) => {
      onUpdate?.({ content: [{ type: "text", text: "Working." }], details: {} });
      return { content: [], details: {} };
    },
  });

  assert.deepEqual(output, { content: [], details: {} });
});
