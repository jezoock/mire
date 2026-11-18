// Plugin d'essai : une boucle sans fin au premier élément.
export default () => ({
  id: 'boucle',
  compute() {
    for (;;);
  },
});
