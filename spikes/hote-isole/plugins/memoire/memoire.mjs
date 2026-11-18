// Plugin fautif : remplit la mémoire jusqu'à faire tomber son hôte.
export default function creer() {
  return {
    id: 'memoire',
    compute() {
      const tas = [];
      for (;;) tas.push(new Array(1e6).fill(Math.random()));
    },
  };
}
