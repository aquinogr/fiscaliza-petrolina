// Marca do app: pino de mapa com chama, nas cores da corporação.
export function marca(tamanho = 34) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', tamanho);
  svg.setAttribute('height', tamanho);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'marca');
  svg.innerHTML = `
    <path d="M24 3c-8.8 0-16 7-16 15.7C8 30.5 24 45 24 45s16-14.5 16-26.3C40 10 32.8 3 24 3z" fill="#fff"/>
    <path d="M24.6 9.5c.6 3.6-1.4 5.6-3.3 7.6-1.7 1.8-3.3 3.6-3.3 6.4 0 3.6 2.8 6.5 6.3 6.5s6.3-2.9 6.3-6.6c0-2.3-1-4.2-2.2-5.6.1 1.9-.6 3.4-1.9 4 .4-4.3-1-8.9-1.9-12.3z" fill="#C8102E"/>`;
  return svg;
}
