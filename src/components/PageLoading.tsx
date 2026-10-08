import "./pageLoading.css";

type Props = { label?: string; compact?: boolean };

export function PageLoading({ label = "Carregando…", compact = false }: Props) {
  return (
    <div className={`hvm-page-loading${compact ? " hvm-page-loading--compact" : ""}`} role="status" aria-live="polite" aria-label={label}>
      <span className="hvm-page-loading-label">{label}</span>
      <div className="hvm-page-loading-content" aria-hidden="true">
        <div className="hvm-page-loading-block hvm-page-loading-title" />
        <div className="hvm-page-loading-grid">
          <div className="hvm-page-loading-block" />
          <div className="hvm-page-loading-block" />
          <div className="hvm-page-loading-block" />
        </div>
        {!compact && <div className="hvm-page-loading-block hvm-page-loading-panel" />}
      </div>
    </div>
  );
}
