export class ApplicationError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly publicMessage: string,
  ) {
    super(code);
    this.name = 'ApplicationError';
  }
}
