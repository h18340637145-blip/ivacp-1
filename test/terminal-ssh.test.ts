import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { Server } from "ssh2";
import { expect, it } from "vitest";
import { connectSsh } from "../terminal-gateway/ssh-connection";

it("真实本地SSH：PTY和exec复用认证，卡住的exec有界超时且PTY仍可用，关闭释放连接", async () => {
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" });
  let authentications = 0;
  const server = new Server({ hostKeys: [key] }, connection => {
    connection.on("authentication", ctx => { authentications++; ctx.accept(); });
    connection.on("ready", () => connection.on("session", accept => {
      const session = accept();
      session.on("pty", accept => accept?.());
      session.on("shell", accept => { const shell = accept(); shell.on("data", (data: Buffer) => shell.write(data)); });
      session.on("exec", (accept, _reject, info) => {
        const stream = accept();
        if (info.command === "hang") return;
        stream.write("ok"); stream.exit(0); stream.end();
      });
    }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address() as { port: number };
  let channel: Awaited<ReturnType<typeof connectSsh>> | undefined;
  try {
    channel = await connectSsh({ id: "local", name: "local", description: "", environment: "test", riskLevel: "normal", guardMode: "soft", host: "127.0.0.1", port: address.port, username: "test", password: "test" }, { cols: 80, rows: 24 }, 1000);
    expect(await channel.runCommand!("echo ok")).toMatchObject({ stdout: "ok", code: 0 });
    await expect(channel.runCommand!("hang")).rejects.toThrow("超时");
    expect(await channel.runCommand!("echo again")).toMatchObject({ stdout: "ok", code: 0 });
    expect(authentications).toBe(1);
    const output = new Promise<string>(resolve => channel!.on("data", (data: Buffer | string) => resolve(data.toString())));
    channel.write("still alive");
    expect(await output).toBe("still alive");
  } finally { channel?.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
