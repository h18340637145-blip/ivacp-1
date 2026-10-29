"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type {
  ServerTerminalMessage,
  TerminalProjectContext,
} from "@/domain/terminal/types";
import { TerminalClient, type TerminalAction } from "../terminal-client";
import { copyText } from "../browser-files";
import "@xterm/xterm/css/xterm.css";
export interface TerminalPaneHandle {
  startSync: () => boolean;
  enqueue: (action: TerminalAction) => boolean;
  input: (data: string) => void;
  disconnect: () => void;
  configure: (context: TerminalProjectContext, data?: string) => void;
}
interface Props {
  targetId: string;
  gatewayUrl: string;
  context?: TerminalProjectContext;
  active: boolean;
  onMessage: (message: ServerTerminalMessage) => void;
  onState: (
    state: "connecting" | "connected" | "closed" | "failed",
    error?: string,
  ) => void;
  onBusy: (value: boolean) => void;
}
export const TerminalPane = forwardRef<TerminalPaneHandle, Props>(
  function TerminalPane(
    { targetId, gatewayUrl, context, active, onMessage, onState, onBusy },
    ref,
  ) {
    const host = useRef<HTMLDivElement>(null);
    const client = useRef<TerminalClient | undefined>(undefined);
    const close = useRef<() => void>(() => {});
    const fit = useRef<() => void>(() => {});
    const latest = useRef({ context, onMessage, onState, onBusy });
    useEffect(() => {
      latest.current = { context, onMessage, onState, onBusy };
      client.current?.setContext(context);
    }, [context, onMessage, onState, onBusy]);
    useImperativeHandle(
      ref,
      () => ({
        startSync: () => client.current?.startSync() ?? false,
        enqueue: (a) => client.current?.enqueue(a) ?? false,
        input: (data) => client.current?.input(data),
        disconnect: () => close.current(),
        configure: (ctx, data) => {
          client.current?.setContext(ctx);
          if (data) client.current?.input(data);
        },
      }),
      [],
    );
    useEffect(() => {
      if (active) fit.current();
    }, [active]);
    useEffect(() => {
      let disposed = false;
      let cleanup = () => {};
      latest.current.onState("connecting");
      // xterm evaluates browser globals: only import it after this component mounts.
      void Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")])
        .then(([{ Terminal }, { FitAddon }]) => {
          if (disposed || !host.current) return;
          const element = host.current;
          const terminal = new Terminal({
            cursorBlink: true,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: 13,
            scrollback: 5000,
            theme: {
              background: "#10151c",
              foreground: "#dce4ed",
              cursor: "#6da7ff",
              selectionBackground: "#344766",
            },
          });
          const addon = new FitAddon();
          terminal.loadAddon(addon);
          terminal.open(element);
          const socket = new WebSocket(gatewayUrl);
          const send = (
            message: Parameters<
              ConstructorParameters<typeof TerminalClient>[1]
            >[0],
          ) => {
            if (!disposed && socket.readyState === WebSocket.OPEN)
              socket.send(JSON.stringify(message));
          };
          let connected = false;
          let ended = false;
          let frame = 0;
          const fail = (reason: string) => {
            if (disposed || ended) return;
            ended = true;
            clearTimeout(connectTimer);
            latest.current.onState("failed", reason);
            terminal.write(`\r\n[错误] ${reason}\r\n`);
            connection.dispose();
            socket.close();
          };
          const connection = new TerminalClient(
            targetId,
            send,
            (message) => {
              if (disposed) return;
              if (message.type === "connected") {
                connected = true;
                clearTimeout(connectTimer);
                latest.current.onState("connected");
                scheduleFit();
              }
              if (message.type === "output") terminal.write(message.data);
              if (message.type === "blocked")
                terminal.write(
                  `\r\n[已拦截] ${message.reason}: ${message.command}\r\n`,
                );
              if (message.type === "status") {
                terminal.write(`\r\n[状态] ${message.message}\r\n`);
                if (message.status === "error" && !connected)
                  fail(message.message);
              }
              if (message.type === "closed") {
                ended = true;
                latest.current.onState("closed", message.reason);
                socket.close();
              }
              latest.current.onMessage(message);
            },
            (value) => {
              if (!disposed) latest.current.onBusy(value);
            },
            fail,
          );
          client.current = connection;
          connection.setContext(latest.current.context);
          function scheduleFit() {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
              if (
                disposed ||
                element.clientWidth === 0 ||
                element.clientHeight === 0
              )
                return;
              try {
                addon.fit();
                connection.resize(terminal.cols, terminal.rows);
              } catch {
                /* Hidden panes are fitted when activated. */
              }
            });
          }
          fit.current = scheduleFit;
          const open = () => {
            if (disposed) return;
            try {
              addon.fit();
            } catch {}
            send({
              type: "connect",
              targetId,
              cols: Math.max(2, terminal.cols),
              rows: Math.max(1, terminal.rows),
            });
          };
          const receive = (event: MessageEvent) => {
            if (typeof event.data === "string") connection.receive(event.data);
          };
          const socketError = () =>
            fail("终端网关连接失败，请检查网关地址与登录状态后重新连接。");
          const socketClose = () => {
            clearTimeout(connectTimer);
            if (disposed || ended) return;
            ended = true;
            connection.dispose();
            latest.current.onState(
              connected ? "closed" : "failed",
              connected ? "终端连接已关闭" : "尚未建立SSH会话，网关已关闭连接",
            );
          };
          const connectTimer = setTimeout(
            () => fail("终端连接超时，请检查网关和SSH服务后重新连接。"),
            20000,
          );
          socket.addEventListener("open", open);
          socket.addEventListener("message", receive);
          socket.addEventListener("error", socketError);
          socket.addEventListener("close", socketClose);
          const input = terminal.onData((data) => connection.input(data));
          const copy = () => {
            const text = terminal.getSelection();
            if (!text) return false;
            void copyText(text);
            return true;
          };
          const paste = () => {
            void navigator.clipboard
              .readText()
              .then((text) => {
                if (!disposed) terminal.paste(text);
              })
              .catch(() => {
                if (!disposed)
                  terminal.write(
                    "\r\n[提示] 请授权剪贴板访问，或使用 Shift+Insert 粘贴。\r\n",
                  );
              });
          };
          terminal.attachCustomKeyEventHandler((event) => {
            if (event.type !== "keydown") return true;
            const mod = event.ctrlKey || event.metaKey;
            const key = event.key.toLowerCase();
            if (
              mod &&
              key === "c" &&
              (event.shiftKey || terminal.hasSelection())
            ) {
              event.preventDefault();
              copy();
              return false;
            }
            if (
              mod &&
              key === "v" &&
              typeof navigator.clipboard?.readText === "function"
            ) {
              event.preventDefault();
              paste();
              return false;
            }
            return true;
          });
          const contextMenu = (event: MouseEvent) => {
            event.preventDefault();
            if (!copy() && typeof navigator.clipboard?.readText === "function")
              paste();
          };
          element.addEventListener("contextmenu", contextMenu);
          const observer = new ResizeObserver(scheduleFit);
          observer.observe(element);
          scheduleFit();
          const unload = () => {
            connection.dispose();
            socket.close();
          };
          window.addEventListener("pagehide", unload);
          close.current = () => {
            clearTimeout(connectTimer);
            if (ended) return;
            ended = true;
            connection.dispose();
            socket.close();
            latest.current.onState("closed", "已主动断开");
          };
          cleanup = () => {
            clearTimeout(connectTimer);
            connection.dispose();
            socket.removeEventListener("open", open);
            socket.removeEventListener("message", receive);
            socket.removeEventListener("error", socketError);
            socket.removeEventListener("close", socketClose);
            socket.close();
            input.dispose();
            observer.disconnect();
            cancelAnimationFrame(frame);
            element.removeEventListener("contextmenu", contextMenu);
            window.removeEventListener("pagehide", unload);
            terminal.dispose();
            client.current = undefined;
          };
        })
        .catch(() => {
          if (!disposed)
            latest.current.onState("failed", "终端组件加载失败，请重新连接。");
        });
      return () => {
        cleanup();
        disposed = true;
      };
    }, [targetId, gatewayUrl]);
    return (
      <div
        ref={host}
        aria-label="交互式终端"
        className="h-full min-h-[360px] w-full min-w-0 overflow-hidden bg-[#10151c] p-2"
      />
    );
  },
);
