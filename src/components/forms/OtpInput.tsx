import { useEffect, useRef, useState } from "react";

export function OtpInput({
  length = 6,
  value,
  onChange,
  disabled = false,
}: {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [digits, setDigits] = useState(() =>
    Array.from({ length }, (_, index) => value[index] ?? ""),
  );
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    setDigits(Array.from({ length }, (_, index) => value[index] ?? ""));
  }, [length, value]);

  function commit(next: string[]) {
    setDigits(next);
    onChange(next.join(""));
  }

  function setDigit(index: number, raw: string) {
    const clean = raw.replace(/\D/g, "");
    if (!clean) {
      const next = [...digits];
      next[index] = "";
      commit(next);
      return;
    }
    if (clean.length > 1) {
      const next = [...digits];
      clean.slice(0, length - index).split("").forEach((digit, offset) => {
        next[index + offset] = digit;
      });
      commit(next);
      refs.current[Math.min(length - 1, index + clean.length)]?.focus();
      return;
    }
    const next = [...digits];
    next[index] = clean;
    commit(next);
    if (index < length - 1) refs.current[index + 1]?.focus();
  }

  return (
    <div className="t04-otp" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }} role="group" aria-label={`Código de segurança de ${length} dígitos`}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            refs.current[index] = element;
          }}
          value={digit}
          disabled={disabled}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={index === 0 ? length : 1}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={`Dígito ${index + 1} de ${length}`}
          onChange={(event) => setDigit(index, event.currentTarget.value)}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
            if (!pasted) return;
            event.preventDefault();
            setDigit(index, pasted);
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !digits[index] && index > 0) {
              refs.current[index - 1]?.focus();
            } else if (event.key === "ArrowLeft" && index > 0) {
              event.preventDefault();
              refs.current[index - 1]?.focus();
            } else if (event.key === "ArrowRight" && index < length - 1) {
              event.preventDefault();
              refs.current[index + 1]?.focus();
            }
          }}
        />
      ))}
    </div>
  );
}
