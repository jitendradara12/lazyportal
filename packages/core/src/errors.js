// Deep module: portal errors. Single place for error shape.

export class PortalError extends Error {
  constructor(message, { code = "PORTAL_ERROR", status, errors = [] } = {}) {
    super(message);
    this.name = "PortalError";
    this.code = code;
    this.status = status;
    this.errors = errors;
  }
}

export class SessionExpiredError extends PortalError {
  constructor(message = "Portal logged you out.") {
    super(message, { code: "SESSION_EXPIRED", status: 401 });
    this.name = "SessionExpiredError";
  }
}

export class CaptchaError extends PortalError {
  constructor(message = "Invalid captcha submitted..") {
    super(message, { code: "CAPTCHA_INVALID" });
    this.name = "CaptchaError";
  }
}

/** Normalize CampusLynx failure payloads: {status:{responseStatus,errors},response} */
export function toPortalError(body, status) {
  const errors = body?.status?.errors ?? [];
  const msg = errors[0] ?? `Request failed (HTTP ${status})`;
  if (/captcha/i.test(msg)) return new CaptchaError(msg);
  if (status === 401 || /session.*expired|invalid.*token|token.*expired|login again/i.test(msg)) {
    return new SessionExpiredError(msg);
  }
  return new PortalError(msg, { status, errors });
}
