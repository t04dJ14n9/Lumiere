import { useEffect, useRef, useState } from "react";
import type { HostMessage } from "../shared/messages";
import type { ReadingPosition } from "../shared/reading-position";
import { samePosition } from "../shared/pdf-history";
import type { ViewChoices } from "../shared/view-settings";
import { postToHost } from "./host";
import type { Navigation } from "./navigation";
import { rememberedPosition } from "./reading-position";
import { useStageApi } from "./stage-capability";
import { layoutApplied } from "./stage-layout";
import { readingPlace, zoomChoice } from "./stage-position";

import type {
  Dependencies,
  HistoryStage,
  PendingJump,
  Replay,
} from "./jump-history-types";

/** Frames a jump or replay may take before it is given up. */
const MAX_FRAMES = 180;
/** Frames the position must stay the same to count as settled. */
const STEADY_FRAMES = 4;

/** The viewer reports discrete jumps; the authoritative stack lives in the host. */
export function useJumpHistory(
  navigation: Navigation,
  choices: ViewChoices,
  setChoices: (choices: ViewChoices) => void,
) {
  const stage = useStageApi();
  const [state, setState] = useState({ back: false, forward: false });
  const controller = useRef<JumpHistoryController | undefined>(undefined);
  controller.current ??= new JumpHistoryController(setState);
  const history = controller.current;
  history.dependencies = { navigation, choices, setChoices, stage };
  useEffect(() => () => history.dispose(), [history]);
  return {
    jump: history.jump,
    preview: history.preview,
    endPreview: history.endPreview,
    handle: history.handle,
    back: state.back,
    forward: state.forward,
    onBack: () => history.traverse("back"),
    onForward: () => history.traverse("forward"),
  };
}

/**
 * Turns deliberate jumps (links, page numbers, search results) into history
 * entries for the host, and replays the host's Back and Forward. Its methods
 * are bound once, so the hook hands out stable callbacks.
 */
class JumpHistoryController {
  dependencies!: Dependencies;
  private sequence = 0;
  private startedToken = 0;
  private frame: number | undefined;
  private pending: PendingJump | undefined;
  private previewOrigin:
    { position: ReadingPosition; readerRevision: number } | undefined;
  private replay: Replay | undefined;

  constructor(
    private readonly setState: (state: {
      back: boolean;
      forward: boolean;
    }) => void,
  ) {}

  private get intent() {
    return this.dependencies.navigation.intent;
  }

  /** Where the reader is now. */
  readonly snapshot = (): ReadingPosition =>
    readingSnapshot(this.dependencies.choices, this.dependencies.stage);

  /** A search result shown before it is accepted: Back returns to before it. */
  readonly preview = (run: () => void): void => {
    this.finishJump();
    this.cancelReplay();
    const intent = this.intent;
    if (this.previewOrigin?.readerRevision !== intent.readerRevision()) {
      this.previewOrigin = {
        position: this.snapshot(),
        readerRevision: intent.readerRevision(),
      };
    }
    intent.advance();
    run();
  };

  readonly endPreview = (): void => {
    this.previewOrigin = undefined;
  };

  /** Run a deliberate move and record it once the viewport settles. */
  readonly jump = (
    run: () => void,
    requestId?: number,
    acceptPreview = false,
    expectedIntent?: number,
  ): void => {
    if (expectedIntent !== undefined && !this.intent.owns(expectedIntent)) {
      if (requestId !== undefined) {
        this.reportRestored(requestId, this.intent.current(), false);
      }
      return;
    }
    this.finishJump();
    this.cancelReplay();
    const intent = this.intent;
    const from =
      acceptPreview &&
      this.previewOrigin?.readerRevision === intent.readerRevision()
        ? this.previewOrigin.position
        : this.snapshot();
    this.previewOrigin = undefined;
    const generation = intent.advance();
    this.pending = {
      from,
      id: ++this.sequence,
      ...(requestId === undefined ? {} : { requestId }),
      ...(expectedIntent === undefined
        ? {}
        : { acknowledge: true, generation }),
    };
    run();
    this.settleJump(generation);
  };

  /** Messages about history from the host; false for any other message. */
  readonly handle = (message: Exclude<HostMessage, { type: "load" }>) => {
    switch (message.type) {
      case "historyState":
        this.setState({ back: message.back, forward: message.forward });
        return true;
      case "historyCancel":
        this.onCancel(message.token);
        return true;
      case "historyCapture":
        this.onCapture(message.token);
        return true;
      case "historyRestore":
        this.onRestore(message);
        return true;
      default:
        return false;
    }
  };

  traverse(direction: "back" | "forward"): void {
    this.finishJump();
    postToHost({ type: "historyTraverse", direction });
  }

  dispose(): void {
    this.intent.advance();
    this.clearFrame();
    this.pending = undefined;
    this.previewOrigin = undefined;
    this.replay = undefined;
  }

  /** Wait, frame by frame, until the jump's destination stops moving. */
  private settleJump(generation: number): void {
    const intent = this.intent;
    let previous = this.snapshot();
    let steady = 0;
    let frames = 0;
    const settle = (): void => {
      if (!this.pending) {
        return;
      }
      const position = this.snapshot();
      steady = samePosition(previous, position) ? steady + 1 : 0;
      previous = position;
      frames++;
      const settled =
        this.dependencies.navigation.isReady() &&
        frames > 6 &&
        steady >= STEADY_FRAMES;
      if (!intent.owns(generation) || settled || frames >= MAX_FRAMES) {
        this.finishJump(settled && intent.owns(generation));
        return;
      }
      this.frame = requestAnimationFrame(settle);
    };
    this.frame = requestAnimationFrame(settle);
  }

  /** Record the pending jump (and acknowledge a precise link's arrival). */
  private finishJump(applied = false): void {
    const jump = this.pending;
    if (!jump) {
      return;
    }
    this.pending = undefined;
    this.clearFrame();
    const { acknowledge, generation, ...entry } = jump;
    postToHost({ type: "historyJump", ...entry, to: this.snapshot() });
    if (acknowledge && entry.requestId !== undefined) {
      const intent = this.intent;
      this.reportRestored(
        entry.requestId,
        intent.current(),
        applied && generation !== undefined && intent.owns(generation),
      );
    }
  }

  private onCancel(token: number | undefined): void {
    if (token !== undefined && this.replay?.token !== token) {
      return;
    }
    this.previewOrigin = undefined;
    this.intent.advance();
    this.cancelReplay();
  }

  private onCapture(token: number): void {
    this.finishJump();
    this.previewOrigin = undefined;
    postToHost({
      type: "historyCaptured",
      token,
      startedToken: this.startedToken,
      position: this.snapshot(),
      intent: this.intent.current(),
      ok: true,
    });
  }

  private onRestore(
    message: Extract<HostMessage, { type: "historyRestore" }>,
  ): void {
    // Input can occur during capture -> host -> restore IPC, before a local
    // restoration loop even exists. Never revive that stale request.
    if (!this.intent.owns(message.expectedIntent)) {
      this.reportRestored(message.token, this.intent.current(), false);
      return;
    }
    this.finishJump();
    this.cancelReplay();
    this.previewOrigin = undefined;
    const requested = message.position;
    this.replay = {
      token: message.token,
      requested,
      generation: this.intent.advance(),
      frames: 0,
      steady: 0,
      positioned: false,
      previous: this.snapshot(),
    };
    this.startedToken = message.token;
    this.dependencies.setChoices({
      pageLayout: requested.pageLayout,
      scrollMode: requested.scrollMode,
      scrollDirection: requested.scrollDirection,
    });
    const replay = this.replay;
    const step = (): void => {
      if (this.replay === replay && this.replayStep(replay)) {
        this.frame = requestAnimationFrame(step);
      }
    };
    this.frame = requestAnimationFrame(step);
  }

  /**
   * One frame of a replay: wait for the layout, then move to the position
   * (zoom included); done once it holds still. Returns whether to run another
   * frame.
   */
  private replayStep(replay: Replay): boolean {
    if (!this.intent.owns(replay.generation) || ++replay.frames > MAX_FRAMES) {
      this.cancelReplay();
      return false;
    }
    const { navigation, stage } = this.dependencies;
    if (!navigation.isReady() || navigation.pageCount < 1) {
      return true;
    }
    if (!replay.positioned) {
      this.positionReplay(replay, stage, {
        ...replay.requested,
        page: Math.min(replay.requested.page, navigation.pageCount),
      });
    } else if (this.replaySettled(replay)) {
      return false;
    }
    return true;
  }

  /**
   * Move to the replayed position once the Stage has the replayed layout (the
   * view choices reach it from a render's effect). The move carries the zoom.
   */
  private positionReplay(
    replay: Replay,
    stage: HistoryStage,
    position: ReadingPosition,
  ): void {
    if (!layoutApplied(stage.getSettings(), position)) {
      return;
    }
    if (this.intent.owns(replay.generation)) {
      this.dependencies.navigation.restore(position);
      // The position supersedes any move still in flight.
      replay.generation = this.intent.current();
    }
    replay.positioned = true;
    replay.steady = 0;
  }

  /** Whether the replay's arrival has held still; then it is reported. */
  private replaySettled(replay: Replay): boolean {
    const actual = this.snapshot();
    replay.steady = samePosition(replay.previous, actual)
      ? replay.steady + 1
      : 0;
    replay.previous = actual;
    if (replay.steady < STEADY_FRAMES) {
      return false;
    }
    this.replay = undefined;
    this.frame = undefined;
    postToHost({
      type: "historyRestored",
      token: replay.token,
      position: actual,
      intent: replay.generation,
      ok: true,
    });
    return true;
  }

  private cancelReplay(): void {
    const replay = this.replay;
    if (!replay) {
      return;
    }
    this.replay = undefined;
    this.clearFrame();
    this.reportRestored(replay.token, this.intent.current(), false);
  }

  private reportRestored(token: number, intent: number, ok: boolean): void {
    postToHost({
      type: "historyRestored",
      token,
      position: this.snapshot(),
      intent,
      ok,
    });
  }

  private clearFrame(): void {
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
    }
    this.frame = undefined;
  }
}

/** The reading position: the remembered choices, the zoom and the place at the corner of the view. */
function readingSnapshot(
  choices: ViewChoices,
  stage: HistoryStage,
): ReadingPosition {
  const result = { ...rememberedPosition(), ...choices };
  result.zoom = zoomChoice(stage);
  const place = readingPlace(stage);
  if (place) {
    result.page = place.page;
    result.top = place.top;
    result.left = place.left;
  }
  return result;
}
