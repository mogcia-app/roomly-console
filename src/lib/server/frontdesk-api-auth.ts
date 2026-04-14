export function verifyFrontdeskApiBearer(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("missing-bearer-token");
  }

  const providedToken = authorization.slice("Bearer ".length).trim();
  const expectedToken = (process.env.FRONTDESK_API_BEARER_TOKEN ?? "").trim();

  if (!expectedToken) {
    throw new Error("missing-frontdesk-api-token");
  }

  if (!providedToken || providedToken !== expectedToken) {
    throw new Error("invalid-frontdesk-api-token");
  }
}
