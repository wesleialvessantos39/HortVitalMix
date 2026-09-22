import { passwordChecks, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../../shared/contracts/auth";

export function PasswordStrengthMeter({ value }: { value: string }) {
  const checks = passwordChecks(value);
  const rules = [
    [checks.length, `Entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres`],
    [checks.lowercase, "Letra minúscula"],
    [checks.uppercase, "Letra maiúscula"],
    [checks.number, "Número"],
    [checks.symbol, "Símbolo, por exemplo: ! @ # $ %"],
  ] as const;
  return <div className="password-rules" aria-live="polite"><strong>Sua senha deve conter:</strong><ul>
    {rules.map(([valid, text]) => <li key={text} className={valid ? "valid" : undefined}>
      <span aria-hidden="true">{valid ? "✓" : "○"}</span>{text}
    </li>)}
  </ul></div>;
}
