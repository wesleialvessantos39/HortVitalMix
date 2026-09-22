import { describe, expect, it } from "vitest";
import { formatBrazilMobile, formatCpf, normalizeBrazilMobile, normalizeCpf, normalizeEmail } from "../../shared/utils/normalization";

describe("Trilha 03 — normalização", () => {
  it("CPF", () => {
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
    expect(normalizeCpf("529.982.247-25")).toBe("52998224725");
  });
  it("celular", () => {
    expect(formatBrazilMobile("69999998888")).toBe("(69) 99999-8888");
    expect(normalizeBrazilMobile("(69) 99999-8888")).toBe("+5569999998888");
  });
  it("e-mail", () => expect(normalizeEmail("  Pessoa@EXAMPLE.COM ")).toBe("pessoa@example.com"));
});
