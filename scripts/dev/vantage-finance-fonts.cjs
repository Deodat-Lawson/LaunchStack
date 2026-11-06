// Valid offline-only CSS. No remote stylesheet or font resource.
module.exports = new Proxy({}, {get: (_,url) => {
  const family=String(url).includes('JetBrains')?'JetBrains Mono':'Inter';
  return `@font-face { font-family: '${family}'; font-style: normal; font-weight: 100 900; font-display: swap; src: local('Arial'); }`;
}});
