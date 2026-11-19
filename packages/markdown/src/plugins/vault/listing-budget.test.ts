import assert from "node:assert/strict";
import test from "node:test";
import { ListingBudget } from "./listing-budget";

test("notes and other files are limited apart, so other files never crowd out notes", () => {
  const budget = new ListingBudget(2);
  assert.equal(budget.admit("a.png"), true);
  assert.equal(budget.admit("b.png"), true);
  assert.equal(budget.admit("c.png"), false);
  assert.equal(budget.isPartial, true);
  assert.equal(budget.isSpent, false, "the walk goes on for notes");
  assert.equal(budget.admit("One.md"), true);
  assert.equal(budget.admit("Two.markdown"), true);
  assert.equal(budget.isSpent, false);
  assert.equal(budget.admit("Three.md"), false);
  assert.equal(budget.isSpent, true, "a refused note ends the walk");
});

test("a walk stops after seeing far more files than it keeps, and is then partial", () => {
  const budget = new ListingBudget(1);
  for (let n = 0; n < 9; n++) {
    budget.admit(`${n}.png`);
  }
  assert.equal(budget.isSpent, false);
  budget.admit("9.png");
  assert.equal(budget.isSpent, true);
  const complete = new ListingBudget(5);
  complete.admit("One.md");
  complete.stop(0);
  assert.equal(complete.isPartial, false);
  complete.stop(3);
  assert.equal(complete.isPartial, true, "folders were left unvisited");
});
