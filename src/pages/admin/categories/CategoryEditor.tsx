import { useRef, useState, type FormEvent } from "react";
import {
  CategoryIconEnum,
  CreateCategorySchema,
  UpdateCategorySchema,
  type Category,
  type CreateCategory,
  type CategoryFields,
  type CategoryIconName,
} from "../../../../shared/contracts/category";
import { CategoryIcon } from "../../../components/categories/CategoryIcon";
import { cryptoRandomUUID } from "../../../lib/uuid";

type Props = {
  category: Category | null;
  categories: Category[];
  busy: boolean;
  onSave: (input: CreateCategory | CategoryFields) => Promise<void>;
  onCancel: () => void;
};
const iconLabels: Record<CategoryIconName, string> = {
  leaf: "Folha",
  knife: "Faca",
  bowl: "Tigela",
  sparkles: "Ervas",
  sun: "Sol",
  carrot: "Cenoura",
  basket: "Cesta",
};
function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/g, "");
}

export function CategoryEditor({
  category,
  categories,
  busy,
  onSave,
  onCancel,
}: Props) {
  const initial = {
    name: category?.name ?? "",
    slug: category?.slug ?? "",
    description: category?.description ?? "",
    iconName: category?.iconName ?? "leaf",
    parentId: category?.parentId ?? "",
    displayOrder: String(category?.displayOrder ?? 0),
  };
  const [fields, setFields] = useState(initial);
  const [slugEdited, setSlugEdited] = useState(Boolean(category));
  const [validation, setValidation] = useState("");
  const command = useRef<{ fingerprint: string; id: string } | null>(null);
  const changed = JSON.stringify(initial) !== JSON.stringify(fields);
  const forbiddenParents = new Set(category ? [category.id] : []);
  let found = true;
  while (found) {
    found = false;
    for (const row of categories)
      if (
        row.parentId &&
        forbiddenParents.has(row.parentId) &&
        !forbiddenParents.has(row.id)
      ) {
        forbiddenParents.add(row.id);
        found = true;
      }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidation("");
    const value = {
      name: fields.name.trim(),
      slug: fields.slug.trim(),
      description: fields.description.trim() || null,
      iconName: fields.iconName,
      parentId: fields.parentId || null,
      displayOrder: Number(fields.displayOrder),
      ...(category ? { expectedRevision: category.revision } : {}),
    };
    const fingerprint = JSON.stringify(value);
    if (command.current?.fingerprint !== fingerprint)
      command.current = { fingerprint, id: cryptoRandomUUID() };
    const input = (
      category ? UpdateCategorySchema : CreateCategorySchema
    ).safeParse({ ...value, commandId: command.current!.id });
    if (!input.success) {
      setValidation(
        "Confira os campos. O slug deve ter de 2 a 64 caracteres, com letras minúsculas, números e hífens internos; a ordem deve ser um número inteiro.",
      );
      return;
    }
    await onSave(input.data);
  }
  return (
    <form
      className="hvm-category-editor admin-card"
      onSubmit={(event) => void submit(event)}
    >
      <h2>{category ? `Editar ${category.name}` : "Nova categoria"}</h2>
      <p>As categorias são compartilhadas por toda a plataforma.</p>
      <fieldset disabled={busy}>
        <div className="hvm-category-fields">
          <label>
            Nome
            <input
              value={fields.name}
              required
              minLength={2}
              maxLength={128}
              onChange={(event) =>
                setFields({
                  ...fields,
                  name: event.target.value,
                  ...(!slugEdited ? { slug: slugify(event.target.value) } : {}),
                })
              }
            />
          </label>
          <label>
            Slug
            <input
              value={fields.slug}
              required
              minLength={2}
              maxLength={64}
              pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
              onChange={(event) => {
                setSlugEdited(true);
                setFields({ ...fields, slug: event.target.value });
              }}
            />
            <small>
              Identificador único, como hortaliças sem acentos: hortalicas.
            </small>
          </label>
          <label>
            Categoria superior
            <select
              value={fields.parentId}
              onChange={(event) =>
                setFields({ ...fields, parentId: event.target.value })
              }
            >
              <option value="">Sem categoria superior</option>
              {categories
                .filter((row) => !forbiddenParents.has(row.id))
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                    {row.isActive ? "" : " (inativa)"}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Ordem de exibição
            <input
              type="number"
              required
              step={1}
              min={-2147483648}
              max={2147483647}
              value={fields.displayOrder}
              onChange={(event) =>
                setFields({ ...fields, displayOrder: event.target.value })
              }
            />
          </label>
          <label>
            Ícone
            <span className="hvm-category-icon-field">
              <CategoryIcon name={fields.iconName as CategoryIconName} />
              <select
                value={fields.iconName}
                onChange={(event) =>
                  setFields({
                    ...fields,
                    iconName: event.target.value as CategoryIconName,
                  })
                }
              >
                {CategoryIconEnum.options.map((icon) => (
                  <option key={icon} value={icon}>
                    {iconLabels[icon]}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className="hvm-category-wide">
            Descrição
            <textarea
              rows={3}
              maxLength={500}
              value={fields.description}
              onChange={(event) =>
                setFields({ ...fields, description: event.target.value })
              }
            />
            <small>{fields.description.length}/500 caracteres</small>
          </label>
        </div>
        {validation && (
          <p role="alert" className="admin-error">
            {validation}
          </p>
        )}
        <div className="hvm-category-actions">
          <button
            className="admin-primary"
            type="submit"
            disabled={busy || (Boolean(category) && !changed)}
          >
            {busy
              ? "Salvando…"
              : category
                ? "Salvar alterações"
                : "Criar categoria"}
          </button>
          {category && (
            <button
              type="button"
              className="admin-secondary"
              onClick={onCancel}
            >
              Cancelar edição
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
