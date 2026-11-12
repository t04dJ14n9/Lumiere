// Sensitivity control: the same harness against the pre-fix client source
// extracted (read-only) from commit c7016eb3, where the reviewer reproduced
// the bug. All four client files are identical to HEAD except note-frame.ts.
import { noteBody } from "/tmp/chain-evidence-final/react/prefix-src/packages/dsh/src/client/index";
import { mount } from "./app";

mount(noteBody as never);
