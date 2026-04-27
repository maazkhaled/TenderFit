export class NotAuthError extends Error {
  constructor(message = "not_authenticated") {
    super(message);
    this.name = "NotAuthError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "not_found") {
    super(message);
    this.name = "NotFoundError";
  }
}
