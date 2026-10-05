import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readCartSession,
  mergeLoginCart,
  clearCartSession,
} from "../../server/security/cartSession.ts";
import { CartService } from "../../server/services/CartService.ts";
const request = (cookie: string) =>
  ({ headers: { cookie }, requestId: randomUUID() }) as Request;
afterEach(() => vi.restoreAllMocks());
describe("T18 integração de login e logout", () => {
  it("somente UUID opaco válido, com cookie não duplicado", () => {
    const id = randomUUID();
    expect(readCartSession(request("hvm_cart=" + id))).toBe(id);
    for (const value of [
      "hvm_cart=forged",
      "hvm_cart=%",
      "hvm_cart=" + id + "; hvm_cart=" + randomUUID(),
    ])
      expect(readCartSession(request(value))).toBe(null);
  });
  it("login espera fusão com usuário já validado", async () => {
    const id = randomUUID(),
      userId = randomUUID(),
      merge = vi
        .spyOn(CartService, "mergeCartOnLogin")
        .mockResolvedValue({
          id: randomUUID(),
          session_id: id,
          user_id: userId,
        });
    await mergeLoginCart(request("hvm_cart=" + id), userId);
    expect(merge).toHaveBeenCalledWith(id, userId);
  });
  it("indisponibilidade preserva intenção e não interrompe login anterior", async () => {
    const merge = vi
      .spyOn(CartService, "mergeCartOnLogin")
      .mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      mergeLoginCart(request("hvm_cart=" + randomUUID()), randomUUID()),
    ).resolves.toBeUndefined();
    expect(merge).toHaveBeenCalledTimes(1);
  });
  it("logout descarta cookie visitante e login sem cesta não chama banco novo", async () => {
    const clearCookie = vi.fn(),
      merge = vi.spyOn(CartService, "mergeCartOnLogin");
    clearCartSession({ clearCookie } as unknown as Response);
    expect(clearCookie).toHaveBeenCalledWith(
      "hvm_cart",
      expect.objectContaining({ httpOnly: true, path: "/", sameSite: "lax" }),
    );
    await mergeLoginCart(request(""), randomUUID());
    expect(merge).not.toHaveBeenCalled();
  });
});
