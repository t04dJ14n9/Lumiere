import { expect, test } from "@playwright/test";
import { open } from "./harness";

for (const block of [
  "```mermaid\nflowchart LR\nA --> B\n```",
  "<div>\nhello\n</div>",
]) {
  for (const key of ["j", "k", "gj", "gk"]) {
    test(`${key} reveals ${block.startsWith("```") ? "Mermaid" : "HTML"} source`, async ({
      page,
    }) => {
      const source = `before\n\n${block}\n\nafter`;
      await open(page, source, "obsidian", {
        features: { vim: { enabled: true, config: {} } },
      });
      const down = key.endsWith("j");
      const start = down ? 7 : source.indexOf("\n\nafter") + 1;
      const target = down
        ? source.indexOf(block)
        : source.indexOf(block) + block.lastIndexOf("\n") + 1;
      await page.evaluate((at) => window.harness.reveal(at), start);
      for (const letter of key) {
        await page.keyboard.press(letter);
      }
      await expect
        .poll(() =>
          page.evaluate(async () => (await window.harness.viewState()).head),
        )
        .toBe(target);
      await expect(
        page.locator(".cm-line").filter({ hasText: block.split("\n")[0]! }),
      ).toBeVisible();
    });
  }
}

test("ordinary Vim counts, operators, visual selection and source mode remain native", async ({
  page,
}) => {
  const source = "one\ntwo\nthree\nfour\nfive";
  await open(page, source, "obsidian", {
    features: { vim: { enabled: true, config: {} } },
  });
  await page.evaluate(() => window.harness.reveal(0));
  await page.keyboard.press("2");
  await page.keyboard.press("j");
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.harness.viewState()).head),
    )
    .toBe(8);
  await page.keyboard.press("v");
  await page.keyboard.press("k");
  const selection = await page.evaluate(() => window.harness.viewState());
  expect(selection.anchor).not.toBe(selection.head);
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.harness.reveal(0));
  await page.keyboard.press("d");
  await page.keyboard.press("j");
  await expect
    .poll(() => page.evaluate(() => window.harness.text))
    .toBe("three\nfour\nfive");
  await page.evaluate(() => window.harness.mode());
  await page.evaluate(() => window.harness.reveal(0));
  await page.keyboard.press("j");
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.harness.viewState()).head),
    )
    .toBe(6);
});

const mermaid = [
  "```mermaid",
  "flowchart LR",
  "A --> B",
  "B --> C",
  "C --> D",
  "D --> E",
  "```",
].join("\n");

const html = ["<div>", "alpha", "bravo", "charlie", "</div>"].join("\n");

async function caretHead(page: Parameters<typeof open>[0]) {
  return page.evaluate(async () => (await window.harness.viewState()).head);
}

for (const [label, block, lastBody, firstBody] of [
  ["Mermaid", mermaid, "D --> E", "flowchart LR"],
  ["HTML", html, "charlie", "alpha"],
] as const) {
  test(`k from a revealed ${label} close fence moves one source line up`, async ({
    page,
  }) => {
    const source = `Intro\n\n${block}\n\nOutro`;
    await open(page, source, "obsidian", {
      features: { vim: { enabled: true, config: {} } },
    });
    const close = source.lastIndexOf(block.split("\n").at(-1)!);
    const previous = source.lastIndexOf(lastBody);
    const opening = source.indexOf(block);
    const after = source.indexOf("\n\nOutro") + 1;
    await page.evaluate((at) => window.harness.reveal(at), after);
    await page.keyboard.press("k");
    await expect.poll(() => caretHead(page)).toBe(close);
    await expect(
      page.locator(".cm-line").filter({ hasText: firstBody }),
    ).toBeVisible();
    await page.keyboard.press("k");
    await expect.poll(() => caretHead(page)).toBe(previous);
    expect(await caretHead(page)).not.toBe(opening);
  });

  test(`j from a revealed ${label} open fence moves one source line down`, async ({
    page,
  }) => {
    const source = `Intro\n\n${block}\n\nOutro`;
    await open(page, source, "obsidian", {
      features: { vim: { enabled: true, config: {} } },
    });
    const opening = source.indexOf(block);
    const next = source.indexOf(firstBody);
    const close = source.lastIndexOf(block.split("\n").at(-1)!);
    await page.evaluate((at) => window.harness.reveal(at), 6);
    await page.keyboard.press("j");
    await expect.poll(() => caretHead(page)).toBe(opening);
    await page.keyboard.press("j");
    await expect.poll(() => caretHead(page)).toBe(next);
    expect(await caretHead(page)).not.toBe(close);
  });
}

test("Mermaid source-edit k after Edit keeps one-line motion and the diagram control", async ({
  page,
}) => {
  const source = `Intro\n\n${mermaid}\n\nOutro`;
  await open(page, source, "obsidian", {
    features: { vim: { enabled: true, config: {} } },
  });
  const close = source.lastIndexOf("```");
  const previous = source.lastIndexOf("D --> E");
  const opening = source.indexOf("```mermaid");
  await expect(
    page.getByRole("button", { name: "Edit diagram source" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit diagram source" }).click();
  await expect(
    page.locator(".cm-line").filter({ hasText: "flowchart LR" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate((at) => window.harness.reveal(at), close);
  await expect.poll(() => caretHead(page)).toBe(close);
  await page.keyboard.press("k");
  await expect.poll(() => caretHead(page)).toBe(previous);
  expect(await caretHead(page)).not.toBe(opening);
});

test("k from a revealed Mermaid close fence in a longer note moves one source line up", async ({
  page,
}) => {
  const prefix = Array.from(
    { length: 145 },
    (_, index) => `line ${index + 1}`,
  ).join("\n");
  const source = `${prefix}\n${mermaid}\n\nOutro`;
  await open(page, source, "obsidian", {
    features: { vim: { enabled: true, config: {} } },
  });
  const close = source.lastIndexOf("```");
  const previous = source.lastIndexOf("D --> E");
  const opening = source.indexOf("```mermaid");
  await page.evaluate((at) => window.harness.reveal(at), close);
  await expect.poll(() => caretHead(page)).toBe(close);
  await page.keyboard.press("k");
  await expect.poll(() => caretHead(page)).toBe(previous);
  expect(await caretHead(page)).not.toBe(opening);
});
