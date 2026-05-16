function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shortSha(headSha: string) {
  return headSha.slice(0, 12);
}

export function sessionIdFor(repo: string, number: number, headSha: string) {
  return `${slugify(repo)}-pr-${number}-${shortSha(headSha).toLowerCase()}`;
}
