// Plugin d'essai : une exception au premier élément.
export default () => ({
  id: 'erreur',
  compute() {
    throw new Error('panne voulue');
  },
});
