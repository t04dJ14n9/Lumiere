/** The part of VS Code's API that src/host/text-completions.ts uses. */
export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}
export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
  ) {
    this.start = new Position(startLine, startCharacter);
    this.end = new Position(endLine, endCharacter);
  }
}
export const CompletionItemKind = { Reference: 17 };
export class CompletionItem {
  insertText?: string;
  range?: Range;
  filterText?: string;
  sortText?: string;
  constructor(
    readonly label: string | { label: string; description?: string },
    readonly kind?: number,
  ) {}
}
export class CompletionList {
  constructor(
    readonly items: CompletionItem[],
    readonly isIncomplete: boolean,
  ) {}
}
export interface Registration {
  selector: unknown;
  provider: {
    provideCompletionItems(
      document: unknown,
      position: Position,
      token: { isCancellationRequested: boolean },
    ): Promise<CompletionList | undefined>;
  };
  triggers: string[];
  disposed: boolean;
}
export const registrations: Registration[] = [];
export const languages = {
  registerCompletionItemProvider(
    selector: unknown,
    provider: Registration["provider"],
    ...triggers: string[]
  ) {
    const registration = { selector, provider, triggers, disposed: false };
    registrations.push(registration);
    return {
      dispose() {
        registration.disposed = true;
      },
    };
  },
};
