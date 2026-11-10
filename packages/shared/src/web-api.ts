// Le paquet ne charge ni les types du DOM ni ceux de Node : les deux API communes au navigateur et à Node
// dont il a besoin sont typées ici, au plus juste.

interface ParsedUrl {
  hostname: string;
}

interface RandomSource {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

export const { URL, crypto } = globalThis as unknown as {
  URL: new (url: string) => ParsedUrl;
  crypto: RandomSource;
};
