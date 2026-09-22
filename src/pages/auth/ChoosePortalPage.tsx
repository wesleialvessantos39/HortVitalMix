import { ChevronRight, ShoppingBag, Sprout } from "lucide-react";

export function ChoosePortalPage({ onNavigate }: { onNavigate: (to: string) => void }) {
  return (
    <section className="access-selector" aria-labelledby="registration-choice-title">
      <span className="eyebrow">Cadastro</span>
      <h1 id="registration-choice-title" className="portal-choice-heading">
        Como você quer participar?
      </h1>
      <p className="portal-choice-copy">
        Consumidor e Produtor possuem cadastros separados. O cadastro público nunca concede acesso administrativo.
      </p>
      <div className="access-grid">
        <button className="access-card access-card-consumer" type="button" onClick={() => onNavigate("/cadastro/consumidor")}>
          <span className="access-card-top" aria-hidden="true">
            <span className="access-card-icon"><ShoppingBag /></span>
            <span className="access-card-badge">Para você</span>
          </span>
          <span className="access-card-copy">
            <strong className="access-card-title">Cadastrar como Consumidor</strong>
            <span className="access-card-description">Crie seu acesso para comprar produtos frescos e acompanhar pedidos.</span>
          </span>
          <span className="access-card-action">Cadastro de Consumidor <ChevronRight /></span>
          <ChevronRight className="access-card-mobile-chevron" aria-hidden="true" />
        </button>

        <button className="access-card access-card-producer" type="button" onClick={() => onNavigate("/cadastro/produtor")}>
          <span className="access-card-top" aria-hidden="true">
            <span className="access-card-icon"><Sprout /></span>
            <span className="access-card-badge">Para produtores</span>
          </span>
          <span className="access-card-copy">
            <strong className="access-card-title">Cadastrar como Produtor</strong>
            <span className="access-card-description">Crie somente o perfil de Produtor e vincule os dados iniciais da produção.</span>
          </span>
          <span className="access-card-action">Cadastro de Produtor <ChevronRight /></span>
          <ChevronRight className="access-card-mobile-chevron" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
