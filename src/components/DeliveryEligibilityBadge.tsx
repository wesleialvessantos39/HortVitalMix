import { CheckCircle2, MapPinOff } from "lucide-react";
import "./deliveryEligibility.css";

export default function DeliveryEligibilityBadge({
  isEligible,
  ineligibilityReason = null,
}: {
  isEligible: boolean;
  ineligibilityReason?: string | null;
}) {
  return (
    <span
      className={`hvm-delivery-eligibility ${isEligible ? "eligible" : "outside"}`}
      role="status"
    >
      {isEligible ? (
        <CheckCircle2 size={17} aria-hidden="true" />
      ) : (
        <MapPinOff size={17} aria-hidden="true" />
      )}
      {isEligible
        ? "Dentro da área de entrega"
        : ineligibilityReason === "valor_minimo_nao_atingido"
          ? "O valor mínimo para entrega ainda não foi atingido."
          : "Este endereço está fora da área de entrega desta loja."}
    </span>
  );
}
