import { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  type InitializeParams,
  type InitializeResult,
  type Position,
  type Location,
  type CallHierarchyItem,
  type CallHierarchyOutgoingCall,
  type DidOpenTextDocumentParams,
  type TextDocumentIdentifier,
  type TextDocumentPositionParams,
  type CallHierarchyPrepareParams,
  type CallHierarchyOutgoingCallsParams,
} from "vscode-languageserver-protocol";
import { toUri } from "./types.js";

/**
 * LSP client that communicates with a language server over JSON-RPC via stdio.
 */
export class LspClient {
  private process: ChildProcess;
  private requestId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private initialized = false;
  private openedFiles = new Set<string>();
  private rootPath = "";

  constructor(process: ChildProcess) {
    this.process = process;
    this.process.stdout!.setEncoding("utf-8");
    this.process.stdout!.on("data", (data: string) => this.onData(data));
    this.process.stderr!.on("data", (data: string) => {
      // Language server diagnostic output — ignore
    });
  }

  /** Parse incoming JSON-RPC messages from the server */
  private onData(chunk: string) {
    this.buffer += chunk;

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (this.buffer.length < bodyEnd) break; // Incomplete — wait for more data

      const body = this.buffer.slice(bodyStart, bodyEnd);
      this.buffer = this.buffer.slice(bodyEnd);

      try {
        const message = JSON.parse(body);
        if ("id" in message && this.pending.has(message.id)) {
          // Response to our request
          const { resolve, reject } = this.pending.get(message.id)!;
          this.pending.delete(message.id);
          if (message.error) {
            reject(new Error(`LSP error: ${message.error.message}`));
          } else {
            resolve(message.result);
          }
        } else if ("id" in message && "method" in message) {
          // Server-initiated request — must respond
          this.handleServerRequest(message);
        }
        // Ignore notifications (no id, has method)
      } catch {
        // Malformed JSON — skip
      }
    }
  }

  /** Send a JSON-RPC request and wait for the response */
  private sendRequest<T>(method: string, params: unknown): Promise<T> {
    const id = ++this.requestId;
    const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const frame = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.process.stdin!.write(frame);
    });
  }

  /** Send a JSON-RPC notification (no response expected) */
  private sendNotification(method: string, params: unknown): void {
    const message = JSON.stringify({ jsonrpc: "2.0", method, params });
    const frame = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`;
    this.process.stdin!.write(frame);
  }

  /** Initialize the language server */
  async initialize(rootPath: string, initOptions?: Record<string, unknown>): Promise<InitializeResult> {
    const params: InitializeParams = {
      processId: process.pid,
      rootUri: toUri(rootPath),
      capabilities: {
        textDocument: {
          definition: { dynamicRegistration: false },
          callHierarchy: { dynamicRegistration: false },
          hover: { dynamicRegistration: false, contentFormat: ["plaintext"] },
        },
      },
      initializationOptions: initOptions,
    } as InitializeParams;

    this.rootPath = rootPath;
    const result = await this.sendRequest<InitializeResult>("initialize", params);
    this.sendNotification("initialized", {});
    this.initialized = true;
    return result;
  }

  /** Handle server-initiated requests (e.g., workspace/configuration) */
  private handleServerRequest(message: { id: number; method: string; params?: unknown }): void {
    let result: unknown = null;

    if (message.method === "workspace/configuration") {
      // Pyright requests python.analysis settings — must include extraPaths
      // for project-internal module resolution (from app.services import X)
      const params = message.params as { items?: Array<{ section?: string }> } | undefined;
      result = (params?.items || []).map((item) => {
        if (item?.section === "python.analysis") {
          return {
            extraPaths: [this.rootPath],
            autoSearchPaths: true,
          };
        }
        if (item?.section === "python") {
          return {
            pythonPath: this.rootPath ? `${this.rootPath}/.venv/bin/python` : undefined,
          };
        }
        return {};
      });
    } else if (message.method === "client/registerCapability") {
      // Server wants to register dynamic capabilities — accept
      result = null;
    } else if (message.method === "window/workDoneProgress/create") {
      // Progress tracking — accept
      result = null;
    }

    // Send response
    const response = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
    const frame = `Content-Length: ${Buffer.byteLength(response)}\r\n\r\n${response}`;
    this.process.stdin!.write(frame);
  }

  /** Send workspace configuration notification */
  sendConfigurationNotification(settings: Record<string, unknown>): void {
    this.sendNotification("workspace/didChangeConfiguration", { settings });
  }

  /** Open a text document so the server can analyze it */
  async openFile(filePath: string, languageId: string): Promise<void> {
    if (this.openedFiles.has(filePath)) return;

    let text: string;
    try {
      text = readFileSync(filePath, "utf-8");
    } catch {
      return;
    }

    const params: DidOpenTextDocumentParams = {
      textDocument: {
        uri: toUri(filePath),
        languageId,
        version: 1,
        text,
      },
    };
    this.sendNotification("textDocument/didOpen", params);
    this.openedFiles.add(filePath);
  }

  /** Find definition of symbol at position */
  async definition(filePath: string, line: number, col: number): Promise<Location[] | null> {
    await this.openFile(filePath, this.detectLanguage(filePath));

    const params: TextDocumentPositionParams = {
      textDocument: { uri: toUri(filePath) },
      position: { line, character: col },
    };

    const result = await this.sendRequest<Location | Location[] | null>(
      "textDocument/definition",
      params,
    );

    if (!result) return null;
    return Array.isArray(result) ? result : [result];
  }

  /** Prepare call hierarchy at a position */
  async prepareCallHierarchy(
    filePath: string,
    line: number,
    col: number,
  ): Promise<CallHierarchyItem[] | null> {
    await this.openFile(filePath, this.detectLanguage(filePath));

    const params: CallHierarchyPrepareParams = {
      textDocument: { uri: toUri(filePath) },
      position: { line, character: col },
    };

    return this.sendRequest<CallHierarchyItem[] | null>(
      "textDocument/prepareCallHierarchy",
      params,
    );
  }

  /** Get all outgoing calls from a call hierarchy item */
  async outgoingCalls(item: CallHierarchyItem): Promise<CallHierarchyOutgoingCall[]> {
    const params: CallHierarchyOutgoingCallsParams = { item };
    return this.sendRequest<CallHierarchyOutgoingCall[]>(
      "callHierarchy/outgoingCalls",
      params,
    );
  }

  /** Shutdown and exit the language server */
  async shutdown(): Promise<void> {
    try {
      await this.sendRequest("shutdown", null);
      this.sendNotification("exit", null);
    } catch {
      // Server may have already exited
    }
    this.process.kill();
  }

  private detectLanguage(filePath: string): string {
    if (filePath.endsWith(".py")) return "python";
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return "typescript";
    if (filePath.endsWith(".js") || filePath.endsWith(".jsx")) return "javascript";
    return "plaintext";
  }
}
