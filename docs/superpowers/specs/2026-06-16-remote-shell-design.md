# Web Remote Shell Design

## Summary

Add a web-based remote shell feature to the existing Next.js project. The feature shares the same deployed server with the Jira analysis system, but it is a separate tool surface with isolated frontend routes and an independent terminal gateway process.

The first version provides an internal Web Xshell-style experience:

- `/terminal` page with a top navigation entry named `远程终端`
- whitelist-only server selection
- fixed per-target SSH account and private key configured on the server
- explicit connection confirmation before opening a shell
- real-time interactive terminal with multiple tabs, copy/paste, Ctrl key handling, and terminal resize
- close-page and close-tab behavior that immediately disconnects SSH sessions
- dual command guard modes by target risk level
- audit logs for connection lifecycle and command input, without recording command output

The first version does not implement login or role-based access control. It must only be deployed on a trusted internal network. It must not be exposed directly to the public internet.

## Goals

- Provide a browser-based terminal for connecting to known internal servers.
- Keep server targets and credentials controlled by backend configuration.
- Keep SSH session handling outside the existing Jira analysis API routes.
- Support practical terminal behavior close to Xshell for the first version.
- Reduce dangerous command mistakes with configurable guard modes.
- Record enough audit data to trace who connected and which commands were entered, while avoiding long-term storage of command output.

## Non-Goals

- No arbitrary host input in the browser.
- No password input or private key upload from the browser.
- No user login, role permissions, SSO, or per-user authorization in the first version.
- No session restore after page refresh.
- No background sessions after browser disconnect.
- No shared terminal sessions or spectator mode.
- No full terminal output recording or replay.
- No replacement for operating system permissions, SSH account restrictions, or sudo policy.

## Architecture

The implementation has two runtime layers.

### Next.js App

The existing Next.js service owns:

- `/terminal` page
- top navigation link
- terminal workbench UI
- loading public target metadata
- showing gateway connection status

The Next.js app does not own SSH connections or PTY sessions.

### Terminal Gateway

A separate Node.js process runs on the same server, listening on a local port. It owns:

- WebSocket server
- SSH client connections
- PTY channel setup
- terminal resize propagation
- command guard checks
- audit logging
- session cleanup

Data flow:

```text
Browser /terminal
  -> WebSocket
Terminal Gateway
  -> SSH
Whitelisted remote server
```

This design keeps high-risk shell sessions separate from Jira issue processing, Qwen calls, CAN trace parsing, and IndexedDB-backed product flows.

## Target Server Configuration

Targets are configured through an environment variable, for example `REMOTE_SHELL_TARGETS_JSON`.

Each target includes frontend-visible metadata and gateway-only sensitive fields.

Frontend-visible fields:

```json
{
  "id": "dev-build-01",
  "name": "dev-build-01",
  "description": "构建服务器",
  "environment": "dev",
  "riskLevel": "normal",
  "guardMode": "soft"
}
```

Gateway-only fields:

```json
{
  "host": "10.x.x.x",
  "port": 22,
  "username": "ops",
  "privateKeyPath": "/etc/jira-analyzer/keys/dev-build-01"
}
```

Rules:

- The browser must never receive `host`, `port`, `username`, or `privateKeyPath`.
- The browser selects by `targetId` only.
- The gateway validates all target IDs against server-side configuration.
- Configuration parse errors should fail gateway startup with a clear message.
- Key readability issues should produce a clear gateway error and prevent connection.

## Terminal Page UX

Route: `/terminal`

Navigation: add `远程终端` to the existing top navigation.

Layout:

- Left panel: whitelisted target list with name, description, environment, risk level, guard mode, and current connection status.
- Main panel: terminal tab workspace.
- Bottom/status area: connection status, terminal size, and audit notice.

Interaction:

- User selects a target and clicks connect.
- A confirmation dialog shows target name, environment, SSH username label if safe to expose, risk level, and command guard mode.
- On confirm, a new terminal tab opens and starts a WebSocket session.
- Each tab maps to one SSH session.
- Closing a tab disconnects its SSH session.
- Closing the browser page disconnects all sessions from that page.
- Browser resize sends terminal rows and columns to the gateway.
- Copy/paste and Ctrl key behavior should work through the terminal component.

First-version page states:

- gateway unavailable
- no targets configured
- disconnected
- connecting
- connected
- blocked command
- SSH connection failed
- session closed

## WebSocket Protocol

Browser-to-gateway messages:

```ts
type ClientMessage =
  | { type: "connect"; targetId: string; cols: number; rows: number }
  | { type: "input"; sessionId: string; data: string }
  | { type: "resize"; sessionId: string; cols: number; rows: number }
  | { type: "disconnect"; sessionId: string };
```

Gateway-to-browser messages:

```ts
type ServerMessage =
  | { type: "connected"; sessionId: string; targetId: string }
  | { type: "output"; sessionId: string; data: string }
  | { type: "status"; sessionId?: string; status: string; message: string }
  | { type: "blocked"; sessionId: string; command: string; reason: string }
  | { type: "closed"; sessionId: string; reason: string };
```

The gateway generates `sessionId`. The client must not be allowed to choose or reuse arbitrary session IDs.

## SSH Session Lifecycle

Connection flow:

1. Browser sends `connect` with target ID and initial terminal size.
2. Gateway validates target ID.
3. Gateway opens SSH connection using configured host, port, username, and private key path.
4. Gateway requests a PTY with the browser terminal dimensions.
5. Gateway creates a session ID and sends `connected`.
6. Gateway streams SSH output to browser as `output`.
7. Browser sends keyboard input as `input`.
8. Browser sends resize events as `resize`.
9. Browser disconnect, tab close, or explicit disconnect closes SSH stream and SSH connection.

Cleanup requirements:

- A WebSocket close event closes all sessions owned by that socket.
- A tab close closes that tab's session.
- A failed SSH connection must not leave dangling session state.
- The gateway should enforce an idle timeout as a secondary cleanup guard, even though page close is the primary lifecycle boundary.

## Command Guard

The command guard checks user-entered command lines before sending them to SSH. It is a safety layer for mistakes and common high-risk input. It is not a sandbox.

### Soft Mode

Used for normal-risk targets. It blocks clearly dangerous patterns, such as:

- `rm -rf /`
- `rm -rf /*`
- `reboot`
- `shutdown`
- `halt`
- `poweroff`
- `mkfs`
- fork bomb patterns such as `:(){ :|:& };:`

### Strict Mode

Used for key production or critical targets. It blocks high-risk command families by default unless target-specific allowlist rules permit them:

- `rm`
- `dd`
- `mkfs`
- `mount`
- `umount`
- `systemctl`
- `service`
- `sudo`
- `su`
- `reboot`
- `shutdown`
- `halt`
- `poweroff`

### Guard Limitations

Interactive shell command filtering cannot be perfectly reliable. Users can bypass text-based rules through scripts, interpreters, editors, shell functions, encoded commands, or indirect execution. Real security must come from:

- low-privilege SSH accounts
- restricted sudo policy
- file and directory permissions
- target host hardening
- network-level controls
- audit review

The guard exists to reduce accidental damage and block direct high-risk commands.

## Audit Logging

The gateway writes JSONL audit logs to a local server-side file path.

Logged events:

- gateway startup config summary without secrets
- connect attempt
- connect success
- connect failure
- command input
- blocked command
- resize summary if useful for debugging
- disconnect
- session error

Output is not logged.

Example records:

```json
{"event":"connect","sessionId":"...","targetId":"dev-build-01","at":"2026-06-16T10:00:00.000Z"}
{"event":"command","sessionId":"...","targetId":"dev-build-01","command":"systemctl status app","at":"2026-06-16T10:00:05.000Z"}
{"event":"blocked","sessionId":"...","targetId":"prod-log-01","command":"sudo su","reason":"blocked_by_strict_guard","at":"2026-06-16T10:00:10.000Z"}
{"event":"disconnect","sessionId":"...","targetId":"dev-build-01","reason":"browser_closed","at":"2026-06-16T10:01:00.000Z"}
```

The first version uses a single append-only JSONL file configured by `REMOTE_SHELL_AUDIT_LOG_PATH`. Log rotation is not implemented in the app; the deployment host can rotate the file with system tools if needed.

## Error Handling

- Gateway unavailable: `/terminal` displays `终端网关未启动或不可达`.
- Invalid target ID: gateway rejects the connection and logs the attempt.
- Missing or malformed target config: gateway startup fails with a clear error.
- Private key unreadable: connection fails with a config error.
- SSH auth failure: terminal tab shows connection failure and closes input.
- SSH network timeout: terminal tab shows timeout and allows retry.
- WebSocket disconnect: gateway closes owned SSH sessions.
- Blocked command: terminal displays a Chinese warning and the command is not sent to SSH.
- Gateway process crash: browser shows disconnected state; no automatic session restore in first version.

## Security Boundary

The first version explicitly does not include authentication or authorization. Because fixed SSH keys are configured server-side, deployment must satisfy these constraints:

- The service is reachable only from a trusted internal network.
- The gateway port is not exposed publicly.
- If a reverse proxy is used, only `/terminal` and gateway WebSocket paths intended for internal users are routed.
- SSH accounts used by the gateway are low-privilege accounts.
- Production targets use strict guard mode and remote sudo restrictions.

If the service must ever be exposed outside the trusted network, login and role-based access control become a prerequisite before enabling `/terminal`.

## Testing Plan

Unit tests:

- parse target configuration and reject malformed config
- strip sensitive fields from public target metadata
- soft command guard blocks obvious dangerous commands
- strict command guard blocks high-risk command families
- strict command guard allows configured allowlist entries

Protocol tests:

- connect with valid target creates one session
- connect with invalid target is rejected
- input is forwarded only after session is connected
- blocked command is not forwarded
- resize sends PTY resize
- disconnect closes SSH session
- WebSocket close cleans all sessions for that socket

Frontend checks:

- `/terminal` route exists
- top navigation includes `远程终端`
- target list renders public metadata only
- confirmation dialog appears before connect
- tab close triggers disconnect
- terminal component wires input, output, paste, and resize callbacks

Manual acceptance:

- connect to a test whitelist server
- run normal shell commands
- verify copy and paste
- verify Ctrl+C interrupts a running command
- verify resize updates remote terminal dimensions
- open two tabs to two targets
- close one tab and confirm only that SSH session closes
- close browser page and confirm all sessions close
- verify command audit records input but not output
- verify blocked commands are shown and logged

## Implementation Notes

First-version dependencies:

- frontend terminal: `@xterm/xterm` and `@xterm/addon-fit`
- gateway WebSocket server: `ws`
- SSH client: `ssh2`

The gateway implementation lives under `terminal-gateway/` at the repository root. It is separate from `app/api/issues/process/route.ts` and other Jira analysis routes.

Add companion npm scripts:

- `npm run terminal:gateway`
- `npm run dev:with-terminal`

In local development, `npm run dev:with-terminal` starts both Next.js and the gateway. In deployment, the gateway is run as a separate long-lived process on the same host and bound to localhost by default.
