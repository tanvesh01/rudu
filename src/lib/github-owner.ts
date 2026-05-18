function getOwnerLogin(nameWithOwner: string) {
  const [owner] = nameWithOwner.split("/");
  return owner || nameWithOwner;
}

function getOwnerAvatarUrl(nameWithOwner: string, size = 40) {
  const ownerLogin = getOwnerLogin(nameWithOwner);
  return `https://github.com/${ownerLogin}.png?size=${size}`;
}

function getGithubUserAvatarUrl(login: string, size = 40) {
  return `https://github.com/${login}.png?size=${size}`;
}

export { getGithubUserAvatarUrl, getOwnerAvatarUrl, getOwnerLogin };
