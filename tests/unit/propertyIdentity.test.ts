import { describe, expect, it } from "vitest";
import { propertyIdentityKey } from "../../shared/rural/propertyIdentity";

describe("identidade do mesmo imóvel rural", () => {
  it("reconhece o mesmo CAR mesmo com máscara diferente", () => {
    const left = propertyIdentityKey({
      producerId: "p1",
      registrationNumber: "RO-1100205-AAA",
      propertyName: "Chácara A",
      municipality: "Ariquemes",
    });
    const right = propertyIdentityKey({
      producerId: "p1",
      registrationNumber: "ro 1100205 aaa",
      propertyName: "Outro nome",
      municipality: "Cacoal",
    });
    expect(left).toBe(right);
  });

  it("não mistura produtores diferentes", () => {
    const base = {
      registrationNumber: "RO1100205AAA",
      propertyName: "Sítio",
      municipality: "Ariquemes",
    };
    expect(propertyIdentityKey({ ...base, producerId: "a" })).not.toBe(
      propertyIdentityKey({ ...base, producerId: "b" }),
    );
  });

  it("usa nome, município e linha quando não há registro", () => {
    expect(
      propertyIdentityKey({
        producerId: "p1",
        propertyName: "Chácara São João",
        municipality: "Ariquemes",
        lineVicinal: "Linha C-65",
      }),
    ).toBe(
      propertyIdentityKey({
        producerId: "p1",
        propertyName: "chacara sao joao",
        municipality: "ARIQUEMES",
        lineVicinal: "linha c65",
      }),
    );
  });
});
