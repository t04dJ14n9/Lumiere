import * as vscode from "vscode";
import { createVsCodeIdeContextHost } from "@workshop/agents/ide-context";
import type { AgentHost, CopyLinkTarget } from "../../shared/host";
import { ideContextTemp } from "../ide-context-temp";
import { userTempFolder, writeOwnFile } from "../private-temp";

/** Extensions that bring an agent chat of their own besides the editor's. */
const AGENT_EXTENSIONS = ["anthropic.claude-code", "openai.chatgpt"];

/** Copy Link for Agent: which agent chats exist, and files to attach. */
export function createAgentHost(): AgentHost {
  return {
    appName: vscode.env.appName,
    async environment() {
      return {
        target: vscode.workspace
          .getConfiguration("lumiere.markdown")
          .get<CopyLinkTarget>("copyLinkForAgent.target", "auto"),
        agentExtensions: new Set(
          AGENT_EXTENSIONS.filter((id) => vscode.extensions.getExtension(id)),
        ),
        commands: new Set(await vscode.commands.getCommands(true)),
        hasChatParticipant: vscode.extensions.all.some(hasChatParticipants),
        chatDisabled: vscode.workspace
          .getConfiguration("chat")
          .get<boolean>("disableAIFeatures", false),
      };
    },
    async writeScratchFile(name, text) {
      const file = await writeOwnFile(
        userTempFolder("markdown-workshop-agent"),
        name,
        text,
      );
      return vscode.Uri.file(file).toString();
    },
    ideContextHost: () => createVsCodeIdeContextHost(vscode),
    ideContextTemp,
  };
}

function hasChatParticipants(extension: vscode.Extension<unknown>): boolean {
  const participants = (
    extension.packageJSON as
      { contributes?: { chatParticipants?: unknown } } | undefined
  )?.contributes?.chatParticipants;
  return Array.isArray(participants) && participants.length > 0;
}
