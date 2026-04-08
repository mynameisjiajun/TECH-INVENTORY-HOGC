export function getCronSecretFromRequest(request) {
  const headerSecret = request.headers.get("x-cron-secret");
  if (headerSecret) {
    return headerSecret;
  }

  const authorization = request.headers.get("authorization") || "";
  if (authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return "";
}

export function hasValidCronSecret(request, cronSecret) {
  if (!cronSecret) {
    return false;
  }

  const secret = getCronSecretFromRequest(request);
  return !!secret && secret === cronSecret;
}
