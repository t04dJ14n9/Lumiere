import test from "node:test";
import assert from "node:assert/strict";
import type { MenuItem } from "../editor/api";
import { reportingFailures } from "./menu";

test("a menu Cut that is refused reports its message to the table, and the failure is rethrown", async () => {
  const reported: string[] = [];
  const [cut] = reportingFailures(
    [
      {
        label: "Cut",
        run: () =>
          Promise.reject(
            new Error("The selection changed before Cut completed. Cut again."),
          ),
      },
    ] as MenuItem[],
    (message) => reported.push(message),
  );
  await assert.rejects(
    Promise.resolve().then(() => cut!.run!()),
    /Cut again/,
  );
  assert.deepEqual(reported, [
    "The selection changed before Cut completed. Cut again.",
  ]);
});
