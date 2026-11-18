// Plugin fautif : boucle sans fin au premier élément.
export default function creer() {
  return {
    id: 'boucle',
    compute() {
      for (;;);
    },
  };
}
