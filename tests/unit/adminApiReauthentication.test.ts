import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, withAdminIdentityConfirmation } from "../../src/lib/api";
import {
  readAdminAccessToken,
  readAdminSessionIdentityVersion,
  saveAdminSession,
} from "../../src/lib/adminSessionStore";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("location", { hostname: "hortvitalmix.vercel.app" });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("fetch", fetchMock);
  saveAdminSession({
    accessToken: "existing-access-token",
    refreshToken: "existing-refresh-token",
    expiresIn: 3600,
  });
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("Confirmação administrativa e renovação de sessão", () => {
  for (const error of [
    "ADMIN_REAUTHENTICATION_REQUIRED",
    "ADMIN_REAUTH_REQUIRED",
    "REAUTH_REQUIRED",
    "RECENT_AUTH_REQUIRED",
  ])
    it(`${error} exige confirmação sem renovar ou repetir o convite`, async () => {
      fetchMock.mockResolvedValue(Response.json({ error }, { status: 401 }));
      await expect(
        api("/v1/admin/invites", {
          method: "POST",
          body: JSON.stringify({ commandId: "stable-command" }),
        }),
      ).rejects.toMatchObject({ message: error, status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(readAdminAccessToken()).toBe("existing-access-token");
    });

  it("senha incorreta no login não renova a sessão anterior nem repete a senha", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ status: "invalid_credentials" }, { status: 401 }),
    );
    await expect(
      api("/v1/admin/auth/login", { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({ message: "invalid_credentials", status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("senha incorreta na confirmação não renova nem repete a tentativa", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ status: "invalid_credentials" }, { status: 401 }),
    );
    await expect(
      api("/v1/admin/auth/reauthenticate", {
        method: "POST",
        body: JSON.stringify({ password: "synthetic-wrong-password" }),
      }),
    ).rejects.toMatchObject({ message: "invalid_credentials", status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renovação em trânsito não substitui outra conta nem repete seu convite", async () => {
    let releaseRefresh!: (response: Response) => void;
    const refresh = new Promise<Response>((resolve) => {
      releaseRefresh = resolve;
    });
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ error: "UNAUTHORIZED" }, { status: 401 }),
      )
      .mockReturnValueOnce(refresh);
    const request = api("/v1/admin/invites", {
      method: "POST",
      body: JSON.stringify({ commandId: "original-invite-command" }),
    });
    const rejection = expect(request).rejects.toMatchObject({ status: 401 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    saveAdminSession({
      accessToken: "newly-confirmed-access",
      refreshToken: "newly-confirmed-refresh",
      expiresIn: 3600,
    });
    releaseRefresh(
      Response.json({
        accessToken: "older-renewed-access",
        refreshToken: "older-renewed-refresh",
        expiresIn: 3600,
      }),
    );
    await rejection;
    expect(readAdminAccessToken()).toBe("newly-confirmed-access");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/admin/invites"),
      ),
    ).toHaveLength(1);
  });

  for (const path of [
    "/v1/admin/auth/verify-session",
    "/v1/admin/auth/reauthenticate",
  ])
    it(`${path} renova somente a sessão expirada, preservando a identidade`, async () => {
      const version = readAdminSessionIdentityVersion();
      fetchMock
        .mockResolvedValueOnce(
          Response.json({ error: "UNAUTHORIZED" }, { status: 401 }),
        )
        .mockResolvedValueOnce(
          Response.json({
            accessToken: "fresh",
            refreshToken: "fresh-refresh",
            expiresIn: 3600,
          }),
        )
        .mockResolvedValueOnce(Response.json({ status: "confirmed" }));
      await expect(api(path, { method: "POST", body: "{}" })).resolves.toEqual({
        status: "confirmed",
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(readAdminSessionIdentityVersion()).toBe(version);
    });

  it("a confirmação aguarda a renovação pendente antes de enviar a senha", async () => {
    let releaseRefresh!: (response: Response) => void;
    const refresh = new Promise<Response>((resolve) => {
      releaseRefresh = resolve;
    });
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ error: "UNAUTHORIZED" }, { status: 401 }),
      )
      .mockReturnValueOnce(refresh)
      .mockResolvedValueOnce(Response.json({ invites: [] }))
      .mockResolvedValueOnce(Response.json({ status: "session_created" }));
    const list = api("/v1/admin/invites");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const confirm = withAdminIdentityConfirmation(() =>
      api("/v1/admin/auth/reauthenticate", {
        method: "POST",
        body: "{}",
      }),
    );
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    releaseRefresh(
      Response.json({
        accessToken: "fresh",
        refreshToken: "fresh-refresh",
        expiresIn: 3600,
      }),
    );
    await Promise.all([list, confirm]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/admin/invites",
      "/api/v1/auth/refresh",
      "/api/v1/admin/invites",
      "/api/v1/admin/auth/reauthenticate",
    ]);
  });

  it("uma requisição expirada aguarda a confirmação sem emitir renovação concorrente", async () => {
    let releaseConfirmation!: (response: Response) => void;
    const confirmation = new Promise<Response>((resolve) => {
      releaseConfirmation = resolve;
    });
    fetchMock
      .mockReturnValueOnce(confirmation)
      .mockResolvedValueOnce(
        Response.json({ error: "UNAUTHORIZED" }, { status: 401 }),
      )
      .mockResolvedValueOnce(Response.json({ invites: [] }));
    const confirm = withAdminIdentityConfirmation(async () => {
      await api("/v1/admin/auth/reauthenticate", {
        method: "POST",
        body: "{}",
      });
      // Representa a validação + adoção feita no componente antes de liberar
      // as requisições que aguardam a confirmação.
      saveAdminSession({
        accessToken: "newly-confirmed-access",
        refreshToken: "newly-confirmed-refresh",
        expiresIn: 3600,
      });
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const list = api("/v1/admin/invites");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/auth/refresh"),
      ),
    ).toBe(false);
    releaseConfirmation(Response.json({ status: "session_created" }));
    await Promise.all([confirm, list]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer newly-confirmed-access",
    });
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/auth/refresh"),
      ),
    ).toBe(false);
  });

  it("sessão expirada ainda renova e retoma o mesmo comando uma única vez", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ error: "ADMIN_UNAUTHORIZED" }, { status: 401 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          accessToken: "renewed-access-token",
          refreshToken: "renewed-refresh-token",
          expiresIn: 3600,
        }),
      )
      .mockResolvedValueOnce(Response.json({ status: "created" }));
    const input = {
      method: "POST",
      body: JSON.stringify({ commandId: "stable-command" }),
    };
    await expect(api("/v1/admin/invites", input)).resolves.toEqual({
      status: "created",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/admin/invites",
      "/api/v1/auth/refresh",
      "/api/v1/admin/invites",
    ]);
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(input.body);
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer renewed-access-token",
    });
  });
});
